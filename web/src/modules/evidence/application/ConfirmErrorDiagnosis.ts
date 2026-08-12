import type { UnitOfWork } from '@/capabilities/database/public';
import { AssessmentRole, type Clock, type ErrorDiagnosisId, type IdGenerator, type JsonObject } from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { ErrorDiagnosisCurrentProjection, ErrorDiagnosisRecord, LearningEvidenceRecord } from '../contracts/LearningFacts';
import type { ErrorDiagnosisRepository, LearningEvidenceRepository } from '../contracts/LearningRepositories';
import {
  ErrorCauseCode,
  ErrorDiagnosisConfirmationAction,
  ErrorDiagnosisDimensionCode,
  ErrorDiagnosisDimensionStatus,
  EvidenceSource,
  EvidenceType
} from '../domain/EvidenceCodes';
import { EvidenceValidity } from '../domain/EvidenceValidity';

export interface ConfirmErrorDiagnosisCommand {
  readonly idempotencyKey: string;
  readonly diagnosisId: ErrorDiagnosisId;
  readonly action: ErrorDiagnosisConfirmationAction;
  readonly actorType: 'user' | 'system' | 'tutor_ai';
  readonly correctedCauseCode?: ErrorDiagnosisCurrentProjection['effectiveCauseCode'];
  readonly correctedDetail?: string;
  readonly payload?: JsonObject;
}

export interface ConfirmedDiagnosisMasteryRefresher {
  execute(command: {
    readonly examCycleId: ErrorDiagnosisRecord['examCycleId'];
    readonly capabilityNodeId: ErrorDiagnosisRecord['capabilityNodeId'];
  }): Promise<unknown>;
}

/**
 * Keeps the original diagnosis immutable. The projection is only a query cache
 * over confirmation facts and is guarded with optimistic versioning.
 */
export class ConfirmErrorDiagnosis {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly diagnosisRepository: ErrorDiagnosisRepository,
    private readonly evidenceRepository: LearningEvidenceRepository,
    private readonly refreshMastery: ConfirmedDiagnosisMasteryRefresher,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: ConfirmErrorDiagnosisCommand): Promise<ErrorDiagnosisCurrentProjection> {
    if (!command.idempotencyKey.trim()) throw new Error('Error diagnosis confirmation requires an idempotency key');
    const duplicated = await this.diagnosisRepository.findConfirmationByIdempotencyKey(command.idempotencyKey);
    if (duplicated) return this.requireProjection(command.diagnosisId);

    const [diagnosis, current] = await Promise.all([
      this.diagnosisRepository.find(command.diagnosisId),
      this.diagnosisRepository.findCurrentProjection(command.diagnosisId)
    ]);
    if (!diagnosis) throw new Error(`Error diagnosis does not exist: ${command.diagnosisId}`);
    validateCommand(command);
    const now = this.clock.now();
    const confirmation = {
      id: this.ids.next('ErrorDiagnosisConfirmationId'),
      diagnosisId: diagnosis.id,
      attemptId: diagnosis.attemptId,
      examCycleId: diagnosis.examCycleId,
      action: command.action,
      correctedCauseCode: command.action === ErrorDiagnosisConfirmationAction.Correct ? command.correctedCauseCode : undefined,
      correctedDetail: command.action === ErrorDiagnosisConfirmationAction.Correct ? command.correctedDetail?.trim() : undefined,
      actorType: command.actorType,
      createdAt: now,
      idempotencyKey: command.idempotencyKey
    };
    const projection: ErrorDiagnosisCurrentProjection = {
      diagnosisId: diagnosis.id,
      latestConfirmationId: confirmation.id,
      confirmationStatus: statusFor(command.action),
      effectiveCauseCode: command.action === ErrorDiagnosisConfirmationAction.Correct
        ? command.correctedCauseCode!
        : diagnosis.causeCode,
      effectiveDetail: command.action === ErrorDiagnosisConfirmationAction.Correct
        ? command.correctedDetail!.trim()
        : diagnosis.detail,
      updatedAt: now,
      version: (current?.version ?? 0) + 1
    };
    const evidence = confirmedDiagnosisEvidence(diagnosis, command, confirmation.id, now, this.ids);
    try {
      await this.unitOfWork.run(async (context) => {
        await this.diagnosisRepository.appendConfirmation(confirmation, projection, current?.version, context);
        await this.evidenceRepository.append(
          evidence,
          evidence.map((item) => ({
            evidenceId: item.id,
            validityStatus: EvidenceValidity.Valid,
            updatedAt: now,
            version: 1
          })),
          context
        );
        await this.outboxRepository.append({
          id: this.ids.next('OutboxEventId'),
          aggregateType: 'error_diagnosis',
          aggregateId: diagnosis.id,
          eventType: 'error_diagnosis.confirmed',
          payload: {
            diagnosisId: diagnosis.id,
            attemptId: diagnosis.attemptId,
            action: confirmation.action,
            confirmationStatus: projection.confirmationStatus,
            effectiveCauseCode: projection.effectiveCauseCode,
            ...command.payload
          },
          occurredAt: now,
          attemptCount: 0,
          idempotencyKey: `${command.idempotencyKey}:outbox`
        }, context);
      });
    } catch (error) {
      const concurrent = await this.diagnosisRepository.findConfirmationByIdempotencyKey(command.idempotencyKey);
      if (concurrent) return this.requireProjection(command.diagnosisId);
      throw error;
    }
    if (evidence.length) {
      await this.refreshMastery.execute({
        examCycleId: diagnosis.examCycleId,
        capabilityNodeId: diagnosis.capabilityNodeId
      });
    }
    return projection;
  }

  private async requireProjection(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisCurrentProjection> {
    const projection = await this.diagnosisRepository.findCurrentProjection(diagnosisId);
    if (!projection) throw new Error(`Error diagnosis confirmation projection is unavailable: ${diagnosisId}`);
    return projection;
  }
}

