import { ModelMessageRole, type ModelMessage, type ModelToolCall, type ProviderGateway } from '@/capabilities/ai-runtime/public';
import {
  runAgentLoopContinue,
  type AgentContext as PiAgentContext,
  type AgentMessage as PiAgentMessage,
  type AgentTool as PiAgentTool
} from '@earendil-works/pi-agent-core';
import type { TSchema } from '@earendil-works/pi-ai';
import {
  AgentToolPolicyDecision,
  type AgentCheckpointStore,
  type AgentLoopCheckpoint,
  type AgentModelInvoker,
  type AgentRuntimeObserver,
  type AgentSkillWorkflowState,
  type AgentToolAttemptState,
  type AgentToolExecutionResult,
  type AgentToolExecutor,
  type AgentToolPolicy
} from '../contracts/AgentRuntimePorts';
import { AgentExecutionBudget } from '../domain/AgentExecutionBudget';
import type { AgentSkillActivation } from '../domain/AgentSkillRegistry';
import { AgentToolRisk, AgentToolRole, type AgentToolDefinition } from '../domain/AgentToolRegistry';
import { ActiveAgentToolSet, providerToolName } from './ActiveAgentToolSet';
import { AgentCompletionTracker, completionResolutionInstruction } from './AgentCompletionTracker';
import type { AgentLoopResult, AgentLoopRuntime, RunAgentLoopCommand } from './AgentLoopContracts';
import { agentToolArgumentsHash, cloneAgentToolCall } from './AgentToolCallIdentity';
import { AgentToolInvocationValidator } from './AgentToolInvocationValidator';
import {
  blockedRepeatReason,
  completionVerifierNames,
  hasCompletionValidator,
  hasPendingRequiredWrite,
  restoreToolAttempts
} from './AgentLoopStatePolicy';
import {
  agentToolSignature,
  attemptedToolNames,
  compactAgentLoopMessages,
  completionVerificationInstruction,
  composeActiveSkillSystem,
  consumeAgentGuidance,
  sanitizeMessageForCheckpoint,
  skillContinuationInstruction,
  validateAgentLoopLimits
} from './AgentLoopSupport';
import { assistantText, assistantToolCalls, toModelMessages, toPiMessages } from './pi/PiAgentMessageAdapter';
import { createPiProviderModel, createPiProviderStream } from './pi/PiAgentProviderStream';
import {
  AsyncSemaphore,
  isPiMessage,
  latestAssistant,
  piConfirmation,
  piFailure,
  resultMadeProgress,
  toModelToolCall,
  toPiUserMessage,
  toolObservation,
  type PiToolDetails
} from './pi/PiAgentRuntimeSupport';

