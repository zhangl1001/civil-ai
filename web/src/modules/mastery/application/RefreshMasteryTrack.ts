import type { UnitOfWork } from '@/capabilities/database/public';
import type { CapabilityNodeId, Clock, ExamCycleId, IdGenerator } from '@/kernel/public';
import type { LearningEvidenceRepository } from '@/modules/evidence/public';
import type { MasteryRepository, MasteryTrack } from '../contracts/MasteryRepository';
import { MASTERY_ALGORITHM_VERSION, projectMastery } from '../domain/MasteryProjectionPolicy';
import { MasteryState, ReviewReasonCode, ReviewStatus, ReviewType } from '../domain/MasteryCodes';

export interface RefreshMasteryTrackCommand {
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
}

export class RefreshMasteryTrack {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: MasteryRepository,
    private readonly evidenceRepository: LearningEvidenceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: RefreshMasteryTrackCommand): Promise<MasteryTrack> {
    const [current, evidence] = await Promise.all([
      this.repository.findTrack(command.examCycleId, command.capabilityNodeId),
      this.evidenceRepository.listValid(command.examCycleId, command.capabilityNodeId, 200)
    ]);
    const now = this.clock.now();
    const next = projectMastery({ current, evidence, now });
    if (current?.algorithmVersion === MASTERY_ALGORITHM_VERSION && current.lastEvidenceAt === next.lastEvidenceAt) {
      return current;
    }
    const track: MasteryTrack = {
      id: current?.id ?? this.ids.next('MasteryTrackId'),
      examCycleId: command.examCycleId,
      capabilityNodeId: command.capabilityNodeId,
      ...next,
      lastStateChangeAt: current?.state === next.state ? current.lastStateChangeAt : now,
      algorithmVersion: MASTERY_ALGORITHM_VERSION,
      version: (current?.version ?? 0) + 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    await this.unitOfWork.run(async (context) => {
      await this.repository.upsertTrack(track, current?.version, context);
      await this.repository.appendSnapshot({
        id: this.ids.next('MasterySnapshotId'), masteryTrackId: track.id, examCycleId: track.examCycleId,
        snapshot: { state: track.state, accuracy: track.accuracy, retention: track.retention, transfer: track.transfer, confidence: track.confidence, effectiveSample: track.effectiveSample },
        algorithmVersion: track.algorithmVersion, evidenceCutoffAt: track.lastEvidenceAt ?? now, createdAt: now
      }, context);
      await this.repository.scheduleReview(nextReview(track, now, this.ids), context);
    });
    return track;
  }
}

function nextReview(track: MasteryTrack, now: number, ids: IdGenerator) {
  const repair = track.state === MasteryState.Regressed || track.accuracy < 0.55;
  const stable = track.state === MasteryState.Mastered || track.state === MasteryState.Maintaining;
  const intervalDays = repair ? 0 : stable ? Math.round(3 + track.stability * 27) : 1;
  return {
    id: ids.next('ReviewQueueItemId'), examCycleId: track.examCycleId, capabilityNodeId: track.capabilityNodeId,
    masteryTrackId: track.id, reviewType: repair ? ReviewType.Repair : stable ? ReviewType.Retention : ReviewType.Anchor,
    dueAt: (now + intervalDays * 86_400_000) as typeof track.updatedAt,
    priority: Math.round((1 - track.stability + (repair ? 0.5 : 0)) * 10_000) / 10_000,
    intervalDays, stabilityBefore: track.stability, status: ReviewStatus.Scheduled,
    reason: repair
      ? ReviewReasonCode.RecentPerformanceRegression
      : stable
        ? ReviewReasonCode.SpacedRetentionMaintenance
        : ReviewReasonCode.MasteryEvidenceIncomplete,
    version: 1,
    updatedAt: now as typeof track.updatedAt
  };
}
