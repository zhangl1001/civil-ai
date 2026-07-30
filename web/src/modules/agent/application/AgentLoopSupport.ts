import {
  ModelMessageRole,
  type ModelMessage,
  type ModelToolCall,
  type ProviderToolDefinition
} from '@/capabilities/ai-runtime/public';
import type { AgentCompletionExpectation } from '../contracts/AgentRuntimePorts';
import type { AgentSkillActivation } from '../domain/AgentSkillRegistry';

export type AgentGuidanceConsumer = () => readonly ModelMessage[] | Promise<readonly ModelMessage[]>;

export interface AgentLoopLimitOptions {
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxToolCallsPerTurn?: number;
  readonly maxParallelReadToolCalls?: number;
  readonly maxToolResultChars?: number;
  readonly maxWallTimeMs?: number;
  readonly maxContextTokens?: number;
}

export interface AgentLoopLimits {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxToolCallsPerTurn: number;
  readonly maxParallelReadToolCalls: number;
  readonly maxToolResultChars: number;
  readonly maxWallTimeMs: number;
  readonly maxContextTokens: number;
}

export interface CompiledAgentLoopTurn {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ProviderToolDefinition[];
  readonly estimatedTokens: number;
}

export function compileAgentLoopTurnContext(input: {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ProviderToolDefinition[];
  readonly maxContextTokens: number;
  readonly outputReserveTokens: number;
}): CompiledAgentLoopTurn {
  const systemTokens = estimateTextTokens(input.system);
  const toolTokens = estimateTextTokens(stableJson(input.tools));
  const fixedTokens = systemTokens + toolTokens + input.outputReserveTokens;
  if (fixedTokens >= input.maxContextTokens) {
    throw new Error('Agent system, tools and output reserve exceed the model context budget');
  }
  const messages = compactAgentLoopMessages(
    input.messages,
    input.maxContextTokens - fixedTokens
  );
  const estimatedTokens = fixedTokens + estimateAgentMessageTokens(messages);
  if (estimatedTokens > input.maxContextTokens) {
    throw new Error('Agent execution evidence exceeds the model context budget');
  }
  return {
    system: input.system,
    messages,
    tools: input.tools,
    estimatedTokens
  };
}

export async function consumeAgentGuidance(
  consume?: AgentGuidanceConsumer
): Promise<readonly ModelMessage[]> {
  if (!consume) return [];
  const guidance = await consume();
  return guidance.filter((message) => messageContentText(message.content).trim());
}

export function sanitizeMessageForCheckpoint(message: ModelMessage): ModelMessage {
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

export function createToolResultMessage(call: ModelToolCall, content: string): ModelMessage {
  return { role: ModelMessageRole.Tool, toolCallId: call.id, content };
}

export function createToolObservationMessage(
  call: ModelToolCall,
  observation: {
    readonly status: 'succeeded' | 'no_progress' | 'failed';
    readonly content: string;
    readonly retryable?: boolean;
    readonly failureCode?: string;
  }
): ModelMessage {
  if (observation.status === 'succeeded') {
    return createToolResultMessage(call, observation.content);
  }
  return createToolResultMessage(call, [
    '【Agent 工具观察】',
    `status: ${observation.status}`,
    `retryable: ${observation.retryable !== false}`,
    observation.failureCode ? `failure_code: ${observation.failureCode}` : '',
    observation.status === 'no_progress'
      ? 'guidance: 本次调用没有获得完成目标所需的新证据。请根据结果自主调整参数、范围、工具或步骤，不要机械重复。'
      : 'guidance: 先判断失败是否可恢复。可恢复时调整策略或受控重试；不可恢复或缺少关键输入时如实向用户说明。',
    'result:',
    observation.content
  ].filter(Boolean).join('\n'));
}

export function agentToolSignature(call: ModelToolCall): string {
  return `${call.name}:${stableJson(call.arguments)}`;
}

export function decrementToolSignature(signatures: Record<string, number>, signature: string): void {
  const count = signatures[signature] ?? 0;
  if (count <= 1) {
    delete signatures[signature];
    return;
  }
  signatures[signature] = count - 1;
}

export function attemptedToolNames(
  signatures: Readonly<Record<string, number>>,
  toolNames: Iterable<string>
): Set<string> {
  const attempted = new Set<string>();
  for (const name of toolNames) {
    if (Object.keys(signatures).some((signature) => signature.startsWith(`${name}:`))) attempted.add(name);
  }
  return attempted;
}

export function composeActiveSkillSystem(base: string, skills: readonly AgentSkillActivation[]): string {
  if (!skills.length) return base;
  return [base, '# 当前已加载 Skill 工作流', ...skills.map((skill) => skill.instructions)].join('\n\n');
}

export function skillContinuationInstruction(skills: readonly AgentSkillActivation[]): string {
  const allowedTools = [...new Set(skills.flatMap((skill) => skill.allowedTools))];
  return [
    'Skill 工作流已经加载，但选择 Skill 本身不算完成，当前还没有执行具体业务工具。',
    allowedTools.length ? `请从当前允许的工具中选择完成目标所需的最小调用：${allowedTools.join('、')}。` : '',
    '如果执行条件不足，请直接向用户询问唯一必要的信息；否则必须实际调用工具，不能只描述准备执行。'
  ].filter(Boolean).join('\n');
}

export function completionVerificationInstruction(
  verifierNames: readonly string[],
  expectations: readonly AgentCompletionExpectation[] = []
): string {
  const targets = expectations.map((item) => `${item.resourceType}:${item.resourceId}`);
  return [
    '刚才的写工具只返回了异步任务标识，这表示请求可能已受理，不表示任务已经执行或内容已经生成。',
    targets.length ? `必须核验这些精确资源，禁止改查其他任务：${targets.join('、')}。` : '',
    verifierNames.length
      ? `现在必须调用状态核验工具读取真实状态：${verifierNames.join('、')}。`
      : '现在必须读取真实任务状态。',
    '如果精确 taskId 查询无结果，请改用 active 或 today 的最小范围查询；仍无结果时如实说明，不得直接生成一份聊天正文冒充业务结果。'
  ].filter(Boolean).join('\n');
}

export function limitToolResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.floor(maxChars * 0.2);
  return `${content.slice(0, head)}\n...[tool result truncated]...\n${content.slice(-tail)}`;
}

