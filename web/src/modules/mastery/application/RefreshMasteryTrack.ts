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
  const hasMemoryEvidence = track.retention > 0 || track.transfer > 0;
  const intervalDays = reviewIntervalDays(track);
  return {
    id: ids.next('ReviewQueueItemId'), examCycleId: track.examCycleId, capabilityNodeId: track.capabilityNodeId,
    masteryTrackId: track.id, reviewType: repair ? ReviewType.Repair : hasMemoryEvidence ? ReviewType.Retention : ReviewType.Anchor,
    dueAt: (now + intervalDays * 86_400_000) as typeof track.updatedAt,
    priority: Math.round((1 - track.stability + (repair ? 0.5 : 0)) * 10_000) / 10_000,
    intervalDays, stabilityBefore: track.stability, status: ReviewStatus.Scheduled,
    reason: repair
      ? ReviewReasonCode.RecentPerformanceRegression
      : hasMemoryEvidence
        ? ReviewReasonCode.SpacedRetentionMaintenance
        : ReviewReasonCode.MasteryEvidenceIncomplete,
    version: 1,
    updatedAt: now as typeof track.updatedAt
  };
}

/**
 * Builds a progressive 1-60 day interval from actual evidence rather than
 * requiring a terminal mastery state before spaced review can expand.
 */
export function reviewIntervalDays(track: Pick<MasteryTrack,
  'state' | 'accuracy' | 'retention' | 'transfer' | 'stability' | 'confidence' | 'effectiveSample'
>): number {
  if (track.state === MasteryState.Regressed || track.accuracy < 0.55) return 0;
  const maturity = Math.min(1, track.effectiveSample / 18);
  const memoryStrength = track.accuracy * 0.2
    + track.retention * 0.35
    + track.transfer * 0.2
    + track.stability * 0.25;
  const confidenceFactor = 0.35 + track.confidence * 0.65;
  const interval = Math.max(1, Math.min(60, Math.round(1 + 59 * memoryStrength * maturity * confidenceFactor)));
  return track.retention <= 0 && track.transfer <= 0 ? Math.min(7, interval) : interval;
}
