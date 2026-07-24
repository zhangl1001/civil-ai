export const ScoreTargetStatus = {
  Active: 'active',
  Superseded: 'superseded',
  Cancelled: 'cancelled'
} as const;

export type ScoreTargetStatus = typeof ScoreTargetStatus[keyof typeof ScoreTargetStatus];

export const ScoreTargetSource = {
  Candidate: 'candidate',
  TutorRecommendation: 'tutor_recommendation'
} as const;

export type ScoreTargetSource = typeof ScoreTargetSource[keyof typeof ScoreTargetSource];