function confirmedDiagnosisEvidence(
  diagnosis: ErrorDiagnosisRecord,
  command: ConfirmErrorDiagnosisCommand,
  confirmationId: string,
  now: ReturnType<Clock['now']>,
  ids: IdGenerator
): readonly LearningEvidenceRecord[] {
  if (command.action === ErrorDiagnosisConfirmationAction.Reject) return [];
  const effectiveCause = command.action === ErrorDiagnosisConfirmationAction.Correct
    ? command.correctedCauseCode!
    : diagnosis.causeCode;
  const dimensions = command.action === ErrorDiagnosisConfirmationAction.Correct
    ? [{ code: dimensionForCause(effectiveCause), status: ErrorDiagnosisDimensionStatus.Risk }]
    : diagnosis.dimensions;
  const dimensionEvidence = dimensions.flatMap((dimension, index) => {
    const value = diagnosisDimensionValue(dimension.status);
    if (value === undefined) return [];
    const mapped = evidenceTypeForDimension(dimension.code, effectiveCause);
    if (!mapped) return [];
    return [{
      id: ids.next('EvidenceId'),
      examCycleId: diagnosis.examCycleId,
      capabilityNodeId: diagnosis.capabilityNodeId,
      attemptId: diagnosis.attemptId,
      assessmentRole: AssessmentRole.Practice,
      evidenceType: mapped.evidenceType,
      value,
      weight: 0.55,
      quality: Math.min(1, Math.max(0.45, diagnosis.confidence)),
      source: EvidenceSource.UserConfirmation,
      validationPolicyVersion: 'confirmed-error-diagnosis:v1',
      occurredAt: now,
      idempotencyKey: `${command.idempotencyKey}:evidence:${mapped.masteryDimension}:${index}`,
      metadata: {
        diagnosisId: diagnosis.id,
        confirmationId,
        causeCode: effectiveCause,
        diagnosisDimension: dimension.code,
        diagnosisStatus: dimension.status,
        masteryDimension: mapped.masteryDimension
      }
    } satisfies LearningEvidenceRecord];
  });
  return [
    ...dimensionEvidence,
    {
      id: ids.next('EvidenceId'),
      examCycleId: diagnosis.examCycleId,
      capabilityNodeId: diagnosis.capabilityNodeId,
      attemptId: diagnosis.attemptId,
      assessmentRole: AssessmentRole.Practice,
      evidenceType: EvidenceType.UserConfirmation,
      value: 1,
      weight: 0.2,
      quality: 1,
      source: EvidenceSource.UserConfirmation,
      validationPolicyVersion: 'confirmed-error-diagnosis:v1',
      occurredAt: now,
      idempotencyKey: `${command.idempotencyKey}:evidence:user-confirmation`,
      metadata: { diagnosisId: diagnosis.id, confirmationId, causeCode: effectiveCause }
    }
  ];
}