/**
 * Compacts only completed, older loop messages. The current execution tail stays
 * verbatim so tool-call/result pairing and the latest evidence remain intact.
 */
export function compactAgentLoopMessages(
  messages: readonly ModelMessage[],
  maxTokens: number
): readonly ModelMessage[] {
  if (estimateAgentMessageTokens(messages) <= maxTokens) return messages;
  let tailStart = Math.max(1, messages.length - 12);
  while (tailStart < messages.length && messages[tailStart]?.role === ModelMessageRole.Tool) {
    tailStart += 1;
  }
  if (tailStart >= messages.length) tailStart = Math.max(0, messages.length - 2);
  const removed = [...messages.slice(0, tailStart)];
  let retained = [...messages.slice(tailStart)];
  while (retained.length > 2 && estimateAgentMessageTokens(retained) > Math.floor(maxTokens * 0.78)) {
    const removedCount = executionUnitLength(retained);
    removed.push(...retained.splice(0, removedCount));
    while (retained[0]?.role === ModelMessageRole.Tool) removed.push(retained.shift() as ModelMessage);
  }
  retained = retained.map((message) => clipMessageText(
    message,
    Math.max(256, Math.floor(maxTokens * 0.72 / Math.max(1, retained.length)))
  ));
  const retainedTokens = estimateAgentMessageTokens(retained);
  if (retainedTokens >= maxTokens) {
    throw new Error('Latest Agent tool exchange exceeds the model context budget');
  }
  const summaryLines = removed.map(summarizeLoopMessage).filter(Boolean);
  const summary: ModelMessage = {
    role: ModelMessageRole.User,
    content: [
      '【系统压缩的早期 Agent 执行上下文】',
      '以下是本次运行较早阶段的可核验摘要；最新原始消息和工具结果仍保留在后文。',
      ...summaryLines
    ].join('\n')
  };
  const summaryBudget = Math.max(1, maxTokens - retainedTokens);
  const clippedSummary = clipMessageText(summary, summaryBudget);
  return [clippedSummary, ...retained];
}

