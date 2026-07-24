export const ExamCycleStatus = {
  Draft: 'draft',
  Active: 'active',
  Paused: 'paused',
  Completed: 'completed',
  Cancelled: 'cancelled'
} as const;

export type ExamCycleStatus = typeof ExamCycleStatus[keyof typeof ExamCycleStatus];

const values: ReadonlySet<string> = new Set(Object.values(ExamCycleStatus));

export function isExamCycleStatus(value: unknown): value is ExamCycleStatus {
  return typeof value === 'string' && values.has(value);
}
