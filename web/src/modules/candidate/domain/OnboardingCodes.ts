export const BaselineStatus = {
  NeedsDiagnosis: 'needs_diagnosis',
  SelfReported: 'self_reported'
} as const;

export type BaselineStatus = typeof BaselineStatus[keyof typeof BaselineStatus];

export const StudyMode = {
  FullTime: 'full_time',
  PartTime: 'part_time',
  Mixed: 'mixed'
} as const;

export type StudyMode = typeof StudyMode[keyof typeof StudyMode];

export const TeachingOrder = {
  ExplainThenPractice: 'explain_then_practice',
  DiagnoseThenExplain: 'diagnose_then_explain',
  PracticeThenExplain: 'practice_then_explain'
} as const;

export type TeachingOrder = typeof TeachingOrder[keyof typeof TeachingOrder];

export const CompanionTone = {
  Gentle: 'gentle',
  Balanced: 'balanced',
  Direct: 'direct'
} as const;

export type CompanionTone = typeof CompanionTone[keyof typeof CompanionTone];

export const CandidateCommandType = {
  CreateExamCycle: 'candidate.create_exam_cycle',
  UpdateScoreTargets: 'candidate.update_score_targets'
} as const;

export const CandidateEventType = {
  ExamCycleCreated: 'candidate.exam_cycle_created',
  ScoreTargetsUpdated: 'candidate.score_targets_updated'
} as const;

export const CandidateResourceType = {
  ExamCycle: 'exam_cycle'
} as const;
