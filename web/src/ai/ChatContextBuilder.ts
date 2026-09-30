import type { AIMessage } from '@/domain/ai';
import type { AITextMessage } from '@/composition-root/ai/ConfiguredAIClient';
import type { ConversationMessageStatus } from '@/modules/conversation/public';

const DEFAULT_CONTEXT_BUDGET = 6_000;
const DEFAULT_MAX_MESSAGES = 14;
const MAX_SINGLE_MESSAGE_LENGTH = 4_000;
const MAX_SUMMARY_LENGTH = 2_400;
// v4 rebuilds summaries after selecting complete exchanges with their outcomes.
const ROLLING_SUMMARY_VERSION = 4;

/** A chat row as far as model context is concerned. */
export type ChatContextMessage = AIMessage & { readonly status?: ConversationMessageStatus };

/**
 * Texts older builds saved as ordinary assistant answers when a turn failed.
 * Replaying them taught the model that it had failed ("这条我回复失败了").
 */
const LEGACY_FAILURE_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'AI 回复未能正常完成，请重试。',
  '模型服务鉴权失败，请检查 AI 配置中的接口地址和密钥。',
  '当前模型不支持本次请求，请检查模型配置或更换兼容模型。',
  '当前模型不支持图片理解，请在 AI 配置中换用支持视觉输入的模型后重试。',
  '模型服务暂时没有响应，请稍后重试。',
  '本地数据正在忙，请稍后重试。'
]);
const LEGACY_FAILURE_MARKERS = ['我已经完成前面的处理，但在整理结果时遇到问题：', '[[ZH_AI_STOPPED]]'];

/** True when an older build saved nothing but a failure notice as the answer. */
export function isLegacyFailureNotice(content: string): boolean {
  const text = content.trim();
  return LEGACY_FAILURE_PLACEHOLDERS.has(text) || /^回复失败：/.test(text);
}

/** True for the text of a failed or interrupted turn saved by an older build. */
export function isLegacyFailurePlaceholder(content: string): boolean {
  return isLegacyFailureNotice(content)
    || LEGACY_FAILURE_MARKERS.some((marker) => content.includes(marker));
}

/**
 * Only completed exchanges are replayed to the model. Failed and stopped
 * turns stay visible in the chat but never become something the model said.
 */
export function isModelContextMessage(message: ChatContextMessage): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') return false;
  if (message.role === 'user') return Boolean(message.content.trim());
  return !message.status && !isLegacyFailurePlaceholder(message.content);
}

const INTERRUPTED_REPLY_NOTE = '（这条回复被用户中断，没有完成。除非用户再次要求，不要继续或重答这个问题。）';

/**
 * The exchanges the model may see, decided per question and its reply. A failed
 * turn is dropped together with its question, so the model never picks it up
 * again on its own (重试 resends it). A stopped turn keeps its question and the
 * part of the answer that was on screen, marked as interrupted: follow-ups such
 * as "换个角度" keep their context, but the model does not resume or re-answer
 * a request the learner stopped.
 */
export function modelContextMessages(history: readonly ChatContextMessage[]): ChatContextMessage[] {
  const exchanges: ChatContextMessage[] = [];
  // The stopped reply that may follow, i.e. the direct reply of a question that was kept.
  let pendingReply: ChatContextMessage | undefined;
  history.forEach((message, index) => {
    if (message.role === 'user') {
      pendingReply = undefined;
      if (!message.content.trim()) return;
      const reply = replyTo(history, index);
      if (reply && (replyOutcome(reply) === 'failed' || (replyOutcome(reply) === 'stopped' && !stoppedText(reply)))) return;
      exchanges.push(message);
      pendingReply = reply;
      return;
    }
    if (message.role !== 'assistant') return;
    const outcome = replyOutcome(message);
    const answersKeptQuestion = message === pendingReply;
    pendingReply = undefined;
    if (outcome === 'completed') exchanges.push(message);
    else if (outcome === 'stopped' && answersKeptQuestion) {
      exchanges.push({ ...message, status: 'stopped' });
    }
  });
  return exchanges;
}

/** Consecutive user rows include guidance for the same pending answer. */
function replyTo(history: readonly ChatContextMessage[], index: number): ChatContextMessage | undefined {
  for (let next = index + 1; next < history.length; next += 1) {
    const candidate = history[next];
    if (candidate?.role === 'assistant') return candidate;
  }
  return undefined;
}

function replyOutcome(message: ChatContextMessage): 'completed' | 'failed' | 'stopped' {
  if (message.status === 'failed') return 'failed';
  if (message.status === 'stopped' || message.content.includes('[[ZH_AI_STOPPED]]')) return 'stopped';
  return isLegacyFailurePlaceholder(message.content) ? 'failed' : 'completed';
}

function stoppedText(message: ChatContextMessage): string {
  return sanitizeContextMessage(message.content);
}

/** Drops summary lines that only recorded a failed assistant turn. */
export function sanitizeConversationSummary(summary: string): string {
  return summary
    .split('\n')
    .filter((line) => {
      const match = line.match(/^助手：(.*)$/);
      return !match || !isLegacyFailurePlaceholder(match[1].replace(/\.\.\.$/, ''));
    })
    .join('\n')
    .trim();
}

export interface BuildChatContextOptions {
  readonly currentPrompt: string;
  readonly budget?: number;
  readonly maxMessages?: number;
}

