import type { SubjectCode } from '@/kernel/public';
import type { ExamSubjectView } from '@/modules/curriculum/public';
import type { ExamPackOption } from './ExamPackSelectionFeature';
import { OnboardingMessage } from './onboardingMessages';

/** Editable score fields, keyed by subject code because the pack decides the subjects. */
export type ScoreEntries = Record<string, string>;

export interface SubjectScoreInput {
  readonly subject: SubjectCode;
  readonly currentScore?: number;
  readonly targetScore: number;
  readonly maxScore: number;
}

/** Region-scoped tracks read as "国家…" or "江苏…"; others use the track name as shipped. */
export function examNameFor(pack: ExamPackOption, examScope: string, province: string): string {
  if (!pack.regionScoped) return pack.examName;
  return examScope === 'national' ? `国家${pack.examName}` : `${province || ''}${pack.examName}`;
}

export function applyScoreDefaults(
  subjects: readonly ExamSubjectView[],
  current: ScoreEntries,
  target: ScoreEntries
): void {
  for (const subject of subjects) {
    if (!subject.score) continue;
    current[subject.code] ??= String(subject.score.defaultCurrent);
    target[subject.code] ??= String(subject.score.defaultTarget);
  }
}

/** Message for the first problem found, or undefined when every subject is usable. */
export function scoreValidationError(
  subjects: readonly ExamSubjectView[],
  current: ScoreEntries,
  target: ScoreEntries
): string | undefined {
  for (const subject of subjects) {
    const maxScore = subject.score?.maxScore ?? 0;
    if (!target[subject.code]) return OnboardingMessage.RequiredField;
    const entered = [current[subject.code], target[subject.code]]
      .filter((value) => value !== undefined && value !== '')
      .map(Number);
    if (entered.some((value) => !Number.isFinite(value) || value < 0 || value > maxScore)) {
      return OnboardingMessage.InvalidScore;
    }
  }
  return undefined;
}

export function subjectScoreInputs(
  subjects: readonly ExamSubjectView[],
  current: ScoreEntries,
  target: ScoreEntries
): readonly SubjectScoreInput[] {
  return subjects.flatMap((subject) => {
    if (!subject.score) return [];
    const currentScore = Number(current[subject.code]);
    return [{
      subject: subject.code,
      // An unanswered baseline stays absent rather than being recorded as zero.
      ...(current[subject.code] && Number.isFinite(currentScore) ? { currentScore } : {}),
      targetScore: Number(target[subject.code]),
      maxScore: subject.score.maxScore
    }];
  });
}