export function validateAgentLoopLimits(command: AgentLoopLimitOptions): AgentLoopLimits {
  const limits = {
    maxTurns: command.maxTurns ?? 32,
    maxToolCalls: command.maxToolCalls ?? 64,
    maxToolCallsPerTurn: command.maxToolCallsPerTurn ?? 6,
    maxParallelReadToolCalls: command.maxParallelReadToolCalls ?? 3,
    maxToolResultChars: command.maxToolResultChars ?? 6_000,
    maxWallTimeMs: command.maxWallTimeMs ?? 900_000,
    maxContextTokens: command.maxContextTokens ?? 24_000
  };
  assertBoundedInteger(limits.maxTurns, 1, 32, 'Agent maxTurns');
  assertBoundedInteger(limits.maxToolCalls, 0, 64, 'Agent maxToolCalls');
  assertBoundedInteger(limits.maxToolCallsPerTurn, 1, 8, 'Agent maxToolCallsPerTurn');
  assertBoundedInteger(limits.maxParallelReadToolCalls, 1, 6, 'Agent maxParallelReadToolCalls');
  assertBoundedInteger(limits.maxToolResultChars, 256, 20_000, 'Agent maxToolResultChars');
  assertBoundedInteger(limits.maxWallTimeMs, 30_000, 1_200_000, 'Agent maxWallTimeMs');
  assertBoundedInteger(limits.maxContextTokens, 4_000, 100_000, 'Agent maxContextTokens');
  return limits;
}

function summarizeLoopMessage(message: ModelMessage): string {
  const content = messageContentText(message.content).replace(/\s+/g, ' ').trim();
  if (message.role === ModelMessageRole.Tool) {
    return `- 工具结果 ${message.toolCallId || 'unknown'}：${clipText(content, 500)}`;
  }
  if (message.role === ModelMessageRole.Assistant && message.toolCalls?.length) {
    const calls = message.toolCalls.map((call) => `${call.name}(${clipText(stableJson(call.arguments), 180)})`).join('；');
    return `- 助手调用：${calls}${content ? `；说明：${clipText(content, 240)}` : ''}`;
  }
  return content
    ? `- ${message.role === ModelMessageRole.User ? '输入/引导' : '助手阶段结论'}：${clipText(content, 500)}`
    : '';
}

export function estimateAgentMessageTokens(messages: readonly ModelMessage[]): number {
  return messages.reduce((total, message) => {
    const contentTokens = typeof message.content === 'string'
      ? estimateTextTokens(message.content)
      : message.content.reduce((sum, part) => (
          sum + (part.type === 'text' ? estimateTextTokens(part.text) : IMAGE_CONTEXT_TOKENS)
        ), 0);
    const calls = message.toolCalls ? estimateTextTokens(stableJson(message.toolCalls)) : 0;
    return total + contentTokens + calls;
  }, 0);
}

function estimateTextTokens(text: string): number {
  const ascii = text.replace(/[^\x00-\x7F]/g, '').length;
  const nonAscii = text.length - ascii;
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii / 1.6));
}

function executionUnitLength(messages: readonly ModelMessage[]): number {
  const first = messages[0];
  if (first?.role !== ModelMessageRole.Assistant || !first.toolCalls?.length) return 1;
  const ids = new Set(first.toolCalls.map((call) => call.id));
  let count = 1;
  while (
    count < messages.length
    && messages[count]?.role === ModelMessageRole.Tool
    && ids.has(messages[count]?.toolCallId || '')
  ) count += 1;
  return count;
}

function clipMessageText(message: ModelMessage, maxTokens: number): ModelMessage {
  const toolCallTokens = message.toolCalls
    ? estimateTextTokens(stableJson(message.toolCalls))
    : 0;
  const contentBudget = Math.max(1, maxTokens - toolCallTokens);
  if (typeof message.content === 'string') {
    return { ...message, content: clipTextToTokens(message.content, contentBudget) };
  }
  const imageTokens = message.content.filter((part) => part.type === 'image').length
    * IMAGE_CONTEXT_TOKENS;
  if (imageTokens >= contentBudget) {
    throw new Error('Agent media attachments exceed the model context budget');
  }
  const textParts = message.content.filter((part) => part.type === 'text');
  const perTextBudget = Math.max(1, Math.floor(
    (contentBudget - imageTokens) / Math.max(1, textParts.length)
  ));
  return {
    ...message,
    content: message.content.map((part) => part.type === 'text'
      ? { ...part, text: clipTextToTokens(part.text, perTextBudget) }
      : part)
  };
}

function clipTextToTokens(value: string, maxTokens: number): string {
  if (estimateTextTokens(value) <= maxTokens) return value;
  const suffix = '\n[内容已截断]';
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTextTokens(`${value.slice(0, middle)}${suffix}`) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low)}${suffix}`;
}

function clipText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function messageContentText(content: ModelMessage['content']): string {
  return typeof content === 'string'
    ? content
    : content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function assertBoundedInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
}

const IMAGE_CONTEXT_TOKENS = 1_024;
