import { parseProactiveLevel, parseStudyMode, parseTeachingOrder } from '@/modules/candidate/public';
import { parseExamScope } from './ExamProfileScores';

/**
 * Fields holding a closed code set. A draft is untrusted input that can outlive
 * the build which wrote it, so an unrecognised code leaves the form's own
 * default standing instead of travelling to submit and being asserted into a
 * domain type there.
 */
const DRAFT_CODE_PARSERS: Readonly<Record<string, (value: unknown) => string | undefined>> = {
  examScope: parseExamScope,
  studyMode: parseStudyMode,
  teachingOrder: parseTeachingOrder,
  proactiveLevel: parseProactiveLevel
};

/** Restored against the active package's subjects instead, by restoreScoreEntries. */
const RESTORED_ELSEWHERE: ReadonlySet<string> = new Set(['currentScores', 'targetScores']);

/**
 * Copies a saved draft back onto the form, field by field. Free-text and
 * numeric fields only have to match the field's own type; code fields have to
 * parse.
 */
export function restoreFormFields(
  form: Record<string, unknown>,
  saved: Readonly<Record<string, unknown>>
): void {
  for (const key of Object.keys(form)) {
    if (RESTORED_ELSEWHERE.has(key)) continue;
    const value = saved[key];
    const parseCode = DRAFT_CODE_PARSERS[key];
    if (parseCode) {
      const parsed = parseCode(value);
      if (parsed !== undefined) form[key] = parsed;
      continue;
    }
    if (typeof value === typeof form[key]) form[key] = value;
  }
}
