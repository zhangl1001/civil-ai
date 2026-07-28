export const QuestionImportDraftStatus = {
  NeedsConfirmation: 'needs_confirmation',
  Confirmed: 'confirmed',
  Published: 'published',
  Rejected: 'rejected'
} as const;

export type QuestionImportDraftStatus =
  typeof QuestionImportDraftStatus[keyof typeof QuestionImportDraftStatus];

export const QuestionImportCandidateStatus = {
  Ready: 'ready',
  NeedsConfirmation: 'needs_confirmation',
  Rejected: 'rejected',
  Published: 'published'
} as const;

export type QuestionImportCandidateStatus =
  typeof QuestionImportCandidateStatus[keyof typeof QuestionImportCandidateStatus];

export const QuestionImportIssueCode = {
  InvalidStructure: 'invalid_structure',
  MissingAnswer: 'missing_answer',
  AnswerConflict: 'answer_conflict',
  InvalidOptions: 'invalid_options',
  MissingSourceIdentity: 'missing_source_identity',
  CapabilityUnresolved: 'capability_unresolved',
  DuplicateSequence: 'duplicate_sequence'
} as const;

export type QuestionImportIssueCode =
  typeof QuestionImportIssueCode[keyof typeof QuestionImportIssueCode];
