import {
  ModelMessageRole,
  type ModelMessage,
  type ModelToolCall,
  type ProviderGateway,
  type ProviderToolDefinition
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
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

export interface RunAgentLoopCommand {
  readonly agentRunId: AgentRunId;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly AgentToolDefinition[];
  readonly executionContext: AgentToolExecutionContext;
  readonly checkpoint?: AgentLoopCheckpoint;
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxToolCallsPerTurn?: number;
  readonly maxToolResultChars?: number;
  readonly confirmationDecision?: 'confirm' | 'reject';
  readonly preferStream?: boolean;
  readonly consumeGuidance?: () => readonly ModelMessage[] | Promise<readonly ModelMessage[]>;
}

export interface AgentLoopResult {
  readonly status: 'completed' | 'waiting_user' | 'budget_exhausted';
  readonly text: string;
  readonly checkpoint: AgentLoopCheckpoint;
}

/** Provider-neutral, bounded Agent loop. Business writes remain behind typed tool executors. */
export class RunAgentLoop {
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
    const definitions = new Map(command.tools.map((tool) => [tool.code, tool]));
    const providerTools = command.tools.map(toProviderTool);
    const definitionsByProviderName = new Map<string, AgentToolDefinition>();
    providerTools.forEach((tool, index) => {
      if (definitionsByProviderName.has(tool.name)) {
        throw new Error(`Agent tools map to the same provider name: ${tool.name}`);
      }
      definitionsByProviderName.set(tool.name, command.tools[index]);
    });
    const messages = [...(command.checkpoint?.messages ?? command.messages)];
    const signatures = { ...(command.checkpoint?.toolSignatures ?? {}) };
    let turnCount = command.checkpoint?.turnCount ?? 0;
    let toolCallCount = command.checkpoint?.toolCallCount ?? 0;
    let finalizationOnly = false;
    await this.emit({ type: 'run_started', agentRunId: command.agentRunId });

    const pendingConfirmation = command.checkpoint?.pendingConfirmation;
    if (pendingConfirmation) {
      const definition = definitions.get(pendingConfirmation.name);
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
        tools: finalizationOnly ? [] : providerTools,
        toolChoice: finalizationOnly ? 'none' : 'auto',
        toolSchemaVersion: 'tutor-tools@2',
        preferStream: command.preferStream !== false,
        onDelta: async (text) => {
          if (text) await this.emit({ type: 'text_delta', agentRunId: command.agentRunId, text });
        }
      }, gateway, signal);
      const calls = response.toolCalls ?? [];
      if (!calls.length) {
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
      for (const providerCall of calls) {
        signal?.throwIfAborted();
        toolCallCount += 1;
        const definition = definitionsByProviderName.get(providerCall.name);
        const call = definition
          ? { ...providerCall, name: definition.code }
          : providerCall;
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
        await this.emit({ type: 'tool_call_started', agentRunId: command.agentRunId, call });
        try {
          const result = await this.executor.execute(definition, call, {
            ...command.executionContext,
            signal
          });
          messages.push(toolMessage(call, limitToolResult(result.content, limits.maxToolResultChars)));
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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          messages.push(toolMessage(call, limitToolResult(`工具执行失败：${message}`, limits.maxToolResultChars)));
          await this.emit({ type: 'tool_call_failed', agentRunId: command.agentRunId, call, reasonCode: 'agent.tool_execution_failed' });
        }
      }
      await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
    }

    const checkpoint = await this.save(command.agentRunId, turnCount, toolCallCount, messages, signatures);
    await this.emit({ type: 'run_stopped', agentRunId: command.agentRunId, reasonCode: 'agent.turn_budget_exhausted' });
    return { status: 'budget_exhausted', text: '', checkpoint };
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
      messages: [...messages],
      toolSignatures: { ...signatures },
      pendingConfirmation
    };
    await this.checkpoints.save(checkpoint);
    await this.emit({ type: 'checkpoint_saved', agentRunId, turn: turnCount });
    return checkpoint;
  }

  private emit(event: Parameters<AgentRuntimeObserver['onEvent']>[0]): Promise<void> {
    return Promise.resolve(this.observer?.onEvent(event));
  }
}

async function consumeGuidance(
  consume: RunAgentLoopCommand['consumeGuidance']
): Promise<readonly ModelMessage[]> {
  if (!consume) return [];
  const guidance = await consume();
  return guidance.filter((message) => message.content.trim());
}

function toProviderTool(tool: AgentToolDefinition): ProviderToolDefinition {
  return {
    name: providerToolName(tool.code),
    description: tool.description,
    inputSchema: tool.inputSchema
  };
}

function providerToolName(code: string): string {
  const normalized = code.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`Agent tool code cannot be mapped to a provider function name: ${code}`);
  }
  return normalized;
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
    maxToolResultChars: command.maxToolResultChars ?? 6_000
  };
  if (!Number.isInteger(limits.maxTurns) || limits.maxTurns < 1 || limits.maxTurns > 12) throw new RangeError('Agent maxTurns must be between 1 and 12');
  if (!Number.isInteger(limits.maxToolCalls) || limits.maxToolCalls < 0 || limits.maxToolCalls > 24) throw new RangeError('Agent maxToolCalls must be between 0 and 24');
  if (!Number.isInteger(limits.maxToolCallsPerTurn) || limits.maxToolCallsPerTurn < 1 || limits.maxToolCallsPerTurn > 8) throw new RangeError('Agent maxToolCallsPerTurn must be between 1 and 8');
  if (!Number.isInteger(limits.maxToolResultChars) || limits.maxToolResultChars < 256 || limits.maxToolResultChars > 20_000) throw new RangeError('Agent maxToolResultChars must be between 256 and 20000');
  return limits;
}
