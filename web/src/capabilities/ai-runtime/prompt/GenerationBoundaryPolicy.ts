export const GenerationConstraintClass = {
  Structural: 'structural',
  SafetyRange: 'safety_range',
  Autonomous: 'autonomous'
} as const;

export type GenerationConstraintClass =
  typeof GenerationConstraintClass[keyof typeof GenerationConstraintClass];

/**
 * These limits protect rendering and local resource usage. Values inside the
 * range are teaching decisions, not quality gates.
 */
export const GENERATION_AUTONOMY_LIMITS = {
  lectureSections: { min: 1, max: 12 },
  teachingListItems: { min: 0, max: 8 },
  materialGroups: { min: 0, max: 12 },
  explanationSteps: { min: 1, max: 8 },
  explanationPitfalls: { min: 0, max: 6 },
  objectiveQuestions: { min: 1, max: 25 }
} as const;

