export const AssessmentRole = {
  Teaching: 'teaching',
  Guided: 'guided',
  Practice: 'practice',
  Retention: 'retention',
  Transfer: 'transfer',
  Anchor: 'anchor'
} as const;

export type AssessmentRole = typeof AssessmentRole[keyof typeof AssessmentRole];

const values: ReadonlySet<string> = new Set(Object.values(AssessmentRole));

export function isAssessmentRole(value: unknown): value is AssessmentRole {
  return typeof value === 'string' && values.has(value);
}
