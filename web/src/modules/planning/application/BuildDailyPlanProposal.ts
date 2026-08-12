import type { Clock, CurriculumVersionId, ExamCycleId, InstantMs, JsonObject, SubjectCode } from '@/kernel/public';
import {
  latestLectureProgressByCapability,
  type LearningProgressRecord
} from '@/modules/learning-progress/public';
import {
  rankLearnerPriorities,
  readCapabilityRecommendationPreferences,
  type MasteryTrack,
  type ReviewQueueItem
} from '@/modules/mastery/public';
import {
  proposeDailyPlan,
  type DailyPlanCapabilitySignal,
  type DailyPlanCoverageCandidate,
  type DailyPlanProposal
} from '../domain/DailyPlanPolicy';
import { decidePreparationStrategy } from '../domain/PreparationStrategyPolicy';

interface PlanningCandidateContext {
  readonly examCycle: {
    readonly id: ExamCycleId;
    readonly examDate: string;
    readonly phase: string;
    readonly curriculumVersionId: CurriculumVersionId;
  };
  readonly scoreTargets: readonly {
    readonly subject: SubjectCode;
    readonly targetScore: number;
    readonly maxScore: number;
    readonly status: string;
  }[];
  readonly scoreMeasurements: readonly {
    readonly subject: SubjectCode;
    readonly score: number;
    readonly maxScore: number;
    readonly measuredAt: InstantMs;
  }[];
  readonly studyConstraints: {
    readonly maxFocusMinutes?: number;
  };
  readonly learningPreferences: {
    readonly teachingOrder: string;
    readonly explanationDepth: string;
    readonly extension: JsonObject;
  };
}

interface PlanningCandidatePort {
  findCycle(examCycleId: ExamCycleId): Promise<PlanningCandidateContext | undefined>;
}

interface PlanningMasteryPort {
  listDueReviews(examCycleId: ExamCycleId, now: InstantMs, limit: number): Promise<readonly ReviewQueueItem[]>;
  listAllTracks(examCycleId: ExamCycleId): Promise<readonly MasteryTrack[]>;
}

interface PlanningProgressPort {
  listByCycle(examCycleId: ExamCycleId): Promise<readonly LearningProgressRecord[]>;
}

interface PlanningCurriculumNode {
  readonly id: DailyPlanCapabilitySignal['capabilityNodeId'];
  readonly parentId?: DailyPlanCapabilitySignal['capabilityNodeId'];
  readonly code: string;
  readonly name: string;
  readonly nodeType: string;
  readonly subject: SubjectCode;
  readonly module: string;
  readonly sequence: number;
  readonly scoreWeight: number;
  readonly defaultTargetSeconds?: number;
  readonly status: string;
}

interface PlanningCurriculumPort {
  findBundle(curriculumVersionId: CurriculumVersionId): Promise<{
    readonly capabilityNodes: readonly PlanningCurriculumNode[];
  } | undefined>;
}

export class BuildDailyPlanProposal {
  constructor(
    private readonly candidates: PlanningCandidatePort,
    private readonly mastery: PlanningMasteryPort,
    private readonly curriculum: PlanningCurriculumPort,
    private readonly progress: PlanningProgressPort,
    private readonly clock: Clock
  ) {}

