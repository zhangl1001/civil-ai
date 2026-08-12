export const LearningAssetKind = {
  EssayQuestion: 'essay_question',
  EssayDraft: 'essay_draft',
  EssayAttempt: 'essay_attempt',
  InterviewSession: 'interview_session',
  DigestDaily: 'digest_daily',
  DigestMonthly: 'digest_monthly',
  StudyLecture: 'study_lecture',
  MockManifest: 'mock_manifest',
  PracticeManifest: 'practice_manifest',
  PracticeSessionDraft: 'practice_session_draft',
  ChatAttachment: 'chat_attachment',
  ProfileInsight: 'profile_insight'
} as const;

export type LearningAssetKind = typeof LearningAssetKind[keyof typeof LearningAssetKind];

export const LearningAssetStatus = {
  Draft: 'draft',
  Ready: 'ready',
  Retired: 'retired'
} as const;

export type LearningAssetStatus = typeof LearningAssetStatus[keyof typeof LearningAssetStatus];

export const LearningAssetPurpose = {
  Practice: 'practice',
  Mock: 'mock',
  TrueQuestion: 'true_question',
  LegacyUnknown: 'legacy_unknown'
} as const;

export type LearningAssetPurpose = typeof LearningAssetPurpose[keyof typeof LearningAssetPurpose];
