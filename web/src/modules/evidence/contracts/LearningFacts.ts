import type {
  AttemptId,
  CapabilityNodeId,
  DecisionObservationId,
  ErrorDiagnosisId,
  ErrorDiagnosisConfirmationId,
  EvidenceCorrectionId,
  EvidenceId,
  ExamCycleId,
  GradingResultId,
  InstantMs,
  JsonObject,
  LearningSessionId,
  LearningThreadId,
  ReviewQueueItemId,
  QuestionExposureId,
  QuestionId,
  QuestionSetId
} from '@/kernel/public';
import type { DecisionObservationType } from '../domain/EvidenceCodes';
import type { AssessmentRole } from '../domain/AssessmentRole';
import type { EvidenceValidity } from '../domain/EvidenceValidity';
import type {
  AttemptResult,
  ConfirmationStatus,
  ErrorCauseCode,
  ErrorDiagnosisDimensionCode,
  ErrorDiagnosisDimensionStatus,
  ErrorDiagnosisConfirmationAction,
  EvidenceCorrectionAction,
  EvidenceSource,
  EvidenceType,
  GradingMethod,
  LearningSessionStatus,
  LearningSessionType,
  QuestionExposureType
} from '../domain/EvidenceCodes';

export interface ErrorDiagnosisDimension {
  readonly code: ErrorDiagnosisDimensionCode;
  readonly status: ErrorDiagnosisDimensionStatus;
  readonly evidence: string;
}

export interface ErrorCorrectionPlan {
  readonly objective: string;
  readonly steps: readonly string[];
  readonly practiceFocus: string;
  readonly successCriteria: string;
}

export interface LearningSessionRecord {
  readonly id: LearningSessionId;
  readonly examCycleId: ExamCycleId;
  readonly learningThreadId: LearningThreadId;
  readonly questionSetId: QuestionSetId;
  readonly reviewQueueItemId?: ReviewQueueItemId;
  readonly sessionType: LearningSessionType;
  readonly assessmentRole: AssessmentRole;
  readonly status: LearningSessionStatus;
  readonly startedAt: InstantMs;
  readonly completedAt: InstantMs;
  readonly elapsedMs: number;
  readonly questionCount: number;
  readonly answeredCount: number;
  readonly correctCount: number;
  readonly idempotencyKey: string;
  readonly version: number;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
}

export interface QuestionExposureRecord {
  readonly id: QuestionExposureId;
  readonly examCycleId: ExamCycleId;
  readonly learningThreadId: LearningThreadId;
  readonly sessionId: LearningSessionId;
  readonly questionId: QuestionId;
  readonly exposureType: QuestionExposureType;
  readonly answerExposed: boolean;
  readonly occurredAt: InstantMs;
  readonly idempotencyKey: string;
}

export interface AttemptRecord {
  readonly id: AttemptId;
  readonly sessionId: LearningSessionId;
  readonly questionId: QuestionId;
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly learningThreadId: LearningThreadId;
  readonly assessmentRole: AssessmentRole;
  readonly questionContentVersion: number;
  readonly answer: JsonObject;
  readonly result: AttemptResult;
  readonly score: number;
  readonly elapsedMs?: number;
  readonly confidence?: number;
  readonly hintLevel: number;
  readonly answerChangeCount: number;
  readonly submittedAt: InstantMs;
  readonly idempotencyKey: string;
}

export interface DecisionObservationRecord {
  readonly id: DecisionObservationId;
  readonly attemptId: AttemptId;
  readonly observationType: DecisionObservationType;
  readonly valueCode: string;
  readonly value: JsonObject;
  readonly source: 'user' | 'system' | 'tutor_ai';
  readonly confidence: number;
  readonly occurredAt: InstantMs;
}

export interface GradingResultRecord {
  readonly id: GradingResultId;
  readonly attemptId: AttemptId;
  readonly gradingMethod: GradingMethod;
  readonly graderVersion: string;
  readonly result: AttemptResult;
  readonly score: number;
  readonly normalizedFeedback: JsonObject;
  readonly rawResponse?: JsonObject;
  readonly confidence: number;
  readonly confirmationStatus: ConfirmationStatus;
  readonly createdAt: InstantMs;
  readonly idempotencyKey: string;
}

