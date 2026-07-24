export { AssessmentRole, isAssessmentRole, type AssessmentRole as AssessmentRoleCode } from './domain/AssessmentRole';
export {
  EvidenceValidity,
  isEvidenceValidity,
  type EvidenceValidity as EvidenceValidityCode
} from './domain/EvidenceValidity';
export {
  LearningSessionType,
  LearningSessionStatus,
  AttemptResult,
  GradingMethod,
  ConfirmationStatus,
  ErrorCauseCode,
  ErrorDiagnosisConfirmationAction,
  EvidenceType,
  EvidenceSource,
  EvidenceCorrectionAction,
  QuestionExposureType
} from './domain/EvidenceCodes';
export { errorCauseLabel } from './domain/ErrorCausePresentation';
export type {
  AttemptRecord,
  DecisionObservationRecord,
  ErrorDiagnosisRecord,
  ErrorDiagnosisConfirmationRecord,
  ErrorDiagnosisCurrentProjection,
  EvidenceCorrectionRecord,
  EvidenceValidityProjection,
  GradingResultRecord,
  LearningEvidenceRecord,
  LearningSessionRecord,
  ObjectiveSessionFacts,
  ObjectiveSubmissionBundle,
  QuestionExposureRecord
} from './contracts/LearningFacts';
export type {
  ErrorDiagnosisRepository,
  LearningEvidenceRepository,
  LearningSessionRepository
} from './contracts/LearningRepositories';
export { objectiveEvidencePolicyV1 } from './domain/ObjectiveEvidencePolicy';
export {
  SubmitObjectiveSession,
  type ObjectiveAnswerInput,
  type ObjectiveSessionSubmissionResult,
  type SubmitObjectiveSessionCommand
} from './application/SubmitObjectiveSession';
export { CorrectLearningEvidence, type CorrectLearningEvidenceCommand } from './application/CorrectLearningEvidence';
export { ConfirmErrorDiagnosis, type ConfirmErrorDiagnosisCommand } from './application/ConfirmErrorDiagnosis';
export { RunAiErrorDiagnosis } from './application/RunAiErrorDiagnosis';
export { RequestAiErrorDiagnosis } from './application/RequestAiErrorDiagnosis';
export { CompleteObjectivePractice, type CompleteObjectivePracticeResult } from './application/CompleteObjectivePractice';
export {
  GetObjectiveSessionReview,
  type ObjectiveSessionReview,
  type ObjectiveSessionReviewItem
} from './application/GetObjectiveSessionReview';
export {
  GetWrongBookEntries,
  type WrongBookDiagnosis,
  type WrongBookEntry
} from './application/GetWrongBookEntries';
