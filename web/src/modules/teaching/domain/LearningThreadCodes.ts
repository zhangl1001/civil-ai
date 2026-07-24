export const LearningThreadStatus = {
  Active: 'active',
  Paused: 'paused',
  Completed: 'completed',
  Abandoned: 'abandoned'
} as const;
export type LearningThreadStatus = typeof LearningThreadStatus[keyof typeof LearningThreadStatus];

export const LearningThreadOrigin = {
  Diagnosis: 'diagnosis',
  WrongAnswer: 'wrong_answer',
  DailyPlan: 'daily_plan',
  UserRequest: 'user_request',
  TutorDecision: 'tutor_decision'
} as const;
export type LearningThreadOrigin = typeof LearningThreadOrigin[keyof typeof LearningThreadOrigin];

export const LearningThreadEventType = {
  Created: 'created',
  StageAdvanced: 'stage_advanced',
  Paused: 'paused',
  Resumed: 'resumed',
  Completed: 'completed',
  Abandoned: 'abandoned',
  StrategyChanged: 'strategy_changed',
  UserIntervened: 'user_intervened'
} as const;
export type LearningThreadEventType = typeof LearningThreadEventType[keyof typeof LearningThreadEventType];