export interface ErrorDiagnosisRecord {
  readonly id: ErrorDiagnosisId;
  readonly sessionId: LearningSessionId;
  readonly gradingResultId: GradingResultId;
  readonly attemptId: AttemptId;
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly causeCode: ErrorCauseCode;
  readonly errorStage?: string;
  readonly detail: string;
  readonly confidence: number;
  readonly confirmationStatus: Exclude<ConfirmationStatus, 'not_required'>;
  readonly prerequisiteCapabilityNodeId?: CapabilityNodeId;
  readonly recommendedActionCode: string;
  readonly dimensions: readonly ErrorDiagnosisDimension[];
  readonly correctionPlan: ErrorCorrectionPlan;
  readonly source: 'deterministic' | 'tutor_ai' | 'user';
  readonly createdAt: InstantMs;
  readonly idempotencyKey: string;
}

/** An immutable confirmation or correction of an AI/deterministic diagnosis. */
export interface ErrorDiagnosisConfirmationRecord {
  readonly id: ErrorDiagnosisConfirmationId;
  readonly diagnosisId: ErrorDiagnosisId;
  readonly attemptId: AttemptId;
  readonly examCycleId: ExamCycleId;
  readonly action: ErrorDiagnosisConfirmationAction;
  readonly correctedCauseCode?: ErrorCauseCode;
  readonly correctedDetail?: string;
  readonly actorType: 'user' | 'system' | 'tutor_ai';
  readonly createdAt: InstantMs;
  readonly idempotencyKey: string;
}

/** Read model for the latest accepted diagnosis state; source diagnoses remain unchanged. */
export interface ErrorDiagnosisCurrentProjection {
  readonly diagnosisId: ErrorDiagnosisId;
  readonly latestConfirmationId: ErrorDiagnosisConfirmationId;
  readonly confirmationStatus: Exclude<ConfirmationStatus, 'not_required' | 'pending'>;
  readonly effectiveCauseCode: ErrorCauseCode;
  readonly effectiveDetail: string;
  readonly updatedAt: InstantMs;
  readonly version: number;
}

export interface LearningEvidenceRecord {
  readonly id: EvidenceId;
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly attemptId?: AttemptId;
  readonly assessmentRole: AssessmentRole;
  readonly evidenceType: EvidenceType;
  readonly value?: number;
  readonly weight: number;
  readonly quality: number;
  readonly source: EvidenceSource;
  readonly validationPolicyVersion: string;
  readonly occurredAt: InstantMs;
  readonly idempotencyKey: string;
  readonly metadata: JsonObject;
}

export interface EvidenceCorrectionRecord {
  readonly id: EvidenceCorrectionId;
  readonly examCycleId: ExamCycleId;
  readonly evidenceId: EvidenceId;
  readonly action: EvidenceCorrectionAction;
  readonly reasonCode: string;
  readonly reasonDetail?: string;
  readonly replacementEvidenceId?: EvidenceId;
  readonly actorType: 'user' | 'system' | 'tutor_ai';
  readonly createdAt: InstantMs;
  readonly idempotencyKey: string;
}

export interface EvidenceValidityProjection {
  readonly evidenceId: EvidenceId;
  readonly validityStatus: EvidenceValidity;
  readonly latestCorrectionId?: EvidenceCorrectionId;
  readonly updatedAt: InstantMs;
  readonly version: number;
}

export interface ObjectiveSessionFacts {
  readonly session: LearningSessionRecord;
  readonly exposures: readonly QuestionExposureRecord[];
  readonly attempts: readonly AttemptRecord[];
  readonly observations: readonly DecisionObservationRecord[];
  readonly gradings: readonly GradingResultRecord[];
}

export interface ObjectiveSubmissionBundle extends ObjectiveSessionFacts {
  readonly diagnoses: readonly ErrorDiagnosisRecord[];
  readonly evidence: readonly LearningEvidenceRecord[];
  readonly validity: readonly EvidenceValidityProjection[];
}
