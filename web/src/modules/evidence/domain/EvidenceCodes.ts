export const LearningSessionType = {
  Practice: 'practice',
  Review: 'review',
  Diagnosis: 'diagnosis',
  Mock: 'mock',
  Retention: 'retention',
  Transfer: 'transfer',
  Anchor: 'anchor'
} as const;
export type LearningSessionType = typeof LearningSessionType[keyof typeof LearningSessionType];

export const LearningSessionStatus = {
  InProgress: 'in_progress',
  Completed: 'completed',
  Abandoned: 'abandoned'
} as const;
export type LearningSessionStatus = typeof LearningSessionStatus[keyof typeof LearningSessionStatus];

export const AttemptResult = {
  Correct: 'correct',
  Incorrect: 'incorrect',
  Unanswered: 'unanswered',
  Partial: 'partial'
} as const;
export type AttemptResult = typeof AttemptResult[keyof typeof AttemptResult];

/**
 * The learner answered and got it wrong, wholly or in part. This is the review
 * loop's entry condition: the wrong book, AI error diagnosis, tutor conclusions
 * and the post-submit page all key off it.
 *
 * Kept as one predicate because adding `partial` to the result set silently
 * dropped those attempts out of every one of those consumers.
 */
export function isMistakenAttempt(result: string): boolean {
  return result === AttemptResult.Incorrect || result === AttemptResult.Partial;
}

export const GradingMethod = {
  Deterministic: 'deterministic',
  AiAssisted: 'ai_assisted',
  Rubric: 'rubric'
} as const;
export type GradingMethod = typeof GradingMethod[keyof typeof GradingMethod];

export const ConfirmationStatus = {
  NotRequired: 'not_required',
  Pending: 'pending',
  Confirmed: 'confirmed',
  Rejected: 'rejected',
  Corrected: 'corrected'
} as const;
export type ConfirmationStatus = typeof ConfirmationStatus[keyof typeof ConfirmationStatus];

export const ErrorCauseCode = {
  ConceptGap: 'concept_gap',
  RecognitionError: 'recognition_error',
  MethodSelectionError: 'method_selection_error',
  ReasoningError: 'reasoning_error',
  CalculationError: 'calculation_error',
  EvidenceExtractionError: 'evidence_extraction_error',
  TrapMisjudgment: 'trap_misjudgment',
  TimeManagementError: 'time_management_error',
  CarelessError: 'careless_error',
  TransferFailure: 'transfer_failure',
  RetentionFailure: 'retention_failure',
  Unknown: 'unknown'
} as const;
export type ErrorCauseCode = typeof ErrorCauseCode[keyof typeof ErrorCauseCode];

export const ErrorDiagnosisDimensionCode = {
  KnowledgeConcept: 'knowledge_concept',
  QuestionRecognition: 'question_recognition',
  MethodSelection: 'method_selection',
  ReasoningProcess: 'reasoning_process',
  EvidenceExtraction: 'evidence_extraction',
  CalculationExecution: 'calculation_execution',
  OptionElimination: 'option_elimination',
  TimeStrategy: 'time_strategy',
  TransferRetention: 'transfer_retention'
} as const;
export type ErrorDiagnosisDimensionCode = typeof ErrorDiagnosisDimensionCode[keyof typeof ErrorDiagnosisDimensionCode];

export const ErrorDiagnosisDimensionStatus = {
  Gap: 'gap',
  Risk: 'risk',
  Adequate: 'adequate',
  Unknown: 'unknown'
} as const;
export type ErrorDiagnosisDimensionStatus = typeof ErrorDiagnosisDimensionStatus[keyof typeof ErrorDiagnosisDimensionStatus];

export const ErrorDiagnosisConfirmationAction = {
  Confirm: 'confirm',
  Reject: 'reject',
  Correct: 'correct'
} as const;
export type ErrorDiagnosisConfirmationAction = typeof ErrorDiagnosisConfirmationAction[keyof typeof ErrorDiagnosisConfirmationAction];

export const EvidenceType = {
  Correctness: 'correctness',
  Speed: 'speed',
  Retention: 'retention',
  Transfer: 'transfer',
  MethodRecognition: 'method_recognition',
  ErrorRecurrence: 'error_recurrence',
  TeachingComprehension: 'teaching_comprehension',
  UserConfirmation: 'user_confirmation'
} as const;
export type EvidenceType = typeof EvidenceType[keyof typeof EvidenceType];

export const EvidenceSource = {
  DeterministicGrader: 'deterministic_grader',
  AiGrader: 'ai_grader',
  UserConfirmation: 'user_confirmation',
  System: 'system'
} as const;
export type EvidenceSource = typeof EvidenceSource[keyof typeof EvidenceSource];

export const EvidenceCorrectionAction = {
  Invalidate: 'invalidate',
  Supersede: 'supersede',
  Dispute: 'dispute',
  Reinstate: 'reinstate'
} as const;
export type EvidenceCorrectionAction = typeof EvidenceCorrectionAction[keyof typeof EvidenceCorrectionAction];

export const DecisionObservationType = {
  QuestionRecognition: 'question_recognition',
  MethodSelection: 'method_selection',
  KeyEvidence: 'key_evidence',
  OptionElimination: 'option_elimination',
  ErrorStage: 'error_stage',
  ConfidenceReport: 'confidence_report',
  UserConfirmation: 'user_confirmation'
} as const;
export type DecisionObservationType = typeof DecisionObservationType[keyof typeof DecisionObservationType];

export function isDecisionObservationType(value: unknown): value is DecisionObservationType {
  return typeof value === 'string'
    && Object.values(DecisionObservationType).includes(value as DecisionObservationType);
}

export const QuestionExposureType = {
  LectureExample: 'lecture_example',
  Preview: 'preview',
  Hint: 'hint',
  Practice: 'practice',
  Assessment: 'assessment'
} as const;
export type QuestionExposureType = typeof QuestionExposureType[keyof typeof QuestionExposureType];
