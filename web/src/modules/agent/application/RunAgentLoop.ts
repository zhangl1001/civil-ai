import {
  ModelMessageRole,
  type ModelMessage,
  type ModelToolCall,
  type ProviderGateway
} from '@/capabilities/ai-runtime/public';
import type { AgentRunId } from '@/kernel/public';
import type {
  AgentCheckpointStore,
  AgentLoopCheckpoint,
  AgentModelInvoker,
  AgentRuntimeObserver,
  AgentToolExecutionContext,
  AgentToolExecutor,
  AgentToolPolicy
} from '../contracts/AgentRuntimePorts';
import { AgentToolPolicyDecision } from '../contracts/AgentRuntimePorts';
import { AgentToolRisk, type AgentToolDefinition } from '../domain/AgentToolRegistry';
import { ActiveAgentToolSet, providerToolName } from './ActiveAgentToolSet';

export interface RunAgentLoopCommand {
  readonly agentRunId: AgentRunId;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly AgentToolDefinition[];
  /** Superset of tools that may be activated by a catalog-selection tool. */
  readonly availableTools?: readonly AgentToolDefinition[];
  readonly executionContext: AgentToolExecutionContext;
  readonly checkpoint?: AgentLoopCheckpoint;
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxToolCallsPerTurn?: number;
  readonly maxParallelReadToolCalls?: number;
  readonly maxToolResultChars?: number;
  readonly confirmationDecision?: 'confirm' | 'reject';
  readonly preferStream?: boolean;
  readonly requiredToolCode?: string;
  readonly forceRequiredToolOnFirstTurn?: boolean;
  readonly consumeGuidance?: () => readonly ModelMessage[] | Promise<readonly ModelMessage[]>;
}

export interface AgentLoopResult {
  readonly status: 'completed' | 'waiting_user' | 'budget_exhausted';
  readonly text: string;
  readonly checkpoint: AgentLoopCheckpoint;
}

interface ToolCallOutcome {
  readonly message: ModelMessage;
  readonly terminalText?: string;
  readonly activateToolCodes?: readonly string[];
}

interface ToolCallBatch {
  readonly messages: readonly ModelMessage[];
  readonly terminalText?: string;
  readonly activateToolCodes: readonly string[];
}

