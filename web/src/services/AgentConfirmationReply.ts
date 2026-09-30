export type AgentConfirmationDecision = 'confirm' | 'reject' | 'ambiguous';

const AFFIRMATIVE = [
  '确认', '确定', '同意', '可以', '行', '好的', '好', '好嘞', '嗯', '是的', '是', '对的', '对', '没问题', '没错',
  '当然', '要', '需要', '就这样', '那就这样', '没意见', 'ok', 'okay', 'yes', 'y', 'sure'
];
/** Imperatives that name the pending action; alone or after a yes they confirm it. */
const ACTIONS = [
  '开始', '执行', '继续', '发布', '提交', '保存', '修改', '改', '导入', '发', '做', '生成', '创建', '更新', '去'
];
const ACTIONS_BY_TOOL: Readonly<Record<string, readonly string[]>> = {
  'question_bank.publish': ['发布', '发'],
  'question_bank.confirm': [],
};
const EXECUTE_ACTIONS = new Set(['开始', '执行', '继续']);
const NEGATIVE = [
  '取消', '确认取消', '算了', '不要', '不用', '不了', '不行', '不必', '不需要', '不执行', '不确认', '不同意', '不可以',
  '不对', '不', '否', '别', '停止', '停', '放弃', '拒绝', '先不', '暂不', '暂时不', '还是不', '撤销', 'no', 'n', 'nope'
];
/** Particles and courtesy words that do not change the answer. */
const FILLER = ['吧', '啊', '呀', '哦', '噢', '喔', '啦', '哈', '哇', '了', '的', '请', '麻烦', '帮我', '你', '就', '那',
  '直接', '一下', '谢谢', '谢了', 'please', 'thanks'];

type WordKind = 'affirm' | 'action' | 'negate' | 'filler';

const VOCABULARY = new Map<string, WordKind>([
  ...FILLER.map((word) => [word, 'filler'] as const),
  ...ACTIONS.map((word) => [word, 'action'] as const),
  ...AFFIRMATIVE.map((word) => [word, 'affirm'] as const),
  ...NEGATIVE.map((word) => [word, 'negate'] as const)
]);
const LONGEST_WORD = Math.max(...[...VOCABULARY.keys()].map((word) => word.length));

/**
 * Reads a reply to a pending confirmation. Punctuation, particles and
 * courtesy words are ignored, clear yes/no answers ("确认！", "是的",
 * "好的，发布吧", "算了，不发了") are decided, and anything else — a question,
 * a new request, a mixed answer — is ambiguous so the pending action is kept
 * and asked about again instead of being silently cancelled.
 */
export function classifyAgentConfirmationReply(text: string, pendingToolName?: string): AgentConfirmationDecision {
  // Questions and requests to revise the proposal never authorize its old parameters.
  if (/[?？﹖⁇⁈⁉❓❔吗么呢嘛]|修改|改|更新/.test(text)) return 'ambiguous';
  const normalized = text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const words = segment(normalized);
  if (!words) return 'ambiguous';
  const kinds = new Set(words.map((word) => VOCABULARY.get(word)));
  if (kinds.has('negate')) return kinds.has('affirm') ? 'ambiguous' : 'reject';
  const actions = words.filter((word) => VOCABULARY.get(word) === 'action');
  if (actions.some((word) => !EXECUTE_ACTIONS.has(word)
    && !ACTIONS_BY_TOOL[pendingToolName ?? '']?.includes(word))) return 'ambiguous';
  return kinds.has('affirm') || (Boolean(pendingToolName) && actions.length > 0) ? 'confirm' : 'ambiguous';
}

export function isAgentConfirmation(text: string): boolean {
  return classifyAgentConfirmationReply(text) === 'confirm';
}

export function isAgentCancellation(text: string): boolean {
  return classifyAgentConfirmationReply(text) === 'reject';
}

/** Splits into known words using as few (so as long) words as possible, or nothing. */
function segment(text: string): readonly string[] | undefined {
  if (!text || text.length > 40) return undefined;
  const best: Array<readonly string[] | undefined> = [[]];
  for (let end = 1; end <= text.length; end += 1) {
    for (let start = Math.max(0, end - LONGEST_WORD); start < end; start += 1) {
      const prefix = best[start];
      const word = text.slice(start, end);
      if (!prefix || !VOCABULARY.has(word)) continue;
      if (!best[end] || prefix.length + 1 < best[end]!.length) best[end] = [...prefix, word];
    }
  }
  return best[text.length];
}
