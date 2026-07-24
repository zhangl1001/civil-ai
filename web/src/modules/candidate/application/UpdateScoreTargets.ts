import type { UnitOfWork } from '@/capabilities/database/public';
import {
  ApplicationError,
  ErrorCategory,
  type Clock,
  type ExamCycleId,
  type IdGenerator,
  type SubjectCode
} from '@/kernel/public';
import type { CommandReceiptRepository, OutboxRepository } from '@/modules/task/public';
import type { CandidateCycleBundle, CandidateRepository, ScoreTarget } from '../contracts/CandidateRepository';
import { CandidateCommandType, CandidateEventType, CandidateResourceType } from '../domain/OnboardingCodes';
import { ScoreTargetSource, ScoreTargetStatus } from '../domain/ScoreTargetStatus';

export interface ScoreTargetChange {
  readonly subject: SubjectCode;
  readonly targetScore: number;
  readonly maxScore: number;
  readonly reason?: string;
}

export interface UpdateScoreTargetsCommand {
  readonly idempotencyKey: string;
  readonly examCycleId: ExamCycleId;
  readonly changes: readonly ScoreTargetChange[];
}

export class UpdateScoreTargets {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly candidateRepository: CandidateRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly receiptRepository: CommandReceiptRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: UpdateScoreTargetsCommand): Promise<CandidateCycleBundle> {
    this.validate(command);
    const receipt = await this.receiptRepository.find(command.idempotencyKey);
    if (receipt) return this.requireCycle(command.examCycleId);

    const current = await this.requireCycle(command.examCycleId);
    const activeTargets = current.scoreTargets.filter((target) => target.status === ScoreTargetStatus.Active);
    const now = this.clock.now();
    const replacements = command.changes.map((change): ScoreTarget => {
      const previous = activeTargets.find((target) => target.subject === change.subject);
      if (!previous) throw this.validationError('candidate.score_target_missing', { subject: change.subject });
      if (previous.maxScore !== change.maxScore) {
        throw this.validationError('candidate.score_scale_change_not_allowed', { subject: change.subject });
      }
      return {
        id: this.ids.next('ScoreTargetId'),
        examCycleId: command.examCycleId,
        subject: change.subject,
        targetScore: change.targetScore,
        maxScore: change.maxScore,
        source: ScoreTargetSource.Candidate,
        reason: change.reason?.trim() || undefined,
        status: ScoreTargetStatus.Active,
        effectiveFrom: now,
        supersedesTargetId: previous.id,
        createdAt: now
      };
    });

    await this.unitOfWork.run(async (context) => {
      await this.candidateRepository.replaceActiveScoreTargets(replacements, context);
      await this.outboxRepository.append({
        id: this.ids.next('OutboxEventId'),
        aggregateType: CandidateResourceType.ExamCycle,
        aggregateId: command.examCycleId,
        eventType: CandidateEventType.ScoreTargetsUpdated,
        payload: {
          examCycleId: command.examCycleId,
          changes: replacements.map((target) => ({
            subject: target.subject,
            targetScore: target.targetScore,
            maxScore: target.maxScore,
            supersedesTargetId: target.supersedesTargetId ?? null
          }))
        },
        occurredAt: now,
        attemptCount: 0,
        idempotencyKey: `${command.idempotencyKey}:score-targets-updated`
      }, context);
      await this.receiptRepository.append({
        idempotencyKey: command.idempotencyKey,
        commandType: CandidateCommandType.UpdateScoreTargets,
        resultResourceType: CandidateResourceType.ExamCycle,
        resultResourceId: command.examCycleId,
        completedAt: now
      }, context);
    });
    return this.requireCycle(command.examCycleId);
  }

  private validate(command: UpdateScoreTargetsCommand): void {
    if (!command.idempotencyKey.trim() || !command.changes.length) {
      throw this.validationError('candidate.score_target_command_invalid');
    }
    const subjects = new Set<string>();
    for (const change of command.changes) {
      if (subjects.has(change.subject)) throw this.validationError('candidate.score_target_subject_duplicate');
      subjects.add(change.subject);
      if (!Number.isFinite(change.targetScore) || !Number.isFinite(change.maxScore)
        || change.maxScore <= 0 || change.targetScore < 0 || change.targetScore > change.maxScore) {
        throw this.validationError('candidate.target_score_invalid', { subject: change.subject });
      }
    }
  }

  private async requireCycle(examCycleId: ExamCycleId): Promise<CandidateCycleBundle> {
    const cycle = await this.candidateRepository.findCycle(examCycleId);
    if (!cycle) {
      throw new ApplicationError({
        code: 'candidate.exam_cycle_not_found',
        category: ErrorCategory.NotFound,
        userMessageKey: 'candidate.examCycle.notFound'
      });
    }
    return cycle;
  }

  private validationError(code: string, details?: Record<string, unknown>): ApplicationError {
    return new ApplicationError({
      code,
      category: ErrorCategory.Validation,
      userMessageKey: 'candidate.scoreTarget.invalid',
      details
    });
  }
}