function diagnosisDimensionValue(status: string): number | undefined {
  if (status === ErrorDiagnosisDimensionStatus.Gap) return 0.15;
  if (status === ErrorDiagnosisDimensionStatus.Risk) return 0.4;
  if (status === ErrorDiagnosisDimensionStatus.Adequate) return 0.85;
  return undefined;
}

function evidenceTypeForDimension(
  code: string,
  cause: ErrorDiagnosisRecord['causeCode']
): { readonly evidenceType: LearningEvidenceRecord['evidenceType']; readonly masteryDimension: string } | undefined {
  if (code === ErrorDiagnosisDimensionCode.KnowledgeConcept) {
    return { evidenceType: EvidenceType.TeachingComprehension, masteryDimension: 'concept' };
  }
  if (code === ErrorDiagnosisDimensionCode.QuestionRecognition) {
    return { evidenceType: EvidenceType.MethodRecognition, masteryDimension: 'recognition' };
  }
  if (code === ErrorDiagnosisDimensionCode.MethodSelection) {
    return { evidenceType: EvidenceType.MethodRecognition, masteryDimension: 'method' };
  }
  if (code === ErrorDiagnosisDimensionCode.TransferRetention && cause === ErrorCauseCode.RetentionFailure) {
    return { evidenceType: EvidenceType.Retention, masteryDimension: 'retention' };
  }
  if (code === ErrorDiagnosisDimensionCode.TransferRetention && cause === ErrorCauseCode.TransferFailure) {
    return { evidenceType: EvidenceType.Transfer, masteryDimension: 'transfer' };
  }
  return undefined;
}

function dimensionForCause(cause: ErrorDiagnosisRecord['causeCode']): string {
  if (cause === ErrorCauseCode.ConceptGap) return ErrorDiagnosisDimensionCode.KnowledgeConcept;
  if (cause === ErrorCauseCode.RecognitionError) return ErrorDiagnosisDimensionCode.QuestionRecognition;
  if (cause === ErrorCauseCode.MethodSelectionError) return ErrorDiagnosisDimensionCode.MethodSelection;
  if (cause === ErrorCauseCode.RetentionFailure || cause === ErrorCauseCode.TransferFailure) {
    return ErrorDiagnosisDimensionCode.TransferRetention;
  }
  return ErrorDiagnosisDimensionCode.ReasoningProcess;
}

function validateCommand(command: ConfirmErrorDiagnosisCommand): void {
  if (command.action !== ErrorDiagnosisConfirmationAction.Correct) {
    if (command.correctedCauseCode || command.correctedDetail?.trim()) {
      throw new Error('Only a corrected diagnosis may provide corrected cause or detail');
    }
    return;
  }
  if (!command.correctedCauseCode || !command.correctedDetail?.trim()) {
    throw new Error('A corrected diagnosis requires cause code and detail');
  }
}

function statusFor(action: ErrorDiagnosisConfirmationAction): ErrorDiagnosisCurrentProjection['confirmationStatus'] {
  if (action === ErrorDiagnosisConfirmationAction.Confirm) return 'confirmed';
  if (action === ErrorDiagnosisConfirmationAction.Reject) return 'rejected';
  return 'corrected';
}
