export const MessageBusinessLine = {
  Tutor: 'tutor',
  Practice: 'practice',
  Essay: 'essay',
  Interview: 'interview',
  Planning: 'planning',
  Review: 'review',
  Exam: 'exam',
  Digest: 'digest',
  Profile: 'profile',
  System: 'system'
} as const;

export type MessageBusinessLine = typeof MessageBusinessLine[keyof typeof MessageBusinessLine];

export const MessageBusinessLineLabel: Readonly<Record<MessageBusinessLine, string>> = {
  [MessageBusinessLine.Tutor]: '私教',
  [MessageBusinessLine.Practice]: '刷题',
  [MessageBusinessLine.Essay]: '申论',
  [MessageBusinessLine.Interview]: '面试',
  [MessageBusinessLine.Planning]: '计划',
  [MessageBusinessLine.Review]: '复习',
  [MessageBusinessLine.Exam]: '模考',
  [MessageBusinessLine.Digest]: '积累',
  [MessageBusinessLine.Profile]: '档案',
  [MessageBusinessLine.System]: '系统'
};

export const MessageCategory = {
  Task: 'task',
  Learning: 'learning',
  Reminder: 'reminder',
  Result: 'result',
  Warning: 'warning',
  System: 'system'
} as const;

export type MessageCategory = typeof MessageCategory[keyof typeof MessageCategory];

export const MessageCategoryLabel: Readonly<Record<MessageCategory, string>> = {
  [MessageCategory.Task]: '任务',
  [MessageCategory.Learning]: '学习',
  [MessageCategory.Reminder]: '提醒',
  [MessageCategory.Result]: '结果',
  [MessageCategory.Warning]: '预警',
  [MessageCategory.System]: '系统'
};

export const MessageSeverity = {
  Info: 'info',
  Success: 'success',
  Warning: 'warning',
  Error: 'error'
} as const;

export type MessageSeverity = typeof MessageSeverity[keyof typeof MessageSeverity];

export const MessageStatus = {
  Unread: 'unread',
  Read: 'read',
  Archived: 'archived'
} as const;

export type MessageStatus = typeof MessageStatus[keyof typeof MessageStatus];

export const MessageEventCode = {
  TaskQueued: 'task.queued',
  TaskRetrying: 'task.retrying',
  TaskCompleted: 'task.completed',
  TaskFailed: 'task.failed',
  TaskCancelled: 'task.cancelled',
  LearningPlanReady: 'learning.plan_ready',
  LearningResultReady: 'learning.result_ready',
  ReminderDue: 'reminder.due',
  SystemWarning: 'system.warning'
} as const;

export type MessageEventCode = typeof MessageEventCode[keyof typeof MessageEventCode];

export const MessageSourceType = {
  AgentRun: 'agent_run',
  DailyPlan: 'daily_plan',
  ReviewQueue: 'review_queue',
  LearningSession: 'learning_session',
  ExamCycle: 'exam_cycle',
  System: 'system'
} as const;

export type MessageSourceType = typeof MessageSourceType[keyof typeof MessageSourceType];
