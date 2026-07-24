import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, EvidenceId, IdGenerator, JsonObject } from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { LearningEvidenceRepository } from '../contracts/LearningRepositories';
import { EvidenceCorrectionAction } from '../domain/EvidenceCodes';
import { EvidenceValidity } from '../domain/EvidenceValidity';

export interface CorrectLearningEvidenceCommand {
  readonly idempotencyKey: string;
  readonly evidenceId: EvidenceId;
  readonly action: EvidenceCorrectionAction;
  readonly reasonCode: string;
  readonly reasonDetail?: string;
  readonly replacementEvidenceId?: EvidenceId;
  readonly actorType: 'user' | 'system' | 'tutor_ai';
  readonly payload?: JsonObject;
}

export class CorrectLearningEvidence {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly evidenceRepository: LearningEvidenceRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: CorrectLearningEvidenceCommand): Promise<void> {
    if (!command.idempotencyKey.trim() || !command.reasonCode.trim()) throw new Error('Evidence correction requires idempotency key and reason code');
    if (await this.evidenceRepository.findCorrectionByIdempotencyKey(command.idempotencyKey)) return;
    const [evidence, validity] = await Promise.all([
      this.evidenceRepository.find(command.evidenceId),
      this.evidenceRepository.findValidity(command.evidenceId)
    ]);
    if (!evidence || !validity) throw new Error(`Learning evidence does not exist: ${command.evidenceId}`);
    const now = this.clock.now();
    const correction = {
      id: this.ids.next('EvidenceCorrectionId'),
      examCycleId: evidence.examCycleId,
      evidenceId: evidence.id,
      action: command.action,
      reasonCode: command.reasonCode.trim(),
      reasonDetail: command.reasonDetail?.trim() || undefined,
      replacementEvidenceId: command.replacementEvidenceId,
      actorType: command.actorType,
      createdAt: now,
      idempotencyKey: command.idempotencyKey
    };
    if (correction.action === EvidenceCorrectionAction.Supersede && !correction.replacementEvidenceId) {
      throw new Error('Superseded evidence requires replacement evidence');
    }
    const nextValidity = {
      evidenceId: evidence.id,
      validityStatus: validityFor(correction.action),
      latestCorrectionId: correction.id,
      updatedAt: now,
      version: validity.version + 1
    };
    try {
      await this.unitOfWork.run(async (context) => {
        await this.evidenceRepository.appendCorrection(correction, nextValidity, validity.version, context);
        await this.outboxRepository.append({
          id: this.ids.next('OutboxEventId'),
          aggregateType: 'learning_evidence',
          aggregateId: evidence.id,
          eventType: 'learning_evidence.corrected',
          payload: { evidenceId: evidence.id, correctionId: correction.id, action: correction.action, ...command.payload },
          occurredAt: now,
          attemptCount: 0,
          idempotencyKey: `${command.idempotencyKey}:outbox`
        }, context);
      });
    } catch (error) {
      const concurrent = await this.evidenceRepository.findCorrectionByIdempotencyKey(command.idempotencyKey);
      if (concurrent) return;
      throw error;
    }
  }
}

function validityFor(action: EvidenceCorrectionAction): typeof EvidenceValidity[keyof typeof EvidenceValidity] {
  if (action === EvidenceCorrectionAction.Invalidate) return EvidenceValidity.Invalid;
  if (action === EvidenceCorrectionAction.Supersede) return EvidenceValidity.Superseded;
  if (action === EvidenceCorrectionAction.Dispute) return EvidenceValidity.Disputed;
  return EvidenceValidity.Valid;
}
