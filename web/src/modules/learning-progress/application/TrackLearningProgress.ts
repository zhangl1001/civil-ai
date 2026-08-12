import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ExamCycleId, IdGenerator } from '@/kernel/public';
import type { LearningProgressRecord, LearningProgressRepository } from '../contracts/LearningProgressRepository';
import {
  LearningProgressStatus,
  type LearningProgressStatus as ProgressStatus,
  type LearningResourceType
} from '../domain/LearningProgressCodes';

export interface TrackLearningProgressCommand {
  readonly examCycleId: ExamCycleId;
  readonly resourceType: LearningResourceType;
  readonly resourceKey: string;
  readonly assetId?: string;
  readonly capabilityNodeId?: string;
  readonly dailyPlanItemId?: string;
}

export class TrackLearningProgress {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: LearningProgressRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  start(command: TrackLearningProgressCommand): Promise<LearningProgressRecord> {
    return this.transition(command, LearningProgressStatus.Started);
  }

  complete(command: TrackLearningProgressCommand): Promise<LearningProgressRecord> {
    return this.transition(command, LearningProgressStatus.Completed);
  }

  private async transition(
    command: TrackLearningProgressCommand,
    status: ProgressStatus
  ): Promise<LearningProgressRecord> {
    const resourceKey = command.resourceKey.trim();
    if (!resourceKey) throw new Error('学习资源标识不能为空。');
    const existing = await this.repository.find(command.examCycleId, command.resourceType, resourceKey);
    if (existing?.status === LearningProgressStatus.Completed) return existing;
    const now = this.clock.now();
    const progress: LearningProgressRecord = {
      id: existing?.id ?? this.ids.next('LearningProgressId'),
      examCycleId: command.examCycleId,
      resourceType: command.resourceType,
      resourceKey,
      assetId: command.assetId ?? existing?.assetId,
      capabilityNodeId: command.capabilityNodeId ?? existing?.capabilityNodeId,
      dailyPlanItemId: command.dailyPlanItemId ?? existing?.dailyPlanItemId,
      status,
      startedAt: existing?.startedAt ?? now,
      completedAt: status === LearningProgressStatus.Completed ? now : existing?.completedAt,
      updatedAt: now
    };
    await this.unitOfWork.runAutocommit(async (context) => {
      await this.repository.save(progress, context);
    });
    return progress;
  }
}
