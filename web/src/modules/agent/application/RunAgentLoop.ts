import {
  ModelMessageRole,
  type ModelMessage,
  type ModelToolCall,
  type ProviderGateway
} from '@/capabilities/ai-runtime/public';
import type { AgentRunId } from '@/kernel/public';
import {
  AgentToolPolicyDecision,
  type AgentCheckpointStore,
  type AgentLoopCheckpoint,
  type AgentModelInvoker,
  type AgentRuntimeObserver,
  type AgentToolAttemptState,
  type AgentToolExecutionContext,
  type AgentToolExecutor,
  type AgentToolPolicy,
  type AgentSkillWorkflowState
} from '../contracts/AgentRuntimePorts';
import type { AgentSkillActivation } from '../domain/AgentSkillRegistry';
import { AgentExecutionBudget } from '../domain/AgentExecutionBudget';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';
import { ActiveAgentToolSet, providerToolName } from './ActiveAgentToolSet';
import { AgentCompletionTracker, completionResolutionInstruction } from './AgentCompletionTracker';
import type { AgentLoopResult, RunAgentLoopCommand } from './AgentLoopContracts';
import { AgentToolInvocationValidator } from './AgentToolInvocationValidator';
import {
  blockedRepeatReason,
  completionVerifierNames,
  hasCompletionValidator,
  hasPendingRequiredWrite,
  restoreToolAttempts
} from './AgentLoopStatePolicy';
import { executeAgentToolCalls } from './AgentToolBatchExecutor';
import {
  agentToolSignature,
  attemptedToolNames,
  composeActiveSkillSystem,
  compactAgentLoopMessages,
  completionVerificationInstruction,
  consumeAgentGuidance,
  createToolObservationMessage,
  createToolResultMessage,
  decrementToolSignature,
  limitToolResult,
  sanitizeMessageForCheckpoint,
  skillContinuationInstruction,
  validateAgentLoopLimits
} from './AgentLoopSupport';
/** Provider-neutral, bounded Agent loop. Business writes remain behind typed tool executors. */
export class RunAgentLoop {
  private observerQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly modelInvoker: AgentModelInvoker,
    private readonly policy: AgentToolPolicy,
    private readonly executor: AgentToolExecutor,
    private readonly checkpoints: AgentCheckpointStore,
    private readonly observer?: AgentRuntimeObserver,
    private readonly validator = new AgentToolInvocationValidator()
  ) {}

  async execute(
    command: RunAgentLoopCommand,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<AgentLoopResult> {
    const limits = validateAgentLoopLimits(command);
    const toolSet = new ActiveAgentToolSet(command.tools, command.availableTools);
    toolSet.activate(command.checkpoint?.activeToolNames ?? []);
    let messages = [...(command.checkpoint?.messages ?? command.messages)];
    const signatures = { ...(command.checkpoint?.toolSignatures ?? {}) };
    const toolAttempts = restoreToolAttempts(signatures, command.checkpoint?.toolAttempts);
    const activeSkills = new Map<string, AgentSkillActivation>();
    [...(command.skills ?? []), ...(command.checkpoint?.activeSkills ?? [])]
      .forEach((skill) => activeSkills.set(skill.name, skill));
    const budget = new AgentExecutionBudget(limits, [...activeSkills.values()].map((skill) => skill.executionBudget));
    const priorEvidenceCount = Object.keys(signatures).length;
    if (priorEvidenceCount) budget.recordProgress(priorEvidenceCount);
    const requiredTool = command.requiredToolName
      ? toolSet.byName(command.requiredToolName)
      : undefined;
    if (command.requiredToolName && !requiredTool) {
      throw new Error(`Required Agent tool is unavailable: ${command.requiredToolName}`);
    }
    const attemptedNames = attemptedToolNames(signatures, toolSet.names);
    const completedToolNames = new Set(command.checkpoint?.completedToolNames ?? []);
    let turnCount = command.checkpoint?.turnCount ?? 0;
    let toolCallCount = command.checkpoint?.toolCallCount ?? 0;
    let skillWorkflowState: AgentSkillWorkflowState = command.checkpoint?.skillWorkflowState
      ?? (activeSkills.size ? 'selected' : 'idle');
    let awaitingOperationalTool = [...activeSkills.values()].some((skill) => skill.requiresOperationalTool)
      && (skillWorkflowState === 'selected' || skillWorkflowState === 'executing');
    const completionTracker = new AgentCompletionTracker(command.checkpoint?.pendingCompletionExpectations);
    let awaitingCompletionVerification = completionTracker.requiresVerification;
    let delegatedCompletion = false;
    let finalizationOnly = false;
    let requiredToolRepairCount = 0;
    let skillContinuationRepairCount = 0;
    let forceRequiredTool = Boolean(command.forceRequiredToolOnFirstTurn && requiredTool);
    const saveCheckpoint = (pendingConfirmation?: ModelToolCall) => this.save(
      command.agentRunId,
      turnCount,
      toolCallCount,
      messages,
      signatures,
      toolAttempts,
      {
        pendingConfirmation,
        activeSkills: [...activeSkills.values()],
        activeToolNames: [...toolSet.names],
        completedToolNames: [...completedToolNames],
        skillWorkflowState,
        awaitingCompletionVerification,
        pendingCompletionExpectations: completionTracker.list()
      },
      command.executionContext.leaseToken
    );
    await this.emit({ type: 'run_started', agentRunId: command.agentRunId });

    const pendingConfirmation = command.checkpoint?.pendingConfirmation;
    if (pendingConfirmation) {
      const definition = toolSet.byName(pendingConfirmation.name);
      if (!definition) throw new Error(`Pending Agent tool is unavailable: ${pendingConfirmation.name}`);
      if (!command.confirmationDecision) {
        throw new Error('Pending Agent tool requires an explicit confirmation decision');
      }
      if (command.confirmationDecision === 'reject') {
        messages.push(createToolObservationMessage(pendingConfirmation, {
          status: 'failed',
          content: '用户已取消本次工具调用。',
          retryable: false,
          failureCode: 'agent.tool_rejected_by_user'
        }));
        toolAttempts[agentToolSignature(pendingConfirmation)] = {
          attempts: signatures[agentToolSignature(pendingConfirmation)] ?? 1,
          status: 'failed',
          retryable: false,
          failureCode: 'agent.tool_rejected_by_user'
        };
        skillWorkflowState = 'ready_to_finalize';
        awaitingOperationalTool = false;
        await this.emit({
          type: 'tool_call_failed',
          agentRunId: command.agentRunId,
          call: pendingConfirmation,
          reasonCode: 'agent.tool_rejected_by_user'
        });
      } else {
        await this.emit({ type: 'tool_call_started', agentRunId: command.agentRunId, call: pendingConfirmation });
        try {
          const result = await this.executor.execute(definition, pendingConfirmation, {
            ...command.executionContext,
            signal
          });
          const signature = agentToolSignature(pendingConfirmation);
          const madeProgress = !result.isError && (result.madeProgress ?? Boolean(
            result.content.trim()
            || result.resultRef
            || result.activateToolNames?.length
            || result.activateSkills?.length
          ));
          toolAttempts[signature] = {
            attempts: signatures[signature] ?? 1,
            status: result.isError ? 'failed' : madeProgress ? 'succeeded' : 'no_progress',
            retryable: result.isError ? result.retryable !== false : !madeProgress,
            failureCode: result.failureCode
          };
          messages.push(createToolObservationMessage(pendingConfirmation, {
            status: result.isError ? 'failed' : madeProgress ? 'succeeded' : 'no_progress',
            content: limitToolResult(result.content, limits.maxToolResultChars),
            retryable: result.isError ? result.retryable !== false : !madeProgress,
            failureCode: result.failureCode
          }));
          if (result.isError) {
            await this.emit({
              type: 'tool_call_failed',
              agentRunId: command.agentRunId,
              call: pendingConfirmation,
              reasonCode: 'agent.tool_execution_error'
            });
          } else {
            budget.recordProgress();
            if (definition.risk !== 'read') completedToolNames.add(definition.name);
            if (result.completionExpectation) {
              completionTracker.expect([result.completionExpectation]);
              awaitingCompletionVerification = true;
            }
            skillWorkflowState = 'ready_to_finalize';
            awaitingOperationalTool = false;
            await this.emit({
              type: 'tool_call_succeeded',
              agentRunId: command.agentRunId,
              call: pendingConfirmation,
              resultRef: result.resultRef
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          messages.push(createToolObservationMessage(pendingConfirmation, {
            status: 'failed',
            content: limitToolResult(`工具执行失败：${message}`, limits.maxToolResultChars),
            retryable: true,
            failureCode: 'agent.tool_execution_failed'
          }));
          const signature = agentToolSignature(pendingConfirmation);
          toolAttempts[signature] = {
            attempts: signatures[signature] ?? 1,
            status: 'failed',
            retryable: true,
            failureCode: 'agent.tool_execution_failed'
          };
          await this.emit({
            type: 'tool_call_failed',
            agentRunId: command.agentRunId,
            call: pendingConfirmation,
            reasonCode: 'agent.tool_execution_failed'
          });
        }
      }
      await saveCheckpoint();
    }

    while (true) {
      const turnBudget = budget.allowNextTurn(turnCount, toolCallCount);
      if (!turnBudget.allowed) {
        const checkpoint = await saveCheckpoint();
        await this.emit({
          type: 'run_stopped',
          agentRunId: command.agentRunId,
          reasonCode: turnBudget.reasonCode ?? 'agent.execution_budget_exhausted'
        });
        return { status: 'budget_exhausted', text: '', checkpoint };
      }
      signal?.throwIfAborted();
      messages.push(...await consumeAgentGuidance(command.consumeGuidance));
      messages = [...compactAgentLoopMessages(messages, limits.maxContextTokens)];
      turnCount += 1;
      if (skillWorkflowState === 'selected') skillWorkflowState = 'executing';
      await this.emit({ type: 'model_turn_started', agentRunId: command.agentRunId, turn: turnCount });
      const response = await this.modelInvoker.invoke({
        agentRunId: command.agentRunId, leaseToken: command.executionContext.leaseToken,
        modelRole: 'agent.tutor_turn',
        system: composeActiveSkillSystem(command.system, [...activeSkills.values()]),
        messages: [...messages],
        temperature: 0.2,
        maxOutputTokens: 4_096,
        tools: finalizationOnly ? [] : toolSet.providerTools,
        toolChoice: finalizationOnly
          ? 'none'
          : forceRequiredTool && requiredTool
            ? { name: providerToolName(requiredTool.name) }
            : 'auto',
        toolSchemaVersion: 'tutor-tools@2',
        preferStream: command.preferStream !== false,
        onDelta: async (text) => {
          if (text && (toolSet.providerTools.length === 0 || toolCallCount > 0 || finalizationOnly)) {
            await this.emit({ type: 'text_delta', agentRunId: command.agentRunId, text });
          }
        }
      }, gateway, signal);
      const calls = response.toolCalls ?? [];
      if (!calls.length) {
        const missingRequiredTool = requiredTool
          && !attemptedNames.has(requiredTool.name)
          ? requiredTool
          : undefined;
        if (missingRequiredTool && !finalizationOnly) {
          requiredToolRepairCount += 1;
          if (requiredToolRepairCount > 2) {
            throw new Error('模型没有发起必要的真实工具调用，本次操作未执行。');
          }
          messages.push(
            { role: ModelMessageRole.Assistant, content: response.text },
            {
              role: ModelMessageRole.User,
              content: [
                `你刚才没有发起真实的 ${missingRequiredTool.name} 工具调用。`,
                '不要用文字描述工具状态。现在必须实际调用该工具；若当前输入不足以执行，请明确说明缺少什么，不能声称操作已经开始或完成。'
              ].join('\n')
            }
          );
          forceRequiredTool = Boolean(missingRequiredTool);
          await saveCheckpoint();
          continue;
        }
        if (awaitingCompletionVerification && !finalizationOnly) {
          const verifierNames = completionVerifierNames(toolSet);
          messages.push(
            ...(response.text.trim()
              ? [{ role: ModelMessageRole.Assistant, content: response.text } as ModelMessage]
              : []),
            {
              role: ModelMessageRole.User,
              content: completionVerificationInstruction(verifierNames, completionTracker.list())
            }
          );
          await saveCheckpoint();
          continue;
        }
        if (awaitingOperationalTool && !finalizationOnly) {
          // A structured tool call is the only proof that a tool ran. This is
          // a Skill contract, so recover from prose-only output by asking the
          // model to choose an allowed operational tool. No text classification
          // is involved here.
          skillContinuationRepairCount += 1;
          if (skillContinuationRepairCount > 2) {
            throw new Error('Skill 工作流已经加载，但模型没有执行具体业务工具。');
          }
          messages.push(
            ...(response.text.trim()
              ? [{ role: ModelMessageRole.Assistant, content: response.text } as ModelMessage]
              : []),
            {
              role: ModelMessageRole.User,
              content: skillContinuationInstruction([...activeSkills.values()])
            }
          );
          await saveCheckpoint();
          continue;
        }
        if (!response.text.trim()) {
          if (awaitingOperationalTool) {
            throw new Error('Skill 工作流等待执行具体工具，模型却返回了空内容。');
          }
          if (!finalizationOnly) {
            finalizationOnly = true;
            messages.push({
              role: ModelMessageRole.User,
              content: '具体工具结果已经返回。请基于已有结果直接给用户一条简洁、完整的中文答复，不要再次调用工具，也不要输出空内容。'
            });
            await saveCheckpoint();
            continue;
          }
          const checkpoint = await saveCheckpoint();
          await this.emit({ type: 'run_completed', agentRunId: command.agentRunId, text: '操作已执行，但模型没有返回补充说明。' });
          return {
            status: delegatedCompletion ? 'delegated' : 'completed',
            text: '操作已执行，但模型没有返回补充说明。',
            checkpoint
          };
        }
        messages.push({ role: ModelMessageRole.Assistant, content: response.text });
        const guidance = await consumeAgentGuidance(command.consumeGuidance);
        if (guidance.length) {
          messages.push(...guidance);
          await saveCheckpoint();
          continue;
        }
        const checkpoint = await saveCheckpoint();
        await this.emit({ type: 'run_completed', agentRunId: command.agentRunId, text: response.text });
        return { status: delegatedCompletion ? 'delegated' : 'completed', text: response.text, checkpoint };
      }
      const toolBudget = budget.allowToolCalls(turnCount, toolCallCount, calls.length);
      if (calls.length > limits.maxToolCallsPerTurn || !toolBudget.allowed) {
        const checkpoint = await saveCheckpoint();
        await this.emit({
          type: 'run_stopped',
          agentRunId: command.agentRunId,
          reasonCode: calls.length > limits.maxToolCallsPerTurn
            ? 'agent.per_turn_tool_limit'
            : toolBudget.reasonCode ?? 'agent.tool_budget_exhausted'
        });
        return { status: 'budget_exhausted', text: response.text, checkpoint };
      }
      messages.push({
        role: ModelMessageRole.Assistant,
        content: response.text,
        toolCalls: calls
      });
      const executableCalls: Array<{
        readonly definition: AgentToolDefinition;
        readonly call: ModelToolCall;
      }> = [];
      for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
        const providerCall = calls[callIndex];
        signal?.throwIfAborted();
        toolCallCount += 1;
        const definition = toolSet.byProvider(providerCall.name);
        const call = definition
          ? { ...providerCall, name: definition.name }
          : providerCall;
        if (definition) attemptedNames.add(definition.name);
        if (requiredTool?.name === definition?.name) forceRequiredTool = false;
        await this.emit({ type: 'tool_call_requested', agentRunId: command.agentRunId, call });
        if (!definition) {
          messages.push(createToolObservationMessage(call, {
            status: 'failed',
            content: `工具不可用：${call.name}`,
            retryable: false,
            failureCode: 'agent.tool_unknown'
          }));
          await this.emit({ type: 'tool_call_failed', agentRunId: command.agentRunId, call, reasonCode: 'agent.tool_unknown' });
          continue;
        }
        const signature = agentToolSignature(call);
        const blockedRepeat = blockedRepeatReason(toolAttempts[signature]);
        if (blockedRepeat) {
          messages.push(createToolObservationMessage(call, {
            status: 'failed',
            content: blockedRepeat.message,
            retryable: false,
            failureCode: blockedRepeat.reasonCode
          }));
          await this.emit({
            type: 'tool_call_failed',
            agentRunId: command.agentRunId,
            call,
            reasonCode: blockedRepeat.reasonCode
          });
          continue;
        }
        signatures[signature] = (signatures[signature] ?? 0) + 1;
        const decision = await this.validator.evaluate(this.policy, definition, call, command.executionContext);
        if (decision.decision === AgentToolPolicyDecision.Confirm) {
          for (const deferred of executableCalls) {
            decrementToolSignature(signatures, agentToolSignature(deferred.call));
            messages.push(createToolResultMessage(
              deferred.call,
              '本轮包含需要用户确认的操作，本次工具调用未执行；确认完成后可按需重新调用。'
            ));
            await this.emit({
              type: 'tool_call_failed',
              agentRunId: command.agentRunId,
              call: deferred.call,
              reasonCode: 'agent.tool_deferred_for_confirmation'
            });
          }
          executableCalls.length = 0;
          const remainingCalls = calls.slice(callIndex + 1);
          toolCallCount += remainingCalls.length;
          for (const remainingProviderCall of remainingCalls) {
            const remainingDefinition = toolSet.byProvider(remainingProviderCall.name);
            const remainingCall = remainingDefinition
              ? { ...remainingProviderCall, name: remainingDefinition.name }
              : remainingProviderCall;
            await this.emit({ type: 'tool_call_requested', agentRunId: command.agentRunId, call: remainingCall });
            messages.push(createToolResultMessage(
              remainingCall,
              '本轮正在等待用户确认，本次工具调用未执行；确认完成后可按需重新调用。'
            ));
            await this.emit({
              type: 'tool_call_failed',
              agentRunId: command.agentRunId,
              call: remainingCall,
              reasonCode: 'agent.tool_deferred_for_confirmation'
            });
          }
          skillWorkflowState = 'waiting_user';
          const checkpoint = await saveCheckpoint(call);
          await this.emit({
            type: 'confirmation_required',
            agentRunId: command.agentRunId,
            call,
            reasonCode: decision.reasonCode
          });
          return { status: 'waiting_user', text: response.text, checkpoint };
        }
        if (decision.decision === AgentToolPolicyDecision.Reject) {
          messages.push(createToolObservationMessage(call, {
            status: 'failed',
            content: decision.message ?? `工具调用已拒绝：${decision.reasonCode}`,
            retryable: decision.retryable === true,
            failureCode: decision.reasonCode
          }));
          toolAttempts[signature] = {
            attempts: signatures[signature],
            status: 'failed',
            retryable: decision.retryable === true,
            failureCode: decision.reasonCode
          };
          await this.emit({ type: 'tool_call_failed', agentRunId: command.agentRunId, call, reasonCode: decision.reasonCode });
          continue;
        }
        executableCalls.push({ definition, call });
      }
      const toolBatch = await executeAgentToolCalls(
        this.executor,
        (event) => this.emit(event),
        {
          agentRunId: command.agentRunId,
          executionContext: command.executionContext
        },
        executableCalls,
        limits.maxParallelReadToolCalls,
        limits.maxToolResultChars,
        signal
      );
      messages.push(...toolBatch.messages);
      toolBatch.observations.forEach((observation) => {
        const signature = agentToolSignature(observation.call);
        toolAttempts[signature] = {
          attempts: signatures[signature] ?? 1,
          status: observation.status,
          retryable: observation.retryable,
          failureCode: observation.failureCode
        };
      });
      budget.recordProgress(toolBatch.progressCount);
      if (toolBatch.activateToolNames.length) toolSet.activate(toolBatch.activateToolNames);
      if (toolBatch.activateSkills.length) {
        toolBatch.activateSkills.forEach((skill) => activeSkills.set(skill.name, skill));
        budget.activate(toolBatch.activateSkills.map((skill) => skill.executionBudget));
        skillWorkflowState = 'selected';
        awaitingOperationalTool = toolBatch.activateSkills.some((skill) => skill.requiresOperationalTool);
      }
      toolBatch.completedWriteToolNames.forEach((name) => completedToolNames.add(name));
      if (hasCompletionValidator(activeSkills) && completionVerifierNames(toolSet).length) {
        completionTracker.expect(toolBatch.completionExpectations);
        awaitingCompletionVerification = completionTracker.requiresVerification;
      }
      const completionResolution = completionTracker.resolve(toolBatch.completionVerifications);
      if (completionResolution) {
        delegatedCompletion = completionResolution.kind === 'delegated';
        awaitingCompletionVerification = delegatedCompletion ? false : completionTracker.requiresVerification;
        messages.push({ role: ModelMessageRole.User, content: completionResolutionInstruction(completionResolution) });
        skillWorkflowState = 'executing';
        finalizationOnly = delegatedCompletion || !awaitingCompletionVerification;
      }
      if (toolBatch.executedOperationalTool && !awaitingCompletionVerification) {
        if (hasPendingRequiredWrite(activeSkills, toolSet, completedToolNames)) {
          skillWorkflowState = 'executing';
          awaitingOperationalTool = true;
        } else {
          skillWorkflowState = 'ready_to_finalize';
          awaitingOperationalTool = false;
        }
      }
      if (toolBatch.terminalText) {
        const checkpoint = await saveCheckpoint();
        await this.emit({ type: 'run_completed', agentRunId: command.agentRunId, text: toolBatch.terminalText });
        return { status: 'completed', text: toolBatch.terminalText, checkpoint };
      }
      await saveCheckpoint();
    }
  }

  private async save(
    agentRunId: AgentRunId,
    turnCount: number,
    toolCallCount: number,
    messages: readonly ModelMessage[],
    signatures: Readonly<Record<string, number>>,
    toolAttempts: Readonly<Record<string, AgentToolAttemptState>>,
    state: {
      readonly pendingConfirmation?: ModelToolCall;
      readonly activeSkills: readonly AgentSkillActivation[];
      readonly activeToolNames: readonly string[];
      readonly completedToolNames: readonly string[];
      readonly skillWorkflowState: AgentSkillWorkflowState;
      readonly awaitingCompletionVerification: boolean;
      readonly pendingCompletionExpectations: AgentLoopCheckpoint['pendingCompletionExpectations'];
    },
    leaseToken?: AgentToolExecutionContext['leaseToken']
  ): Promise<AgentLoopCheckpoint> {
    const checkpoint: AgentLoopCheckpoint = {
      agentRunId,
      turnCount,
      toolCallCount,
      messages: messages.map(sanitizeMessageForCheckpoint),
      toolSignatures: { ...signatures },
      toolAttempts: { ...toolAttempts },
      pendingConfirmation: state.pendingConfirmation,
      activeSkills: state.activeSkills,
      activeToolNames: state.activeToolNames,
      completedToolNames: state.completedToolNames,
      skillWorkflowState: state.skillWorkflowState,
      awaitingCompletionVerification: state.awaitingCompletionVerification,
      pendingCompletionExpectations: state.pendingCompletionExpectations
    };
    await this.checkpoints.save(checkpoint, leaseToken);
    await this.emit({ type: 'checkpoint_saved', agentRunId, turn: turnCount });
    return checkpoint;
  }

  private emit(event: Parameters<AgentRuntimeObserver['onEvent']>[0]): Promise<void> {
    const next = this.observerQueue.then(() => this.observer?.onEvent(event));
    this.observerQueue = Promise.resolve(next).catch(() => undefined);
    return Promise.resolve(next);
  }
}