/** Provider-neutral, bounded Agent loop. Business writes remain behind typed tool executors. */
export class RunAgentLoop {
  private observerQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly modelInvoker: AgentModelInvoker,
    private readonly policy: AgentToolPolicy,
    private readonly executor: AgentToolExecutor,
    private readonly checkpoints: AgentCheckpointStore,
    private readonly observer?: AgentRuntimeObserver
  ) {}

  async execute(
    command: RunAgentLoopCommand,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<AgentLoopResult> {
    const limits = validateLimits(command);
    const toolSet = new ActiveAgentToolSet(command.tools, command.availableTools);
    const messages = [...(command.checkpoint?.messages ?? command.messages)];
    const signatures = { ...(command.checkpoint?.toolSignatures ?? {}) };
    const requiredTool = command.requiredToolCode
      ? toolSet.byCode(command.requiredToolCode)
      : undefined;
    if (command.requiredToolCode && !requiredTool) {
      throw new Error(`Required Agent tool is unavailable: ${command.requiredToolCode}`);
    }
    const attemptedToolCodes = attemptedCodes(signatures, toolSet.codes);
    let turnCount = command.checkpoint?.turnCount ?? 0;
    let toolCallCount = command.checkpoint?.toolCallCount ?? 0;
    let finalizationOnly = false;
    let requiredToolRepairCount = 0;
    let forceRequiredTool = Boolean(command.forceRequiredToolOnFirstTurn && requiredTool);
    await this.emit({ type: 'run_started', agentRunId: command.agentRunId });

    const pendingConfirmation = command.checkpoint?.pendingConfirmation;
    if (pendingConfirmation) {
      const definition = toolSet.byCode(pendingConfirmation.name);
      if (!definition) throw new Error(`Pending Agent tool is unavailable: ${pendingConfirmation.name}`);
      if (!command.confirmationDecision) {
        throw new Error('Pending Agent tool requires an explicit confirmation decision');
      }
      if (command.confirmationDecision === 'reject') {
        messages.push(toolMessage(pendingConfirmation, '用户已取消本次工具调用。'));
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
          messages.push(toolMessage(pendingConfirmation, limitToolResult(result.content, limits.maxToolResultChars)));
          if (result.isError) {
            await this.emit({
              type: 'tool_call_failed',
              agentRunId: command.agentRunId,
              call: pendingConfirmation,
              reasonCode: 'agent.tool_execution_error'
            });
          } else {
            await this.emit({
              type: 'tool_call_succeeded',
              agentRunId: command.agentRunId,
              call: pendingConfirmation,
              resultRef: result.resultRef
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          messages.push(toolMessage(pendingConfirmation, limitToolResult(`工具执行失败：${message}`, limits.maxToolResultChars)));
          await this.emit({
            type: 'tool_call_failed',
            agentRunId: command.agentRunId,
            call: pendingConfirmation,
            reasonCode: 'agent.tool_execution_failed'
          });
        }
      }
      await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
    }

    while (turnCount < limits.maxTurns) {
      signal?.throwIfAborted();
      messages.push(...await consumeGuidance(command.consumeGuidance));
      turnCount += 1;
      await this.emit({ type: 'model_turn_started', agentRunId: command.agentRunId, turn: turnCount });
      const response = await this.modelInvoker.invoke({
        agentRunId: command.agentRunId,
        modelRole: 'agent.tutor_turn',
        system: command.system,
        messages: [...messages],
        temperature: 0.2,
        maxOutputTokens: 4_096,
        tools: finalizationOnly ? [] : toolSet.providerTools,
        toolChoice: finalizationOnly
          ? 'none'
          : forceRequiredTool && requiredTool
            ? { name: providerToolName(requiredTool.code) }
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
          && !attemptedToolCodes.has(requiredTool.code)
          && !isHonestToolDeferral(response.text)
          ? requiredTool
          : undefined;
        const unsupportedToolClaim = claimedUnattemptedTool(response.text, toolSet.codes, attemptedToolCodes);
        if ((missingRequiredTool || unsupportedToolClaim) && !finalizationOnly) {
          requiredToolRepairCount += 1;
          if (requiredToolRepairCount > 2) {
            throw new Error('模型没有发起必要的真实工具调用，本次操作未执行。');
          }
          messages.push(
            { role: ModelMessageRole.Assistant, content: response.text },
            {
              role: ModelMessageRole.User,
              content: repairToolInstruction(missingRequiredTool?.code ?? unsupportedToolClaim!)
            }
          );
          forceRequiredTool = Boolean(missingRequiredTool);
          await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
          continue;
        }
        if (!response.text.trim()) {
          if (!finalizationOnly) {
            finalizationOnly = true;
            messages.push({
              role: ModelMessageRole.User,
              content: '工具结果已经返回。请基于已有结果直接给用户一条简洁、完整的中文答复，不要再次调用工具，也不要输出空内容。'
            });
            await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
            continue;
          }
          const checkpoint = await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
          await this.emit({ type: 'run_completed', agentRunId: command.agentRunId, text: '工具已执行完成，但模型没有返回补充说明。' });
          return {
            status: 'completed',
            text: '工具已执行完成，但模型没有返回补充说明。',
            checkpoint
          };
        }
        messages.push({ role: ModelMessageRole.Assistant, content: response.text });
        if (turnCount < limits.maxTurns) {
          const guidance = await consumeGuidance(command.consumeGuidance);
          if (guidance.length) {
            messages.push(...guidance);
            await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
            continue;
          }
        }
        const checkpoint = await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
        await this.emit({ type: 'run_completed', agentRunId: command.agentRunId, text: response.text });
        return { status: 'completed', text: response.text, checkpoint };
      }
      if (calls.length > limits.maxToolCallsPerTurn || toolCallCount + calls.length > limits.maxToolCalls) {
        const checkpoint = await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
        await this.emit({ type: 'run_stopped', agentRunId: command.agentRunId, reasonCode: 'agent.tool_budget_exhausted' });
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
          ? { ...providerCall, name: definition.code }
          : providerCall;
        if (definition) attemptedToolCodes.add(definition.code);
        if (requiredTool?.code === definition?.code) forceRequiredTool = false;
        await this.emit({ type: 'tool_call_requested', agentRunId: command.agentRunId, call });
        if (!definition) {
          messages.push(toolMessage(call, `工具不可用：${call.name}`));
          await this.emit({ type: 'tool_call_failed', agentRunId: command.agentRunId, call, reasonCode: 'agent.tool_unknown' });
          continue;
        }
        const signature = toolSignature(call);
        signatures[signature] = (signatures[signature] ?? 0) + 1;
        if (signatures[signature] > 1) {
          messages.push(toolMessage(call, '相同工具和参数已经执行过，请使用已有结果或调整方案。'));
          await this.emit({ type: 'tool_call_failed', agentRunId: command.agentRunId, call, reasonCode: 'agent.tool_duplicate' });
          continue;
        }
        const decision = await this.policy.evaluate(definition, call, command.executionContext);
        if (decision.decision === AgentToolPolicyDecision.Confirm) {
          for (const deferred of executableCalls) {
            decrementSignature(signatures, toolSignature(deferred.call));
            messages.push(toolMessage(
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
              ? { ...remainingProviderCall, name: remainingDefinition.code }
              : remainingProviderCall;
            await this.emit({ type: 'tool_call_requested', agentRunId: command.agentRunId, call: remainingCall });
            messages.push(toolMessage(
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
          const checkpoint = await this.save(
            command.agentRunId,
            turnCount,
            toolCallCount,
            messages,
            signatures,
            call
          );
          await this.emit({
            type: 'confirmation_required',
            agentRunId: command.agentRunId,
            call,
            reasonCode: decision.reasonCode
          });
          return { status: 'waiting_user', text: response.text, checkpoint };
        }
        if (decision.decision === AgentToolPolicyDecision.Reject) {
          messages.push(toolMessage(call, `工具调用已拒绝：${decision.reasonCode}`));
          await this.emit({ type: 'tool_call_failed', agentRunId: command.agentRunId, call, reasonCode: decision.reasonCode });
          continue;
        }
        executableCalls.push({ definition, call });
      }
      const toolBatch = await this.executeToolCalls(
        command,
        executableCalls,
        limits.maxParallelReadToolCalls,
        limits.maxToolResultChars,
        signal
      );
      messages.push(...toolBatch.messages);
      if (toolBatch.activateToolCodes.length) toolSet.activate(toolBatch.activateToolCodes);
      if (toolBatch.terminalText) {
        const checkpoint = await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
        await this.emit({ type: 'run_completed', agentRunId: command.agentRunId, text: toolBatch.terminalText });
        return { status: 'completed', text: toolBatch.terminalText, checkpoint };
      }
      await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
    }

    const checkpoint = await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
    await this.emit({ type: 'run_stopped', agentRunId: command.agentRunId, reasonCode: 'agent.turn_budget_exhausted' });
    return { status: 'budget_exhausted', text: '', checkpoint };
  }

  private async executeToolCalls(
    command: RunAgentLoopCommand,
    calls: readonly {
      readonly definition: AgentToolDefinition;
      readonly call: ModelToolCall;
    }[],
    maxParallelReads: number,
    maxResultChars: number,
    signal?: AbortSignal
  ): Promise<ToolCallBatch> {
    const messages: ModelMessage[] = [];
    let terminalText: string | undefined;
    const activateToolCodes = new Set<string>();
    let cursor = 0;
    while (cursor < calls.length) {
      signal?.throwIfAborted();
      const current = calls[cursor];
      if (current.definition.risk !== AgentToolRisk.Read) {
        const outcome = await this.executeToolCall(command, current, maxResultChars, signal);
        messages.push(outcome.message);
        terminalText ||= outcome.terminalText;
        outcome.activateToolCodes?.forEach((code) => activateToolCodes.add(code));
        cursor += 1;
        if (terminalText) break;
        continue;
      }
      const readBatch = [];
      while (
        cursor < calls.length
        && calls[cursor].definition.risk === AgentToolRisk.Read
        && readBatch.length < maxParallelReads
      ) {
        readBatch.push(calls[cursor]);
        cursor += 1;
      }
      const batchOutcomes = await Promise.all(
        readBatch.map((entry) => this.executeToolCall(command, entry, maxResultChars, signal))
      );
      messages.push(...batchOutcomes.map((outcome) => outcome.message));
      terminalText ||= batchOutcomes.find((outcome) => outcome.terminalText)?.terminalText;
      batchOutcomes.forEach((outcome) => outcome.activateToolCodes?.forEach((code) => activateToolCodes.add(code)));
    }
    return { messages, terminalText, activateToolCodes: [...activateToolCodes] };
  }

  private async executeToolCall(
    command: RunAgentLoopCommand,
    entry: {
      readonly definition: AgentToolDefinition;
      readonly call: ModelToolCall;
    },
    maxResultChars: number,
    signal?: AbortSignal
  ): Promise<ToolCallOutcome> {
    const { definition, call } = entry;
    await this.emit({ type: 'tool_call_started', agentRunId: command.agentRunId, call });
    try {
      const result = await this.executor.execute(definition, call, {
        ...command.executionContext,
        signal
      });
      if (result.isError) {
        await this.emit({
          type: 'tool_call_failed',
          agentRunId: command.agentRunId,
          call,
          reasonCode: 'agent.tool_execution_error'
        });
      } else {
        await this.emit({
          type: 'tool_call_succeeded',
          agentRunId: command.agentRunId,
          call,
          resultRef: result.resultRef
        });
      }
      return {
        message: toolMessage(call, limitToolResult(result.content, maxResultChars)),
        terminalText: result.terminalText,
        activateToolCodes: result.activateToolCodes
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.emit({
        type: 'tool_call_failed',
        agentRunId: command.agentRunId,
        call,
        reasonCode: 'agent.tool_execution_failed'
      });
      return { message: toolMessage(call, limitToolResult(`工具执行失败：${message}`, maxResultChars)) };
    }
  }

  private async save(
    agentRunId: AgentRunId,
    turnCount: number,
    toolCallCount: number,
    messages: readonly ModelMessage[],
    signatures: Readonly<Record<string, number>>,
    pendingConfirmation?: ModelToolCall
  ): Promise<AgentLoopCheckpoint> {
    const checkpoint: AgentLoopCheckpoint = {
      agentRunId,
      turnCount,
      toolCallCount,
      messages: messages.map(sanitizeMessageForCheckpoint),
      toolSignatures: { ...signatures },
      pendingConfirmation
    };
    await this.checkpoints.save(checkpoint);
    await this.emit({ type: 'checkpoint_saved', agentRunId, turn: turnCount });
    return checkpoint;
  }

  private emit(event: Parameters<AgentRuntimeObserver['onEvent']>[0]): Promise<void> {
    const next = this.observerQueue.then(() => this.observer?.onEvent(event));
    this.observerQueue = Promise.resolve(next).catch(() => undefined);
    return Promise.resolve(next);
  }
}

async function consumeGuidance(
  consume: RunAgentLoopCommand['consumeGuidance']
): Promise<readonly ModelMessage[]> {
  if (!consume) return [];
  const guidance = await consume();
  return guidance.filter((message) => contentText(message.content).trim());
}

function contentText(content: ModelMessage['content']): string {
  return typeof content === 'string'
    ? content
    : content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function sanitizeMessageForCheckpoint(message: ModelMessage): ModelMessage {
  if (typeof message.content === 'string') return message;
  const text = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
  return {
    ...message,
    content: text || '【图片附件已从持久化 Agent 上下文移除；如需继续识别，请重新导入原图。】'
  };
}

function toolMessage(call: ModelToolCall, content: string): ModelMessage {
  return {
    role: ModelMessageRole.Tool,
    toolCallId: call.id,
    content
  };
}

function toolSignature(call: ModelToolCall): string {
  return `${call.name}:${stableJson(call.arguments)}`;
}

function decrementSignature(signatures: Record<string, number>, signature: string): void {
  const count = signatures[signature] ?? 0;
  if (count <= 1) {
    delete signatures[signature];
    return;
  }
  signatures[signature] = count - 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function attemptedCodes(
  signatures: Readonly<Record<string, number>>,
  toolCodes: Iterable<string>
): Set<string> {
  const attempted = new Set<string>();
  for (const code of toolCodes) {
    if (Object.keys(signatures).some((signature) => signature.startsWith(`${code}:`))) attempted.add(code);
  }
  return attempted;
}

function claimedUnattemptedTool(
  text: string,
  toolCodes: Iterable<string>,
  attempted: ReadonlySet<string>
): string | undefined {
  if (/(?:尚未|没有|未能|无法|不能|并未).{0,12}(?:调用|执行|扫描|导入|写入)/.test(text)) return undefined;
  const normalized = text.toLocaleLowerCase();
  for (const code of toolCodes) {
    if (attempted.has(code)) continue;
    const providerName = providerToolName(code).toLocaleLowerCase();
    if (normalized.includes(code.toLocaleLowerCase()) || normalized.includes(providerName)) return code;
  }
  return /(?:正在|现在|开始|正式|已经|已)(?:\s|[，,:：])*?(?:调用|执行|扫描|导入|写入)/.test(text)
    ? [...toolCodes].find((code) => !attempted.has(code))
    : undefined;
}

function repairToolInstruction(toolCode: string): string {
  return [
    `你刚才没有发起真实的 ${toolCode} 工具调用。`,
    '不要再用文字描述“正在调用”或输出工具代码。现在必须实际调用该工具；若当前输入不足以执行，请明确说明缺少什么，不能声称操作已经开始或完成。'
  ].join('\n');
}

function isHonestToolDeferral(text: string): boolean {
  return /(?:缺少|未提供|没有提供|无法识别|不能确定|范围不明确|信息不足|请重新上传|请补充|需要补充)/.test(text);
}

function limitToolResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.floor(maxChars * 0.2);
  return `${content.slice(0, head)}\n...[tool result truncated]...\n${content.slice(-tail)}`;
}

function validateLimits(command: RunAgentLoopCommand) {
  const limits = {
    maxTurns: command.maxTurns ?? 8,
    maxToolCalls: command.maxToolCalls ?? 12,
    maxToolCallsPerTurn: command.maxToolCallsPerTurn ?? 4,
    maxParallelReadToolCalls: command.maxParallelReadToolCalls ?? 3,
    maxToolResultChars: command.maxToolResultChars ?? 6_000
  };
  if (!Number.isInteger(limits.maxTurns) || limits.maxTurns < 1 || limits.maxTurns > 12) throw new RangeError('Agent maxTurns must be between 1 and 12');
  if (!Number.isInteger(limits.maxToolCalls) || limits.maxToolCalls < 0 || limits.maxToolCalls > 24) throw new RangeError('Agent maxToolCalls must be between 0 and 24');
  if (!Number.isInteger(limits.maxToolCallsPerTurn) || limits.maxToolCallsPerTurn < 1 || limits.maxToolCallsPerTurn > 8) throw new RangeError('Agent maxToolCallsPerTurn must be between 1 and 8');
  if (!Number.isInteger(limits.maxParallelReadToolCalls) || limits.maxParallelReadToolCalls < 1 || limits.maxParallelReadToolCalls > 6) throw new RangeError('Agent maxParallelReadToolCalls must be between 1 and 6');
  if (!Number.isInteger(limits.maxToolResultChars) || limits.maxToolResultChars < 256 || limits.maxToolResultChars > 20_000) throw new RangeError('Agent maxToolResultChars must be between 256 and 20000');
  return limits;
}
