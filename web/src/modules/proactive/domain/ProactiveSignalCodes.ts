export const ProactiveSignalType = {
  DailyCheckin: 'daily_checkin',
  ReviewDue: 'review_due',
  PlanAtRisk: 'plan_at_risk',
  MasteryRegressed: 'mastery_regressed',
  GoalGap: 'goal_gap',
  Celebration: 'celebration'
} as const;

export type ProactiveSignalType = typeof ProactiveSignalType[keyof typeof ProactiveSignalType];

export const ProactiveSignalStatus = {
  Pending: 'pending',
  Delivered: 'delivered',
  Acted: 'acted',
  Dismissed: 'dismissed',
  Expired: 'expired'
} as const;

export type ProactiveSignalStatus = typeof ProactiveSignalStatus[keyof typeof ProactiveSignalStatus];
