declare const brand: unique symbol;

export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type ProjectId = Brand<string, 'ProjectId'>;
export type CandidateProfileId = Brand<string, 'CandidateProfileId'>;
export type ExamCycleId = Brand<string, 'ExamCycleId'>;
export type OnboardingDraftId = Brand<string, 'OnboardingDraftId'>;
export type ScoreTargetId = Brand<string, 'ScoreTargetId'>;
export type ScoreMeasurementId = Brand<string, 'ScoreMeasurementId'>;
export type ContentDocumentId = Brand<string, 'ContentDocumentId'>;
export type LectureId = Brand<string, 'LectureId'>;
export type ContentSchemaVersionId = Brand<string, 'ContentSchemaVersionId'>;
export type QuestionTemplateVersionId = Brand<string, 'QuestionTemplateVersionId'>;
export type GenerationSpecId = Brand<string, 'GenerationSpecId'>;
export type QuestionSetId = Brand<string, 'QuestionSetId'>;
export type QuestionId = Brand<string, 'QuestionId'>;
export type PromptVersionId = Brand<string, 'PromptVersionId'>;
export type AiInvocationId = Brand<string, 'AiInvocationId'>;
export type MetadataPackageId = Brand<string, 'MetadataPackageId'>;
export type CurriculumVersionId = Brand<string, 'CurriculumVersionId'>;
export type CapabilityNodeId = Brand<string, 'CapabilityNodeId'>;
export type AssessmentPolicyVersionId = Brand<string, 'AssessmentPolicyVersionId'>;
export type LearningThreadId = Brand<string, 'LearningThreadId'>;
export type LearningSessionId = Brand<string, 'LearningSessionId'>;
export type LearningThreadEventId = Brand<string, 'LearningThreadEventId'>;
export type TeachingBlueprintId = Brand<string, 'TeachingBlueprintId'>;
export type AttemptId = Brand<string, 'AttemptId'>;
export type QuestionExposureId = Brand<string, 'QuestionExposureId'>;
export type DecisionObservationId = Brand<string, 'DecisionObservationId'>;
export type GradingResultId = Brand<string, 'GradingResultId'>;
export type ErrorDiagnosisId = Brand<string, 'ErrorDiagnosisId'>;
export type ErrorDiagnosisConfirmationId = Brand<string, 'ErrorDiagnosisConfirmationId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type EvidenceCorrectionId = Brand<string, 'EvidenceCorrectionId'>;
export type ReviewQueueItemId = Brand<string, 'ReviewQueueItemId'>;
export type TutorSessionId = Brand<string, 'TutorSessionId'>;
export type AgentRunId = Brand<string, 'AgentRunId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type OutboxEventId = Brand<string, 'OutboxEventId'>;
export type SubjectCode = Brand<string, 'SubjectCode'>;

export interface IdGenerator {
  next<Name extends string>(namespace: Name): Brand<string, Name>;
}

export function parseId<Name extends string>(value: unknown, field: string): Brand<string, Name> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim() as Brand<string, Name>;
}
