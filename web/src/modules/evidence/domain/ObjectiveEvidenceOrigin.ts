export const ObjectiveEvidenceOrigin = {
  OfficialTrue: 'official_true',
  ImportedTrue: 'imported_true',
  UserTrue: 'user_true',
  DiagnosticAnchor: 'diagnostic_anchor',
  AiVariant: 'ai_variant',
  AiTraining: 'ai_training',
  Unknown: 'unknown'
} as const;

export type ObjectiveEvidenceOrigin = typeof ObjectiveEvidenceOrigin[keyof typeof ObjectiveEvidenceOrigin];

export function objectiveEvidenceOriginFrom(value: unknown): ObjectiveEvidenceOrigin {
  if (value === 'official') return ObjectiveEvidenceOrigin.OfficialTrue;
  if (value === 'imported') return ObjectiveEvidenceOrigin.ImportedTrue;
  if (value === 'user_created') return ObjectiveEvidenceOrigin.UserTrue;
  if (value === 'diagnostic_anchor') return ObjectiveEvidenceOrigin.DiagnosticAnchor;
  if (value === 'ai_variant') return ObjectiveEvidenceOrigin.AiVariant;
  if (value === 'ai_generated') return ObjectiveEvidenceOrigin.AiTraining;
  return ObjectiveEvidenceOrigin.Unknown;
}

export function objectiveEvidenceOriginReliability(origin: ObjectiveEvidenceOrigin): number {
  const reliability: Record<ObjectiveEvidenceOrigin, number> = {
    [ObjectiveEvidenceOrigin.OfficialTrue]: 1,
    [ObjectiveEvidenceOrigin.ImportedTrue]: 0.95,
    [ObjectiveEvidenceOrigin.UserTrue]: 0.9,
    [ObjectiveEvidenceOrigin.DiagnosticAnchor]: 0.85,
    [ObjectiveEvidenceOrigin.AiVariant]: 0.8,
    [ObjectiveEvidenceOrigin.AiTraining]: 0.7,
    [ObjectiveEvidenceOrigin.Unknown]: 0.6
  };
  return reliability[origin];
}
