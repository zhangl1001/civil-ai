export const ExamPhase = {
  Foundation: 'foundation',
  Development: 'development',
  Consolidation: 'consolidation',
  Sprint: 'sprint',
  Maintenance: 'maintenance'
} as const;

export type ExamPhase = typeof ExamPhase[keyof typeof ExamPhase];

const values: ReadonlySet<string> = new Set(Object.values(ExamPhase));

export function isExamPhase(value: unknown): value is ExamPhase {
  return typeof value === 'string' && values.has(value);
}
