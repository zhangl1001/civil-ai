import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ErrorDiagnosisId, IdGenerator, JsonObject } from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { ErrorDiagnosisCurrentProjection } from '../contracts/LearningFacts';
import type { ErrorDiagnosisRepository } from '../contracts/LearningRepositories';
import { ErrorDiagnosisConfirmationAction } from '../domain/EvidenceCodes';

export interface ConfirmErrorDiagnosisCommand {
  readonly idempotencyKey: string;
  readonly diagnosisId: ErrorDiagnosisId;
  readonly action: ErrorDiagnosisConfirmationAction;
  readonly actorType: 'user' | 'system' | 'tutor_ai';
  readonly correctedCauseCode?: ErrorDiagnosisCurrentProjection['effectiveCauseCode'];
  readonly correctedDetail?: string;
  readonly payload?: JsonObject;
}

/**
 * Keeps the original diagnosis immutable. The projection is only a query cache
 * over confirmation facts and is guarded with optimistic versioning.
 */
export class ConfirmErrorDiagnosis {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly diagnosisRepository: ErrorDiagnosisRepository,
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
    try {
      await this.unitOfWork.run(async (context) => {
        await this.diagnosisRepository.appendConfirmation(confirmation, projection, current?.version, context);
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
      return projection;
    } catch (error) {
      const concurrent = await this.diagnosisRepository.findConfirmationByIdempotencyKey(command.idempotencyKey);
      if (concurrent) return this.requireProjection(command.diagnosisId);
      throw error;
    }
  }

  private async requireProjection(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisCurrentProjection> {
    const projection = await this.diagnosisRepository.findCurrentProjection(diagnosisId);
    if (!projection) throw new Error(`Error diagnosis confirmation projection is unavailable: ${diagnosisId}`);
    return projection;
  }
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