  async execute(command: {
    readonly examCycleId: ExamCycleId;
    readonly availableMinutes: number;
    readonly examDate?: string;
    readonly phase?: string;
  }): Promise<DailyPlanProposal> {
    const now = this.clock.now();
    const [candidate, dueReviews, allTracks, progressRecords] = await Promise.all([
      this.candidates.findCycle(command.examCycleId),
      this.mastery.listDueReviews(command.examCycleId, now, 12),
      this.mastery.listAllTracks(command.examCycleId),
      this.progress.listByCycle(command.examCycleId)
    ]);
    const curriculum = candidate
      ? await this.curriculum.findBundle(candidate.examCycle.curriculumVersionId)
      : undefined;
    const nodes = eligibleNodes(curriculum?.capabilityNodes ?? []);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const progressByNode = latestLectureProgressByCapability(progressRecords);
    const trackedIds = new Set(allTracks.map((track) => track.capabilityNodeId));
    const learnedIds = new Set([...progressByNode.entries()]
      .filter(([, progress]) => progress.status === 'completed')
      .map(([capabilityNodeId]) => capabilityNodeId));
    const observedIds = new Set([...trackedIds, ...learnedIds]);
    const scoreGaps = scoreGapRatios(candidate);
    const remainingDays = daysUntil(command.examDate ?? candidate?.examCycle.examDate, now);
    const curriculumCoverageRatio = nodes.length
      ? nodes.filter((node) => observedIds.has(node.id)).length / nodes.length
      : 0;
    const strategy = decidePreparationStrategy({
      remainingDays,
      averageScoreGapRatio: average(Array.from(scoreGaps.values()), 0),
      curriculumCoverageRatio,
      dueReviewCount: dueReviews.length
    });
    const preferences = readCapabilityRecommendationPreferences(candidate?.learningPreferences.extension ?? {});
    const trackByNode = new Map(allTracks.map((track) => [track.capabilityNodeId, track]));
    const ranked = rankLearnerPriorities(nodes.flatMap((node) => {
      if (!observedIds.has(node.id)) return [];
      const track = trackByNode.get(node.id);
      const progress = progressByNode.get(node.id);
      return [{
        capabilityNodeId: node.id,
        subject: node.subject,
        module: node.module,
        name: node.name,
        scoreWeight: node.scoreWeight,
        scoreGapRatio: scoreGaps.get(node.subject) ?? 0,
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
        preference: preferences.get(node.id)
      }];
    }), now);
    const prioritySignals = ranked.slice(0, 32).map((priority): DailyPlanCapabilitySignal => {
      const node = nodesById.get(priority.capabilityNodeId)!;
      return {
        capabilityNodeId: priority.capabilityNodeId,
        subject: priority.subject,
        module: priority.module,
        name: priority.name,
        scoreWeight: priority.scoreWeight,
        scoreGapRatio: priority.scoreGapRatio,
        learnerPriority: priority.priority,
        recommendedAction: priority.action,
        state: priority.state,
        accuracy: priority.accuracy,
        speed: priority.speed,
        retention: priority.retention,
        transfer: priority.transfer,
        stability: priority.stability,
        confidence: priority.confidence,
        effectiveSample: priority.effectiveSample,
        ...(node.defaultTargetSeconds === undefined ? {} : { defaultTargetSeconds: node.defaultTargetSeconds })
      };
    });
    const coverageCandidates: DailyPlanCoverageCandidate[] = nodes
      .filter((node) => !observedIds.has(node.id))
      .map((node) => toCoverageCandidate(node, scoreGaps))
      .sort((left, right) => (
        right.scoreWeight * (1 + right.scoreGapRatio) - left.scoreWeight * (1 + left.scoreGapRatio)
      ));
    const currentAffairsNode = nodes.find((node) => node.code === CURRENT_AFFAIRS_CAPABILITY_CODE);

    return proposeDailyPlan({
      examCycleId: command.examCycleId,
      availableMinutes: command.availableMinutes,
      strategy,
      dueReviews,
      prioritySignals,
      coverageCandidates,
      currentAffairsCapability: currentAffairsNode
        ? toCoverageCandidate(currentAffairsNode, scoreGaps)
        : undefined,
      teachingOrder: candidate?.learningPreferences.teachingOrder,
      explanationDepth: candidate?.learningPreferences.explanationDepth,
      maximumFocusMinutes: candidate?.studyConstraints.maxFocusMinutes
    });
  }
}

const CURRENT_AFFAIRS_CAPABILITY_CODE = 'aptitude.common_sense.politics_economy';

function toCoverageCandidate(
  node: PlanningCurriculumNode,
  scoreGaps: ReadonlyMap<SubjectCode, number>
): DailyPlanCoverageCandidate {
  return {
    capabilityNodeId: node.id,
    subject: node.subject,
    module: node.module,
    name: node.name,
    scoreWeight: node.scoreWeight,
    scoreGapRatio: scoreGaps.get(node.subject) ?? 0,
    ...(node.defaultTargetSeconds === undefined ? {} : { defaultTargetSeconds: node.defaultTargetSeconds })
  };
}

function eligibleNodes(nodes: readonly PlanningCurriculumNode[]): PlanningCurriculumNode[] {
  const parentIds = new Set(nodes.map((node) => node.parentId).filter((id): id is PlanningCurriculumNode['id'] => Boolean(id)));
  const leaves = nodes.filter((node) => node.status === 'active' && !parentIds.has(node.id) && node.scoreWeight > 0);
  return leaves.length
    ? leaves.sort((left, right) => right.scoreWeight - left.scoreWeight || left.sequence - right.sequence)
    : nodes.filter((node) => node.status === 'active' && node.scoreWeight > 0)
      .sort((left, right) => right.scoreWeight - left.scoreWeight || left.sequence - right.sequence);
}

function scoreGapRatios(candidate: PlanningCandidateContext | undefined): Map<SubjectCode, number> {
  if (!candidate) return new Map();
  const latest = new Map<SubjectCode, PlanningCandidateContext['scoreMeasurements'][number]>();
  for (const measurement of candidate.scoreMeasurements) {
    const current = latest.get(measurement.subject);
    if (!current || current.measuredAt < measurement.measuredAt) latest.set(measurement.subject, measurement);
  }
  const result = new Map<SubjectCode, number>();
  for (const target of candidate.scoreTargets) {
    if (target.status !== 'active') continue;
    const measurement = latest.get(target.subject);
    const currentScore = measurement
      ? measurement.score / Math.max(1, measurement.maxScore) * target.maxScore
      : 0;
    result.set(target.subject, clamp01((target.targetScore - currentScore) / Math.max(1, target.maxScore)));
  }
  return result;
}

function daysUntil(date: string | undefined, now: number): number | undefined {
  if (!date) return undefined;
  const target = Date.parse(`${date}T12:00:00`);
  if (!Number.isFinite(target)) return undefined;
  return Math.max(0, Math.ceil((target - now) / 86_400_000));
}

function average(values: readonly number[], fallback: number): number {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
