import type { SubjectCode } from '@/kernel/public';
import type { ExamSubjectView } from '@/modules/curriculum/public';
import type { ExamPackOption } from './ExamPackSelectionFeature';
import {
  CompanionTone,
  ExplanationDepth,
  ProactiveLevel,
  StudyMode,
  TeachingOrder
} from '@/modules/candidate/public';
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

/**
 * Restores saved scores, keeping only subjects the active package still offers.
 * A draft can outlive the package it was written against, so stale subject keys
 * are dropped rather than resurrected into a form that cannot be submitted.
 */
export function restoreScoreEntries(
  subjects: readonly ExamSubjectView[],
  saved: Readonly<Record<string, unknown>>,
  current: ScoreEntries,
  target: ScoreEntries
): void {
  const offered = new Set<string>(subjects.map((subject) => subject.code));
  for (const [field, entries] of [['currentScores', current], ['targetScores', target]] as const) {
    const record = saved[field];
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    for (const [code, value] of Object.entries(record as Record<string, unknown>)) {
      if (offered.has(code) && typeof value === 'string') entries[code] = value;
    }
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

export interface StudyRhythmForm {
  readonly studyMode: string;
  readonly weeklyStudyDays: number;
  readonly weekdayMinutes: number;
  readonly weekendMinutes: number;
  readonly maxFocusMinutes: number;
  readonly teachingOrder: string;
  readonly proactiveLevel: string;
}

/** Maps the rhythm step onto the candidate cycle command's study and preference blocks. */
export function studyRhythmInput(form: StudyRhythmForm) {
  return {
    study: {
      mode: form.studyMode as typeof StudyMode[keyof typeof StudyMode],
      weeklyStudyDays: form.weeklyStudyDays,
      weekdayMinutes: form.weekdayMinutes,
      weekendMinutes: form.weekendMinutes,
      maxFocusMinutes: form.maxFocusMinutes,
      availableWindows: [],
      interruptionRisks: []
    },
    preferences: {
      teachingOrder: form.teachingOrder as typeof TeachingOrder[keyof typeof TeachingOrder],
      explanationDepth: ExplanationDepth.Balanced,
      proactiveLevel: form.proactiveLevel as typeof ProactiveLevel[keyof typeof ProactiveLevel],
      companionTone: CompanionTone.Gentle,
      quietHours: [],
      accessibility: {}
    }
  };
}
