import type { JsonObject } from '@/kernel/public';

/**
 * Persisted shape of a choice answer inside `attempts.answer_json`. Writer and
 * reader live together so the stored key can never drift between them.
 */

export function choiceAttemptAnswer(optionIds: readonly string[]): JsonObject {
  return { optionIds: [...optionIds] };
}

/** Selected option ids, or an empty list when the question was left unanswered. */
export function submittedOptionIds(answer: JsonObject): readonly string[] {
  const value = (answer as Record<string, unknown>).optionIds;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** Selected options as displayed, e.g. `A` or `ABD`. Empty when unanswered. */
export function submittedAnswerLabel(answer: JsonObject): string {
  return submittedOptionIds(answer).join('');
}
