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
  '不对', '不', '否', '别', '先别', '停止', '停', '放弃', '拒绝', '先不', '暂不', '暂时不', '还是不', '撤销', 'no', 'n', 'nope'
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
  // A plain no stays a no even when it is phrased as a question or names the edit it declines.
  if (isPureNegation(text)) return 'reject';
  // Questions and requests to revise the proposal never authorize its old parameters.
  if (QUESTION_OR_REVISION.test(text)) return 'ambiguous';
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

/** Any pending tool: execute words such as "执行" also read as a yes. */
const ANY_PENDING_TOOL = '*';

/** True for a reply that would confirm a pending action, whichever it was. */
export function isConfirmationLikeReply(text: string): boolean {
  return classifyAgentConfirmationReply(text, ANY_PENDING_TOOL) === 'confirm';
}

export function isAgentConfirmation(text: string): boolean {
  return classifyAgentConfirmationReply(text) === 'confirm';
}

export function isAgentCancellation(text: string): boolean {
  return classifyAgentConfirmationReply(text) === 'reject';
}

const QUESTION_OR_REVISION = /[?？﹖⁇⁈⁉❓❔吗么呢嘛]|修改|改|更新/;
const QUESTION_MARK = /[?？﹖⁇⁈⁉❓❔]/;

/**
 * True when every answering clause only declines ("取消吧？", "算了吧，不改了",
 * "还要继续吗？不用了"): each clause is made of known words, at least one is a
 * negation, and none affirms or names an action outside a negated clause.
 * Leading clauses that restate the question are skipped when an answer follows.
 */
function isPureNegation(text: string): boolean {
  const clauses: Array<{ readonly body: string; readonly question: boolean }> = [];
  const parts = text.toLocaleLowerCase().split(/([\s\p{P}\p{S}]+)/u);
  for (let index = 0; index < parts.length; index += 2) {
    const body = parts[index] ?? '';
    if (!body) continue;
    clauses.push({ body, question: QUESTION_MARK.test(parts[index + 1] ?? '') || /[吗么呢嘛]$/.test(body) });
  }
  const firstAnswer = clauses.findIndex((clause) => !clause.question);
  const answer = firstAnswer > 0 ? clauses.slice(firstAnswer) : clauses;
  let negated = false;
  for (const clause of answer) {
    const words = segment(clause.body);
    if (!words) return false;
    const kinds = new Set(words.map((word) => VOCABULARY.get(word)));
    if (kinds.has('affirm')) return false;
    if (kinds.has('negate')) negated = true;
    else if (kinds.has('action')) return false;
  }
  return negated;
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
