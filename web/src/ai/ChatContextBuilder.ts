import type { AIMessage } from '@/domain/ai';
import type { AITextMessage } from '@/composition-root/ai/ConfiguredAIClient';

const DEFAULT_CONTEXT_BUDGET = 6_000;
const DEFAULT_MAX_MESSAGES = 14;
const MAX_SINGLE_MESSAGE_LENGTH = 4_000;
const MAX_SUMMARY_LENGTH = 2_400;
const ROLLING_SUMMARY_VERSION = 2;

export interface BuildChatContextOptions {
  readonly currentPrompt: string;
  readonly budget?: number;
  readonly maxMessages?: number;
}

export function buildChatContext(history: readonly AIMessage[], options: BuildChatContextOptions): AITextMessage[] {
  const budget = options.budget ?? DEFAULT_CONTEXT_BUDGET;
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const selected: AITextMessage[] = [];
  let usedTokens = 0;
  const currentPrompt = options.currentPrompt.trim();
  const usable = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message, index, items) => !(index === items.length - 1 && message.role === 'user' && message.content.trim() === currentPrompt))
    .slice(-maxMessages)
    .reverse();

  for (const message of usable) {
    const item = sanitizeContextMessage(message.content);
    if (!item) continue;
    const itemTokens = estimateChatTokens(item);
    if (usedTokens + itemTokens > budget) break;
    selected.push({ role: message.role as 'user' | 'assistant', content: item });
    usedTokens += itemTokens;
  }

  return selected.reverse();
}

export function sanitizeContextMessage(content: string): string {
  const clean = content
    .replace(/\n?\s*\[\[ZH_AI_STOPPED\]\]\s*$/g, '')
    .replace(/^回复失败：.*$/g, '')
    .trim();
  if (!clean) return '';
  return clean.length > MAX_SINGLE_MESSAGE_LENGTH ? `${clean.slice(0, MAX_SINGLE_MESSAGE_LENGTH)}\n（以上为较长回复截断摘要）` : clean;
}

export function buildConversationSummary(history: readonly AIMessage[]): string {
  return summarizeMessages('', history);
}

export interface RollingConversationSummary {
  readonly summary: string;
  readonly cursorMessageId?: string;
  readonly version: number;
  readonly changed: boolean;
}

/**
 * Keeps recent turns verbatim and rolls only older turns into a bounded summary.
 * The cursor prevents repeatedly summarizing the same messages.
 */
export function advanceConversationSummary(
  history: readonly AIMessage[],
  previous: {
    readonly summary?: string;
    readonly cursorMessageId?: string;
    readonly version?: number;
  },
  recentMessageCount = DEFAULT_MAX_MESSAGES
): RollingConversationSummary {
  const usable = history.filter(isUsableConversationMessage);
  const eligible = usable.slice(0, Math.max(0, usable.length - recentMessageCount));
  if (!eligible.length) {
    return {
      summary: previous.summary?.trim() || '',
      cursorMessageId: previous.cursorMessageId,
      version: ROLLING_SUMMARY_VERSION,
      changed: false
    };
  }
  const previousCursorIndex = previous.cursorMessageId
    ? eligible.findIndex((message) => message.id === previous.cursorMessageId)
    : -1;
  const unseen = eligible.slice(previousCursorIndex + 1);
  const needsVersionUpgrade = previous.version !== ROLLING_SUMMARY_VERSION;
  if (!unseen.length && !needsVersionUpgrade) {
    return {
      summary: previous.summary?.trim() || '',
      cursorMessageId: previous.cursorMessageId,
      version: ROLLING_SUMMARY_VERSION,
      changed: false
    };
  }
  const source = needsVersionUpgrade ? eligible : unseen;
  const base = needsVersionUpgrade ? '' : previous.summary?.trim() || '';
  return {
    summary: summarizeMessages(base, source),
    cursorMessageId: eligible.at(-1)?.id,
    version: ROLLING_SUMMARY_VERSION,
    changed: true
  };
}

export function estimateChatTokens(text: string): number {
  const ascii = text.replace(/[^\x00-\x7F]/g, '').length;
  const nonAscii = text.length - ascii;
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii / 1.6));
}

function summarizeMessages(previousSummary: string, history: readonly AIMessage[]): string {
  const usable = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ ...message, content: sanitizeContextMessage(message.content).replace(/\s+/g, ' ') }))
    .filter((message) => message.content);
  if (!usable.length) return clipSummary(previousSummary);
  const turns = usable.map((message) => (
    `${message.role === 'user' ? '用户' : '助手'}：${clip(message.content, message.role === 'user' ? 140 : 180)}`
  ));
  return clipSummary([previousSummary.trim(), turns.join('\n')].filter(Boolean).join('\n'));
}

function isUsableConversationMessage(message: AIMessage): boolean {
  return (message.role === 'user' || message.role === 'assistant')
    && Boolean(sanitizeContextMessage(message.content));
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function clipSummary(value: string): string {
  if (value.length <= MAX_SUMMARY_LENGTH) return value;
  const marker = '\n...[较早会话摘要已压缩]...\n';
  const headLength = Math.floor((MAX_SUMMARY_LENGTH - marker.length) * 0.34);
  const tailLength = MAX_SUMMARY_LENGTH - marker.length - headLength;
  return `${value.slice(0, headLength)}${marker}${value.slice(-tailLength)}`;
}
