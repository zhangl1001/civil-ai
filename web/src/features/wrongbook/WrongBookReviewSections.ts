import type { JsonObject } from '@/kernel/public';
import type { ContentRepository } from '@/modules/content/public';
import type { WrongBookEntry } from '@/modules/evidence/public';

/**
 * Groups selected wrong answers into one review section per question set and
 * learning thread. A set bound to a thread is reviewed under that thread, not
 * the one its original session recorded: a session written before submission
 * enforced the binding can name another thread, and that pairing is refused.
 */
export async function buildWrongBookReviewSections(
  entries: readonly WrongBookEntry[],
  questionSets: Pick<ContentRepository, 'findQuestionSet'>
): Promise<JsonObject[]> {
  const setIds = [...new Set(entries.map((entry) => entry.session.questionSetId))];
  const boundThreads = new Map(await Promise.all(setIds.map(async (id) => (
    [id, (await questionSets.findQuestionSet(id))?.questionSet.learningThreadId] as const
  ))));
  const groups = new Map<string, {
    questionSetId: string;
    learningThreadId: string;
    module: string;
    questionIds: string[];
  }>();
  entries.forEach((entry) => {
    const questionSetId = entry.session.questionSetId;
    const learningThreadId = boundThreads.get(questionSetId) || entry.session.learningThreadId;
    const key = `${questionSetId}:${learningThreadId}`;
    const group = groups.get(key) ?? { questionSetId, learningThreadId, module: entry.module, questionIds: [] };
    group.questionIds.push(entry.question.id);
    groups.set(key, group);
  });
  return [...groups.values()].map((group) => JSON.parse(JSON.stringify(group)) as JsonObject);
}
