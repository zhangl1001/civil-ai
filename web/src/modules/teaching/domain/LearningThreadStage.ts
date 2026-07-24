export const LearningThreadStage = {
  Diagnose: 'diagnose',
  Prerequisite: 'prerequisite',
  Teach: 'teach',
  Guided: 'guided',
  Independent: 'independent',
  Consolidate: 'consolidate',
  Retention: 'retention',
  Transfer: 'transfer',
  Maintain: 'maintain'
} as const;

export type LearningThreadStage = typeof LearningThreadStage[keyof typeof LearningThreadStage];

const values: ReadonlySet<string> = new Set(Object.values(LearningThreadStage));

export function isLearningThreadStage(value: unknown): value is LearningThreadStage {
  return typeof value === 'string' && values.has(value);
}
