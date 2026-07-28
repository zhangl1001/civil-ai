export const TutorCyclePhase = {
  Observe: 'observe',
  Diagnose: 'diagnose',
  Propose: 'propose',
  Execute: 'execute',
  Assess: 'assess',
  Schedule: 'schedule'
} as const;

export type TutorCyclePhase = typeof TutorCyclePhase[keyof typeof TutorCyclePhase];

export const TutorDecisionScope = {
  SingleCapability: 'single_capability',
  SingleModule: 'single_module',
  CrossModule: 'cross_module'
} as const;

export type TutorDecisionScope = typeof TutorDecisionScope[keyof typeof TutorDecisionScope];

export const TutorCycleConclusionType = {
  ObjectiveSession: 'objective_session'
} as const;

export type TutorCycleConclusionType = typeof TutorCycleConclusionType[keyof typeof TutorCycleConclusionType];

export const TUTOR_CYCLE_POLICY_VERSION = 'tutor-cycle.v1';
export const TUTOR_CONTEXT_POLICY_VERSION = 'tutor-context.v1';