export class PiAgentLoopRuntime implements AgentLoopRuntime {
  private observerQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly modelInvoker: AgentModelInvoker,
    private readonly policy: AgentToolPolicy,
    private readonly executor: AgentToolExecutor,
    private readonly checkpoints: AgentCheckpointStore,
    private readonly observer?: AgentRuntimeObserver,
    private readonly validator = new AgentToolInvocationValidator()
  ) {}
  async execute(command: RunAgentLoopCommand, gateway: ProviderGateway, signal?: AbortSignal): Promise<AgentLoopResult> {
    const limits = validateAgentLoopLimits(command);
    const toolSet = new ActiveAgentToolSet(command.tools, command.availableTools);
    toolSet.activate(command.checkpoint?.activeToolNames ?? []);
    const activeSkills = new Map<string, AgentSkillActivation>();
    [...(command.skills ?? []), ...(command.checkpoint?.activeSkills ?? [])]
      .forEach((skill) => activeSkills.set(skill.name, skill));
    const signatures = { ...(command.checkpoint?.toolSignatures ?? {}) };
    const toolAttempts = restoreToolAttempts(signatures, command.checkpoint?.toolAttempts);
    const attemptedNames = attemptedToolNames(signatures, toolSet.names);
    const completedToolNames = new Set(command.checkpoint?.completedToolNames ?? []);
    const completionTracker = new AgentCompletionTracker(command.checkpoint?.pendingCompletionExpectations);
    const budget = new AgentExecutionBudget(limits, [...activeSkills.values()].map((skill) => skill.executionBudget));
    if (Object.keys(signatures).length) budget.recordProgress(Object.keys(signatures).length);
    const requiredTool = command.requiredToolName ? toolSet.byName(command.requiredToolName) : undefined;
    if (command.requiredToolName && !requiredTool) {
      throw new Error(`Required Agent tool is unavailable: ${command.requiredToolName}`);
    }
    let turnCount = command.checkpoint?.turnCount ?? 0;
    let toolCallCount = command.checkpoint?.toolCallCount ?? 0;
    let turnToolCallCount = 0;
    let pendingConfirmation: ModelToolCall | undefined;
    let skillWorkflowState: AgentSkillWorkflowState = command.checkpoint?.skillWorkflowState
      ?? (activeSkills.size ? 'selected' : 'idle');
    let awaitingOperationalTool = [...activeSkills.values()].some((skill) => skill.requiresOperationalTool)
      && (skillWorkflowState === 'selected' || skillWorkflowState === 'executing');
    let awaitingCompletionVerification = completionTracker.requiresVerification;
    let delegatedCompletion = false;
    let finalizationOnly = false;
    let terminalText: string | undefined;
    let stopReason: string | undefined;
    let forceRequiredTool = Boolean(command.forceRequiredToolOnFirstTurn && requiredTool);
    let requiredToolRepairCount = 0;
    let skillRepairCount = 0;
    let emptyResponseRepairCount = 0;
    let latestContext: PiAgentContext;
    const blockedToolCalls = new Map<string, string>();
    const internalGuidance: PiAgentMessage[] = [];
    const readToolLimiter = new AsyncSemaphore(limits.maxParallelReadToolCalls);
    let modelMessages = [...(command.checkpoint?.messages ?? command.messages)];
    await this.emit({ type: 'run_started', agentRunId: command.agentRunId });
    if (command.checkpoint?.pendingConfirmation) {
      modelMessages = await this.resumePendingConfirmation({
        command,
        call: command.checkpoint.pendingConfirmation,
        toolSet,
        signatures,
        toolAttempts,
        completedToolNames,
        completionTracker,
        modelMessages,
        signal
      });
      awaitingCompletionVerification = completionTracker.requiresVerification;
      skillWorkflowState = 'ready_to_finalize';
      awaitingOperationalTool = false;
    }

    const buildPiTools = (): PiAgentTool[] => finalizationOnly
      ? []
      : [...toolSet.names].map((name) => this.createPiTool({
          command,
          definition: toolSet.byName(name)!,
          toolSet,
          activeSkills,
          signatures,
          toolAttempts,
          attemptedNames,
          completedToolNames,
          completionTracker,
          budget,
          blockedToolCalls,
          readToolLimiter,
          maxToolResultChars: limits.maxToolResultChars,
          isConfirmationPending: () => Boolean(pendingConfirmation),
          onConfirmation: (call) => {
            pendingConfirmation = call;
            skillWorkflowState = 'waiting_user';
          },
          onTerminalText: (text) => { terminalText = text; },
          onSkillState: (state) => {
            skillWorkflowState = state.skillWorkflowState;
            awaitingOperationalTool = state.awaitingOperationalTool;
            awaitingCompletionVerification = state.awaitingCompletionVerification;
            delegatedCompletion = state.delegatedCompletion;
            finalizationOnly = state.finalizationOnly;
            if (state.guidance) internalGuidance.push(toPiUserMessage(state.guidance));
          },
          signal
        }));

    latestContext = { systemPrompt: composeActiveSkillSystem(command.system, [...activeSkills.values()]),
      messages: toPiMessages(modelMessages), tools: buildPiTools() };
    let providerFailure: unknown;
    const providerStream = createPiProviderStream({
      command,
      gateway,
      invoker: this.modelInvoker,
      toolChoice: () => finalizationOnly
        ? 'none'
        : forceRequiredTool && requiredTool
          ? { name: providerToolName(requiredTool.name) }
          : 'auto',
      onError: (error) => { providerFailure = error; }
    });

    let bufferedTurnText = '';
    let streamedTurnText = false;
    const emittedMessages = await runAgentLoopContinue(latestContext, {
      model: createPiProviderModel(gateway, limits.maxContextTokens),
      convertToLlm: (messages) => messages.filter(isPiMessage),
      transformContext: async (messages) => toPiMessages(compactAgentLoopMessages(
        toModelMessages(messages),
        limits.maxContextTokens - 4_096
      )),
      toolExecution: 'parallel',
      beforeToolCall: async ({ toolCall }) => {
        const blocked = blockedToolCalls.get(toolCall.id);
        return blocked ? { block: true, reason: blocked } : undefined;
      },
      afterToolCall: async ({ result }) => {
        const details = result.details as PiToolDetails | undefined;
        return details ? {
          isError: details.isError,
          terminate: details.terminate
        } : undefined;
      },
      prepareNextTurn: async ({ context }) => {
        latestContext = context;
        return {
          context: {
            ...context,
            systemPrompt: composeActiveSkillSystem(command.system, [...activeSkills.values()]),
            tools: buildPiTools()
          }
        };
      },
      getSteeringMessages: async () => {
        const external = await consumeAgentGuidance(command.consumeGuidance);
        return [...internalGuidance.splice(0), ...toPiMessages(external)];
      },
      getFollowUpMessages: async () => {
        if (pendingConfirmation || terminalText || stopReason) return [];
        const guidance = await consumeAgentGuidance(command.consumeGuidance);
        if (guidance.length) return toPiMessages(guidance);
        if (requiredTool && !attemptedNames.has(requiredTool.name) && !finalizationOnly) {
          requiredToolRepairCount += 1;
          if (requiredToolRepairCount > 2) {
            throw new Error('模型没有发起必要的真实工具调用，本次操作未执行。');
          }
          forceRequiredTool = true;
          return [toPiUserMessage([
            `你尚未发起必要的 ${requiredTool.name} 工具调用。`,
            '请根据现有证据实际调用该工具；如果缺少执行所必需的信息，只询问用户缺失信息，不能声称已经开始或完成。'
          ].join('\n'))];
        }
        if (awaitingCompletionVerification && !finalizationOnly) {
          return [toPiUserMessage(completionVerificationInstruction(
            completionVerifierNames(toolSet),
            completionTracker.list()
          ))];
        }
        if (awaitingOperationalTool && !finalizationOnly) {
          skillRepairCount += 1;
          if (skillRepairCount > 2) throw new Error('Skill 工作流已经加载，但模型没有执行具体业务工具。');
          return [toPiUserMessage(skillContinuationInstruction([...activeSkills.values()]))];
        }
        const latest = latestAssistant(latestContext.messages);
        if (latest && !assistantText(latest).trim() && emptyResponseRepairCount < 1) {
          emptyResponseRepairCount += 1;
          finalizationOnly = true;
          return [toPiUserMessage('请基于已有工具结果直接给用户一条简洁完整的中文答复，不要输出内部工具状态。')];
        }
        return [];
      },
      shouldStopAfterTurn: async ({ context }) => {
        latestContext = context;
        const nextBudget = budget.allowNextTurn(turnCount, toolCallCount);
        if (!nextBudget.allowed) stopReason = nextBudget.reasonCode ?? 'agent.execution_budget_exhausted';
        await this.save(command, context.messages, turnCount, toolCallCount, signatures, toolAttempts, {
          pendingConfirmation,
          activeSkills: [...activeSkills.values()],
          activeToolNames: [...toolSet.names],
          completedToolNames: [...completedToolNames],
          skillWorkflowState,
          awaitingCompletionVerification,
          pendingCompletionExpectations: completionTracker.list()
        });
        return Boolean(pendingConfirmation || terminalText || stopReason);
      }
    }, async (event) => {
      if (event.type === 'turn_start') {
        turnCount += 1;
        turnToolCallCount = 0;
        bufferedTurnText = '';
        streamedTurnText = false;
        if (skillWorkflowState === 'selected') skillWorkflowState = 'executing';
        await this.emit({ type: 'model_turn_started', agentRunId: command.agentRunId, turn: turnCount });
      }
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        bufferedTurnText += event.assistantMessageEvent.delta;
        if (toolCallCount > 0 || finalizationOnly || !latestContext.tools?.length) {
          streamedTurnText = true;
          await this.emit({
            type: 'text_delta',
            agentRunId: command.agentRunId,
            text: event.assistantMessageEvent.delta
          });
        }
      }
      if (
        event.type === 'message_end'
        && event.message.role === 'assistant'
        && !assistantToolCalls(event.message).length
        && bufferedTurnText
        && !streamedTurnText
      ) {
        await this.emit({ type: 'text_delta', agentRunId: command.agentRunId, text: bufferedTurnText });
      }
      if (event.type === 'tool_execution_start') {
        turnToolCallCount += 1;
        toolCallCount += 1;
        const definition = toolSet.byProvider(event.toolName);
        const call = toModelToolCall(event.toolCallId, definition?.name ?? event.toolName, event.args);
        if (definition) attemptedNames.add(definition.name);
        if (requiredTool?.name === definition?.name) forceRequiredTool = false;
        if (turnToolCallCount > limits.maxToolCallsPerTurn) {
          blockedToolCalls.set(event.toolCallId, '本轮工具调用数量超过上限，请缩小步骤后继续。');
        } else {
          const decision = budget.allowToolCalls(turnCount, toolCallCount - 1, 1);
          if (!decision.allowed) {
            blockedToolCalls.set(event.toolCallId, '本次 Agent 执行预算已耗尽。');
            stopReason = decision.reasonCode ?? 'agent.tool_budget_exhausted';
          }
        }
        await this.emit({ type: 'tool_call_requested', agentRunId: command.agentRunId, call });
      }
    }, signal, providerStream);

    const finalMessages = latestContext.messages.length
      ? latestContext.messages
      : emittedMessages;
    const latest = latestAssistant(finalMessages);
    if (latest?.stopReason === 'error' || latest?.stopReason === 'aborted') {
      throw providerFailure ?? new Error(latest.errorMessage || 'Agent 模型调用失败');
    }
    const text = terminalText || (latest ? assistantText(latest) : '') || '操作已执行，但模型没有返回补充说明。';
    const checkpoint = await this.save(command, finalMessages, turnCount, toolCallCount, signatures, toolAttempts, {
      pendingConfirmation,
      activeSkills: [...activeSkills.values()],
      activeToolNames: [...toolSet.names],
      completedToolNames: [...completedToolNames],
      skillWorkflowState,
      awaitingCompletionVerification,
      pendingCompletionExpectations: completionTracker.list()
    });
    if (pendingConfirmation) return { status: 'waiting_user', text, checkpoint };
    if (stopReason) {
      await this.emit({ type: 'run_stopped', agentRunId: command.agentRunId, reasonCode: stopReason });
      return { status: 'budget_exhausted', text, checkpoint };
    }
    await this.emit({ type: 'run_completed', agentRunId: command.agentRunId, text });
    return { status: delegatedCompletion ? 'delegated' : 'completed', text, checkpoint };
  }

  private createPiTool(input: {
    readonly command: RunAgentLoopCommand;
    readonly definition: AgentToolDefinition;
    readonly toolSet: ActiveAgentToolSet;
    readonly activeSkills: Map<string, AgentSkillActivation>;
    readonly signatures: Record<string, number>;
    readonly toolAttempts: Record<string, AgentToolAttemptState>;
    readonly attemptedNames: Set<string>;
    readonly completedToolNames: Set<string>;
    readonly completionTracker: AgentCompletionTracker;
    readonly budget: AgentExecutionBudget;
    readonly blockedToolCalls: Map<string, string>;
    readonly readToolLimiter: AsyncSemaphore;
    readonly maxToolResultChars: number;
    readonly isConfirmationPending: () => boolean;
    readonly onConfirmation: (call: ModelToolCall) => void;
    readonly onTerminalText: (text: string) => void;
    readonly onSkillState: (state: {
      readonly skillWorkflowState: AgentSkillWorkflowState;
      readonly awaitingOperationalTool: boolean;
      readonly awaitingCompletionVerification: boolean;
      readonly delegatedCompletion: boolean;
      readonly finalizationOnly: boolean;
      readonly guidance?: string;
    }) => void;
    readonly signal?: AbortSignal;
  }): PiAgentTool {
    const { definition } = input;
    return {
      name: providerToolName(definition.name),
      label: definition.description,
      description: definition.description,
      parameters: definition.inputSchema as unknown as TSchema,
      executionMode: definition.risk === AgentToolRisk.Read ? 'parallel' : 'sequential',
      execute: async (toolCallId, params, toolSignal) => {
        const call = toModelToolCall(toolCallId, definition.name, params);
        if (input.isConfirmationPending()) return piFailure(call, '已暂停同轮后续工具，等待用户确认。', 'agent.tool_deferred_for_confirmation', false, true);
        const blocked = input.blockedToolCalls.get(toolCallId);
        if (blocked) return piFailure(call, blocked, 'agent.execution_budget_exhausted', false, true);
        const signature = agentToolSignature(call);
        const repeated = blockedRepeatReason(input.toolAttempts[signature]);
        if (repeated) return piFailure(call, repeated.message, repeated.reasonCode, false);
        input.signatures[signature] = (input.signatures[signature] ?? 0) + 1;
        const decision = await this.validator.evaluate(this.policy, definition, call, input.command.executionContext);
        if (decision.decision === AgentToolPolicyDecision.Confirm) {
          input.onConfirmation(call);
          await this.emit({
            type: 'confirmation_required',
            agentRunId: input.command.agentRunId,
            call,
            reasonCode: decision.reasonCode
          });
          return piConfirmation(call, decision.message || '此操作需要用户确认。');
        }
        if (decision.decision === AgentToolPolicyDecision.Reject) {
          input.toolAttempts[signature] = {
            attempts: input.signatures[signature],
            status: 'failed',
            retryable: decision.retryable === true,
            failureCode: decision.reasonCode
          };
          await this.emit({
            type: 'tool_call_failed',
            agentRunId: input.command.agentRunId,
            call,
            reasonCode: decision.reasonCode
          });
          return piFailure(call, decision.message || '工具调用已拒绝。', decision.reasonCode, decision.retryable === true);
        }
        await this.emit({ type: 'tool_call_started', agentRunId: input.command.agentRunId, call });
        let result: AgentToolExecutionResult;
        const release = definition.risk === AgentToolRisk.Read
          ? await input.readToolLimiter.acquire(toolSignal ?? input.signal)
          : () => undefined;
        try {
          result = await this.executor.execute(definition, call, {
            ...input.command.executionContext,
            signal: toolSignal ?? input.signal
          });
        } catch (error) {
          if ((toolSignal ?? input.signal)?.aborted) throw error;
          result = {
            content: `工具执行失败：${error instanceof Error ? error.message : String(error)}`,
            isError: true,
            failureCode: 'agent.tool_execution_failed',
            retryable: true
          };
        } finally {
          release();
        }
        this.applyToolResult(input, definition, call, result);
        const madeProgress = !result.isError && resultMadeProgress(result);
        input.toolAttempts[signature] = {
          attempts: input.signatures[signature],
          status: result.isError ? 'failed' : madeProgress ? 'succeeded' : 'no_progress',
          retryable: result.isError ? result.retryable !== false : !madeProgress,
          failureCode: result.failureCode
        };
        await this.emit(result.isError
          ? { type: 'tool_call_failed', agentRunId: input.command.agentRunId, call, reasonCode: result.failureCode || 'agent.tool_execution_error' }
          : { type: 'tool_call_succeeded', agentRunId: input.command.agentRunId, call, resultRef: result.resultRef });
        return {
          content: [{ type: 'text', text: toolObservation(result, madeProgress, input.maxToolResultChars) }],
          details: {
            call,
            status: result.isError ? 'failed' : madeProgress ? 'succeeded' : 'no_progress',
            isError: Boolean(result.isError),
            retryable: result.isError ? result.retryable !== false : !madeProgress,
            failureCode: result.failureCode,
            resultRef: result.resultRef,
            terminate: Boolean(result.terminalText)
          } satisfies PiToolDetails,
          addedToolNames: result.activateToolNames?.map(providerToolName),
          terminate: Boolean(result.terminalText)
        };
      }
    };
  }

  private applyToolResult(
    input: Parameters<PiAgentLoopRuntime['createPiTool']>[0],
    definition: AgentToolDefinition,
    call: ModelToolCall,
    result: AgentToolExecutionResult
  ): void {
    const madeProgress = !result.isError && resultMadeProgress(result);
    if (madeProgress) input.budget.recordProgress();
    if (result.activateToolNames?.length) input.toolSet.activate(result.activateToolNames);
    if (result.activateSkills?.length) {
      result.activateSkills.forEach((skill) => input.activeSkills.set(skill.name, skill));
      input.budget.activate(result.activateSkills.map((skill) => skill.executionBudget));
    }
    if (definition.risk !== AgentToolRisk.Read && madeProgress) input.completedToolNames.add(definition.name);
    if (hasCompletionValidator(input.activeSkills) && result.completionExpectation) {
      input.completionTracker.expect([result.completionExpectation]);
    }
    const resolution = result.completionVerification
      ? input.completionTracker.resolve([result.completionVerification])
      : undefined;
    const delegatedCompletion = resolution?.kind === 'delegated';
    const awaitingCompletionVerification = delegatedCompletion ? false : input.completionTracker.requiresVerification;
    const selectedSkill = Boolean(result.activateSkills?.length);
    const executedOperationalTool = definition.role !== AgentToolRole.SkillSelector && madeProgress;
    const pendingRequiredWrite = hasPendingRequiredWrite(input.activeSkills, input.toolSet, input.completedToolNames);
    input.onSkillState({
      skillWorkflowState: selectedSkill
        ? 'selected'
        : executedOperationalTool && !awaitingCompletionVerification && !pendingRequiredWrite
          ? 'ready_to_finalize'
          : 'executing',
      awaitingOperationalTool: selectedSkill
        ? Boolean(result.activateSkills?.some((skill) => skill.requiresOperationalTool))
        : executedOperationalTool && pendingRequiredWrite,
      awaitingCompletionVerification,
      delegatedCompletion,
      finalizationOnly: Boolean(resolution && (delegatedCompletion || !awaitingCompletionVerification)),
      guidance: resolution ? completionResolutionInstruction(resolution) : undefined
    });
    if (result.terminalText) input.onTerminalText(result.terminalText);
    input.attemptedNames.add(definition.name);
    void call;
  }

  private async resumePendingConfirmation(input: {
    readonly command: RunAgentLoopCommand;
    readonly call: ModelToolCall;
    readonly toolSet: ActiveAgentToolSet;
    readonly signatures: Record<string, number>;
    readonly toolAttempts: Record<string, AgentToolAttemptState>;
    readonly completedToolNames: Set<string>;
    readonly completionTracker: AgentCompletionTracker;
    readonly modelMessages: readonly ModelMessage[];
    readonly signal?: AbortSignal;
  }): Promise<ModelMessage[]> {
    const definition = input.toolSet.byName(input.call.name);
    if (!definition) throw new Error(`Pending Agent tool is unavailable: ${input.call.name}`);
    if (!input.command.confirmationDecision) throw new Error('Pending Agent tool requires an explicit confirmation decision');
    if (
      input.command.checkpoint?.pendingConfirmationArgumentsHash
      && input.command.checkpoint.pendingConfirmationArgumentsHash !== agentToolArgumentsHash(input.call)
    ) throw new Error('Pending Agent tool arguments changed after confirmation was requested');
    const messages = [...input.modelMessages];
    const signature = agentToolSignature(input.call);
    if (input.command.confirmationDecision === 'reject') {
      messages.push({ role: ModelMessageRole.Tool, toolCallId: input.call.id, content: '用户已取消本次工具调用。' });
      input.toolAttempts[signature] = {
        attempts: input.signatures[signature] ?? 1,
        status: 'failed',
        retryable: false,
        failureCode: 'agent.tool_rejected_by_user'
      };
      return messages;
    }
    await this.emit({ type: 'tool_call_started', agentRunId: input.command.agentRunId, call: input.call });
    const result = await this.executor.execute(definition, input.call, {
      ...input.command.executionContext,
      signal: input.signal
    });
    const madeProgress = !result.isError && resultMadeProgress(result);
    input.toolAttempts[signature] = {
      attempts: input.signatures[signature] ?? 1,
      status: result.isError ? 'failed' : madeProgress ? 'succeeded' : 'no_progress',
      retryable: result.isError ? result.retryable !== false : !madeProgress,
      failureCode: result.failureCode
    };
    if (madeProgress && definition.risk !== AgentToolRisk.Read) input.completedToolNames.add(definition.name);
    if (result.completionExpectation) input.completionTracker.expect([result.completionExpectation]);
    messages.push({
      role: ModelMessageRole.Tool,
      toolCallId: input.call.id,
      content: toolObservation(result, madeProgress, 6_000)
    });
    return messages;
  }

  private async save(
    command: RunAgentLoopCommand,
    messages: readonly PiAgentMessage[],
    turnCount: number,
    toolCallCount: number,
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
    }
  ): Promise<AgentLoopCheckpoint> {
    const checkpoint: AgentLoopCheckpoint = {
      agentRunId: command.agentRunId,
      turnCount,
      toolCallCount,
      messages: toModelMessages(messages, { omitToolResultId: state.pendingConfirmation?.id })
        .map(sanitizeMessageForCheckpoint),
      toolSignatures: { ...signatures },
      toolAttempts: { ...toolAttempts },
      pendingConfirmation: state.pendingConfirmation ? cloneAgentToolCall(state.pendingConfirmation) : undefined,
      pendingConfirmationArgumentsHash: state.pendingConfirmation
        ? agentToolArgumentsHash(state.pendingConfirmation)
        : undefined,
      activeSkills: state.activeSkills,
      activeToolNames: state.activeToolNames,
      completedToolNames: state.completedToolNames,
      skillWorkflowState: state.skillWorkflowState,
      awaitingCompletionVerification: state.awaitingCompletionVerification,
      pendingCompletionExpectations: state.pendingCompletionExpectations
    };
    await this.checkpoints.save(checkpoint, command.executionContext.leaseToken);
    await this.emit({ type: 'checkpoint_saved', agentRunId: command.agentRunId, turn: turnCount });
    return checkpoint;
  }

  private emit(event: Parameters<AgentRuntimeObserver['onEvent']>[0]): Promise<void> {
    const next = this.observerQueue.then(() => this.observer?.onEvent(event));
    this.observerQueue = Promise.resolve(next).catch(() => undefined);
    return Promise.resolve(next);
  }
}
