import type { AIMessage } from '@/domain/ai';
import type { AICompletionMessage } from './AIProvider';

const DEFAULT_CONTEXT_BUDGET = 12_000;
const DEFAULT_MAX_MESSAGES = 24;
const MAX_SINGLE_MESSAGE_LENGTH = 4_000;
const MAX_SUMMARY_MESSAGES = 10;

export interface BuildChatContextOptions {
  readonly currentPrompt: string;
  readonly budget?: number;
  readonly maxMessages?: number;
}

export function buildChatContext(history: readonly AIMessage[], options: BuildChatContextOptions): AICompletionMessage[] {
  const budget = options.budget ?? DEFAULT_CONTEXT_BUDGET;
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const selected: AICompletionMessage[] = [];
  let used = 0;
  const currentPrompt = options.currentPrompt.trim();
  const usable = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message, index, items) => !(index === items.length - 1 && message.role === 'user' && message.content.trim() === currentPrompt))
    .slice(-maxMessages)
    .reverse();

  for (const message of usable) {
    const item = sanitizeContextMessage(message.content);
    if (!item) continue;
    if (used + item.length > budget) break;
    selected.push({ role: message.role as 'user' | 'assistant', content: item });
    used += item.length;
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
  const usable = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ ...message, content: sanitizeContextMessage(message.content).replace(/\s+/g, ' ') }))
    .filter((message) => message.content)
    .slice(-MAX_SUMMARY_MESSAGES);
  if (usable.length < 2) return '';
  const userFocus = usable
    .filter((message) => message.role === 'user')
    .slice(-4)
    .map((message) => clip(message.content, 60));
  const assistantNotes = usable
    .filter((message) => message.role === 'assistant')
    .slice(-3)
    .map((message) => clip(message.content, 80));
  return [
    userFocus.length ? `用户近期关注：${userFocus.join('；')}` : '',
    assistantNotes.length ? `已给出的建议/结论：${assistantNotes.join('；')}` : ''
  ].filter(Boolean).join('\n');
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
