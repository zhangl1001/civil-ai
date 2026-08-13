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
  ErrorDiagnosisDimensionCode,
  ErrorDiagnosisDimensionStatus,
  ErrorDiagnosisConfirmationAction,
  EvidenceType,
  EvidenceSource,
  EvidenceCorrectionAction,
  DecisionObservationType,
  isDecisionObservationType,
  QuestionExposureType
} from './domain/EvidenceCodes';
export { errorCauseLabel } from './domain/ErrorCausePresentation';
export {
  choiceAttemptAnswer,
  submittedAnswerLabel,
  submittedOptionIds
} from './domain/ChoiceAttemptAnswer';
export {
  CHOICE_GRADER_VERSION,
  gradeChoiceAnswer,
  type ChoiceAnswerGrade
} from './domain/ChoiceGradingPolicy';
export type {
  AttemptRecord,
  DecisionObservationRecord,
  ErrorDiagnosisRecord,
  ErrorDiagnosisDimension,
  ErrorCorrectionPlan,
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
export { objectiveEvidencePolicyV2 } from './domain/ObjectiveEvidencePolicy';
export {
  ObjectiveEvidenceOrigin,
  objectiveEvidenceOriginFrom,
  objectiveEvidenceOriginReliability,
  type ObjectiveEvidenceOrigin as ObjectiveEvidenceOriginCode
} from './domain/ObjectiveEvidenceOrigin';
export {
  SubmitObjectiveSession,
  type ObjectiveAnswerInput,
  type ObjectiveSessionSubmissionResult,
  type SubmitObjectiveSessionCommand
} from './application/SubmitObjectiveSession';
export { CorrectLearningEvidence, type CorrectLearningEvidenceCommand } from './application/CorrectLearningEvidence';
export {
  ConfirmErrorDiagnosis,
  type ConfirmErrorDiagnosisCommand,
  type ConfirmedDiagnosisMasteryRefresher
} from './application/ConfirmErrorDiagnosis';
export {
  RunAiErrorDiagnosis,
  type AiErrorDiagnosisCompletionObserver
} from './application/RunAiErrorDiagnosis';
export { RequestAiErrorDiagnosis } from './application/RequestAiErrorDiagnosis';
export { CompleteObjectivePractice, type CompleteObjectivePracticeResult } from './application/CompleteObjectivePractice';
export {
  ObjectiveSubmissionPostProcessor,
  type ObjectiveSubmissionPostProcessCommand,
  type ObjectiveSubmissionPostProcessResult
} from './application/ObjectiveSubmissionPostProcessor';
export {
  ProcessObjectiveSubmissionOutbox,
  type ObjectiveSubmissionOutboxBatchResult
} from './application/ProcessObjectiveSubmissionOutbox';
export {
  RecordSubjectiveAssessment,
  type RecordSubjectiveAssessmentCommand,
  type SubjectiveAssessmentDimension
} from './application/RecordSubjectiveAssessment';
export {
  GetObjectiveSessionReview,
  type ObjectiveSessionReview,
  type ObjectiveSessionReviewItem
} from './application/GetObjectiveSessionReview';
export {
  GetWrongBookEntries,
  type WrongBookDiagnosis,
  type WrongBookEntry,
  type WrongBookPage
} from './application/GetWrongBookEntries';
