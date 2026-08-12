import type { Clock, ExamCycleId, InstantMs, SubjectCode } from '@/kernel/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import type { CapabilityNode, CurriculumRepository } from '@/modules/curriculum/public';
import {
  latestLectureProgressByCapability,
  type LearningProgressRepository
} from '@/modules/learning-progress/public';
import {
  rankLearnerPriorities,
  readCapabilityRecommendationPreferences,
  type CapabilityRecommendationPreference,
  type LearnerPriorityResult,
  type LearnerPrioritySignal,
  type MasteryRepository,
  type MasteryTrack
} from '@/modules/mastery/public';

export interface LearnerPrioritySnapshot {
  readonly examCycleId: ExamCycleId;
  readonly generatedAt: InstantMs;
  readonly priorities: readonly LearnerPriorityResult[];
}

export class BuildLearnerPrioritySnapshot {
  constructor(
    private readonly candidates: CandidateRepository,
    private readonly curriculums: CurriculumRepository,
    private readonly mastery: MasteryRepository,
    private readonly progress: LearningProgressRepository,
    private readonly clock: Clock
  ) {}

  async execute(options: { readonly subject?: SubjectCode; readonly module?: string } = {}): Promise<LearnerPrioritySnapshot | undefined> {
    const cycle = await this.candidates.findCurrentCycle();
    if (!cycle) return undefined;
    const [curriculum, tracks, progressRecords] = await Promise.all([
      this.curriculums.findBundle(cycle.examCycle.curriculumVersionId),
      this.mastery.listAllTracks(cycle.examCycle.id),
      this.progress.listByCycle(cycle.examCycle.id)
    ]);
    if (!curriculum) return undefined;
    const now = this.clock.now();
    const trackById = new Map(tracks.map((track) => [track.capabilityNodeId, track]));
    const progressById = latestLectureProgressByCapability(progressRecords);
    const preferences = readCapabilityRecommendationPreferences(cycle.learningPreferences.extension);
    const scoreGaps = scoreGapRatios(cycle.scoreTargets, cycle.scoreMeasurements);
    const nodes = trainableLeaves(curriculum.capabilityNodes).filter((node) => (
      (!options.subject || node.subject === options.subject)
      && (!options.module || node.module === options.module)
    ));
    const priorities = rankLearnerPriorities(nodes.map((node) => signalFor(
      node,
      trackById.get(node.id),
      progressById.get(node.id),
      preferences.get(node.id),
      scoreGaps.get(node.subject) ?? 0
    )), now);
    return { examCycleId: cycle.examCycle.id, generatedAt: now, priorities };
  }
}

function signalFor(
  node: CapabilityNode,
  track: MasteryTrack | undefined,
  progress: { readonly status: 'started' | 'completed'; readonly completedAt?: InstantMs } | undefined,
  preference: CapabilityRecommendationPreference | undefined,
  scoreGapRatio: number
): LearnerPrioritySignal {
  return {
    capabilityNodeId: node.id,
    subject: node.subject,
    module: node.module,
    name: node.name,
    scoreWeight: node.scoreWeight,
    scoreGapRatio,
    state: track?.state ?? 'unassessed',
    accuracy: track?.accuracy ?? 0,
    speed: track?.speed ?? 0,
    retention: track?.retention ?? 0,
    transfer: track?.transfer ?? 0,
    stability: track?.stability ?? 0,
    confidence: track?.confidence ?? 0,
    effectiveSample: track?.effectiveSample ?? 0,
    lastEvidenceAt: track?.lastEvidenceAt,
    learningStatus: progress?.status,
    learningCompletedAt: progress?.completedAt,
    preference
  };
}

function scoreGapRatios(
  targets: readonly { readonly subject: SubjectCode; readonly targetScore: number; readonly maxScore: number; readonly status: string }[],
  measurements: readonly { readonly subject: SubjectCode; readonly score: number; readonly maxScore: number; readonly measuredAt: InstantMs }[]
): ReadonlyMap<SubjectCode, number> {
  const latest = new Map<SubjectCode, (typeof measurements)[number]>();
  measurements.forEach((measurement) => {
    const current = latest.get(measurement.subject);
    if (!current || Number(current.measuredAt) < Number(measurement.measuredAt)) latest.set(measurement.subject, measurement);
  });
  const result = new Map<SubjectCode, number>();
  targets.forEach((target) => {
    if (target.status !== 'active') return;
    const measurement = latest.get(target.subject);
    const current = measurement
      ? measurement.score / Math.max(1, measurement.maxScore) * target.maxScore
      : 0;
    result.set(target.subject, Math.max(0, Math.min(1, (target.targetScore - current) / Math.max(1, target.maxScore))));
  });
  return result;
}

function trainableLeaves(nodes: readonly CapabilityNode[]): CapabilityNode[] {
  const parentIds = new Set(nodes.map((node) => node.parentId).filter(Boolean));
  return nodes.filter((node) => (
    node.status === 'active'
    && node.scoreWeight > 0
    && !parentIds.has(node.id)
  ));
}
