export const EvidenceValidity = {
  Valid: 'valid',
  Invalid: 'invalid',
  Superseded: 'superseded',
  Disputed: 'disputed'
} as const;

export type EvidenceValidity = typeof EvidenceValidity[keyof typeof EvidenceValidity];

const values: ReadonlySet<string> = new Set(Object.values(EvidenceValidity));

export function isEvidenceValidity(value: unknown): value is EvidenceValidity {
  return typeof value === 'string' && values.has(value);
}