export function buildChatContext(history: readonly ChatContextMessage[], options: BuildChatContextOptions): AITextMessage[] {
  const budget = options.budget ?? DEFAULT_CONTEXT_BUDGET;
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const selected: AITextMessage[] = [];
  let usedTokens = 0;
  const currentPrompt = options.currentPrompt.trim();
  const conversational = modelContextMessages(history);
  if (conversational.at(-1)?.role === 'user' && conversational.at(-1)?.content.trim() === currentPrompt) {
    conversational.pop();
  }
  const usable = withoutRepeatedQuestions(conversational, currentPrompt)
    .slice(-maxMessages)
    .reverse();

  for (const message of usable) {
    const item = contextText(message);
    if (!item) continue;
    const itemTokens = estimateChatTokens(item);
    if (usedTokens + itemTokens > budget) break;
    selected.push({ role: message.role as 'user' | 'assistant', content: item });
    usedTokens += itemTokens;
  }

  return selected.reverse();
}

/**
 * A question sent again after its failed turn would otherwise reach the model
 * twice in a row; keep only the latest copy.
 */
function withoutRepeatedQuestions(
  messages: readonly ChatContextMessage[],
  currentPrompt: string
): ChatContextMessage[] {
  return messages.filter((message, index) => {
    if (message.role !== 'user') return true;
    const next = messages[index + 1];
    const nextQuestion = next ? (next.role === 'user' ? next.content.trim() : undefined) : currentPrompt;
    return nextQuestion !== message.content.trim();
  });
}

export function sanitizeContextMessage(content: string): string {
  const clean = content
    .replace(/\n?\s*\[\[ZH_AI_STOPPED\]\]\s*$/g, '')
    .replace(/^回复失败：.*$/g, '')
    .trim();
  if (!clean) return '';
  return clean.length > MAX_SINGLE_MESSAGE_LENGTH ? `${clean.slice(0, MAX_SINGLE_MESSAGE_LENGTH)}\n（以上为较长回复截断摘要）` : clean;
}

export function buildConversationSummary(history: readonly ChatContextMessage[]): string {
  return summarizeMessages('', modelContextMessages(history));
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
  history: readonly ChatContextMessage[],
  previous: {
    readonly summary?: string;
    readonly cursorMessageId?: string;
    readonly version?: number;
  },
  recentMessageCount = DEFAULT_MAX_MESSAGES
): RollingConversationSummary {
  const usable = modelContextMessages(history).filter((message) => Boolean(sanitizeContextMessage(message.content)));
  let end = Math.max(0, usable.length - recentMessageCount);
  // Do not move a question to the summary before its answer is eligible too.
  while (end > 0 && usable[end - 1]?.role === 'user') end -= 1;
  const eligible = usable.slice(0, end);
  const needsVersionUpgrade = previous.version !== ROLLING_SUMMARY_VERSION;
  if (!eligible.length) {
    return {
      summary: '',
      cursorMessageId: undefined,
      version: ROLLING_SUMMARY_VERSION,
      changed: needsVersionUpgrade || Boolean(previous.summary || previous.cursorMessageId)
    };
  }
  const previousCursorIndex = previous.cursorMessageId
    ? eligible.findIndex((message) => message.id === previous.cursorMessageId)
    : -1;
  const unseen = eligible.slice(previousCursorIndex + 1);
  if (!unseen.length && !needsVersionUpgrade) {
    return {
      summary: previous.summary?.trim() || '',
      cursorMessageId: previous.cursorMessageId,
      version: ROLLING_SUMMARY_VERSION,
      changed: false
    };
  }
  const rebuild = needsVersionUpgrade || previousCursorIndex < 0;
  const source = rebuild ? eligible : unseen;
  const base = rebuild ? '' : previous.summary?.trim() || '';
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

function summarizeMessages(previousSummary: string, history: readonly ChatContextMessage[]): string {
  const usable = history
    .map((message) => ({ ...message, content: contextText(message, message.role === 'user' ? 140 : 180).replace(/\s+/g, ' ') }))
    .filter((message) => message.content);
  if (!usable.length) return clipSummary(previousSummary);
  const turns = usable.map((message) => (
    `${message.role === 'user' ? '用户' : '助手'}：${message.content}`
  ));
  return clipSummary([previousSummary.trim(), turns.join('\n')].filter(Boolean).join('\n'));
}

function contextText(message: ChatContextMessage, maxLength?: number): string {
  const clean = sanitizeContextMessage(message.content);
  const body = maxLength === undefined ? clean : clip(clean, maxLength);
  // Outcome is appended after every body truncation, including the summary's tighter limit.
  return body && message.role === 'assistant' && replyOutcome(message) === 'stopped' ? `${body}\n\n${INTERRUPTED_REPLY_NOTE}` : body;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function clipSummary(value: string): string {
  if (value.length <= MAX_SUMMARY_LENGTH) return value;
  const marker = '...[较早会话摘要已压缩]...\n';
  const blocks = value.replace(/^\.\.\.\[较早会话摘要已压缩\]\.\.\.\n/, '').split(/\n(?=用户：)/);
  while (blocks.length && marker.length + blocks.join('\n').length > MAX_SUMMARY_LENGTH) blocks.shift();
  return `${marker}${blocks.join('\n')}`;
}
