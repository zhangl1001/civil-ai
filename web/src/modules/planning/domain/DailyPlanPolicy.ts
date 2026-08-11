import type { CapabilityNodeId, ExamCycleId, SubjectCode } from '@/kernel/public';
import {
  DailyPlanDigestType,
  DailyPlanItemCategory,
  DailyPlanItemType,
  type DailyPlanItemCategory as DailyPlanItemCategoryCode,
  type DailyPlanItemType as DailyPlanItemTypeCode
} from './DailyPlanCodes';
import {
  prescribeDailyLearningLoad,
  targetCountForPlanItem,
  type DailyLearningLoadPrescription,
  type PlanningCapabilitySignal
} from './DailyLearningLoadPolicy';
import { PreparationHorizon, type PreparationStrategy } from './PreparationStrategyPolicy';

export const DailyPlanReasonCode = {
  DueReview: 'due_review',
  MasteryRepairRequired: 'mastery_repair_required',
  IndependentEvidenceNeeded: 'independent_evidence_needed',
  TransferEvidenceNeeded: 'transfer_evidence_needed',
  CurriculumCoverageNeeded: 'curriculum_coverage_needed',
  TimedStabilityNeeded: 'timed_stability_needed',
  CurrentAffairsAccumulation: 'current_affairs_accumulation'
} as const;

export const DailyPlanGoalCode = {
  RetentionMaintenance: 'retention_maintenance',
  MasteryRepair: 'mastery_repair',
  TransferValidation: 'transfer_validation',
  TimedStability: 'timed_stability',
  IndependentEvidence: 'independent_evidence',
  CapabilityBaseline: 'capability_baseline',
  CurrentAffairsAwareness: 'current_affairs_awareness'
} as const;

export const DailyPlanRationaleCode = {
  ReviewsFirst: 'reviews_first',
  WeakCapabilitiesFirst: 'weak_capabilities_first',
  CurriculumCoverageIncluded: 'curriculum_coverage_included',
  CapacityReserved: 'capacity_reserved',
  CurrentAffairsIncluded: 'current_affairs_included'
} as const;

export interface DailyPlanCapabilitySignal extends PlanningCapabilitySignal {
  readonly capabilityNodeId: CapabilityNodeId;
  readonly subject: SubjectCode;
  readonly module: string;
  readonly name: string;
  readonly scoreWeight: number;
  readonly scoreGapRatio: number;
  readonly speed: number;
  readonly retention: number;
  readonly transfer: number;
  readonly stability: number;
  readonly effectiveSample: number;
  readonly defaultTargetSeconds?: number;
}

export interface DailyPlanCoverageCandidate {
  readonly capabilityNodeId: CapabilityNodeId;
  readonly subject: SubjectCode;
  readonly module: string;
  readonly name: string;
  readonly scoreWeight: number;
  readonly scoreGapRatio: number;
  readonly defaultTargetSeconds?: number;
}

export interface DailyPlanReviewCandidate {
  readonly id: string;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly priority: number;
  readonly reason: string;
}

export interface DailyPlanProposalBlock {
  readonly key: string;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly subject: SubjectCode;
  readonly module: string;
  readonly teachingGoalCode: string;
  readonly sequence: number;
  readonly priority: number;
  readonly required: boolean;
}

export interface DailyPlanProposalItem {
  readonly key: string;
  readonly blockKey: string;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly reviewQueueItemId?: string;
  readonly category: DailyPlanItemCategoryCode;
  readonly action: DailyPlanItemTypeCode;
  readonly targetMinutes: number;
  readonly targetCount?: number;
  readonly priority: number;
  readonly required: boolean;
  readonly dependencyKeys: readonly string[];
  readonly completionCriteria: Readonly<Record<string, string | number | boolean | null>>;
  readonly reasonCode: string;
}

export interface DailyPlanProposal {
  readonly examCycleId: ExamCycleId;
  readonly availableMinutes: number;
  readonly plannedMinutes: number;
  readonly blocks: readonly DailyPlanProposalBlock[];
  readonly items: readonly DailyPlanProposalItem[];
  readonly rationaleCodes: readonly string[];
  readonly strategy: PreparationStrategy;
  readonly learningLoad: DailyLearningLoadPrescription;
}

export function proposeDailyPlan(input: {
  readonly examCycleId: ExamCycleId;
  readonly availableMinutes: number;
  readonly strategy: PreparationStrategy;
  readonly dueReviews: readonly DailyPlanReviewCandidate[];
  readonly prioritySignals: readonly DailyPlanCapabilitySignal[];
  readonly coverageCandidates: readonly DailyPlanCoverageCandidate[];
  readonly currentAffairsCapability?: DailyPlanCoverageCandidate;
  readonly teachingOrder?: string;
  readonly explanationDepth?: string;
  readonly maximumFocusMinutes?: number;
}): DailyPlanProposal {
  assertAvailableMinutes(input.availableMinutes);
  const digestMinutes = input.currentAffairsCapability
    ? dailyDigestMinutes(input.availableMinutes)
    : 0;
  let remainingMinutes = input.availableMinutes - digestMinutes;
  const blocks: DailyPlanProposalBlock[] = [];
  const items: DailyPlanProposalItem[] = [];
  const rationaleCodes: string[] = [];
  const load = prescribeDailyLearningLoad({
    availableMinutes: input.availableMinutes,
    strategy: input.strategy,
    dueReviewCount: input.dueReviews.length,
    prioritySignals: input.prioritySignals
  });
  const signalsById = new Map(input.prioritySignals.map((signal) => [signal.capabilityNodeId, signal]));
  const coverageById = new Map(input.coverageCandidates.map((candidate) => [candidate.capabilityNodeId, candidate]));
  const usedCapabilities = new Set<CapabilityNodeId>();
  let blockSequence = 0;
  const coreItemLimit = load.maximumPlanItems;

  const appendBlock = (draft: BlockDraft): void => {
    if (items.length >= coreItemLimit || remainingMinutes < 5) return;
    const blockKey = `block:${draft.capability.capabilityNodeId}:${blockSequence + 1}`;
    const blockItems: DailyPlanProposalItem[] = [];
    for (const item of draft.items) {
      if (items.length + blockItems.length >= coreItemLimit || remainingMinutes < 5) break;
      const targetMinutes = Math.min(item.targetMinutes, remainingMinutes, normalizeMaximumFocus(input.maximumFocusMinutes));
      if (targetMinutes < 5) break;
      const key = `${blockKey}:item:${blockItems.length + 1}`;
      const dependencyKeys = item.dependsOnPrevious && blockItems.length ? [blockItems[blockItems.length - 1]!.key] : [];
      const targetCount = targetCountForPlanItem(item.action, targetMinutes, load, draft.capability.defaultTargetSeconds);
      blockItems.push({
        key,
        blockKey,
        capabilityNodeId: draft.capability.capabilityNodeId,
        ...(item.reviewQueueItemId ? { reviewQueueItemId: item.reviewQueueItemId } : {}),
        category: categoryFor(item.action),
        action: item.action,
        targetMinutes,
        ...(targetCount === undefined ? {} : { targetCount }),
        priority: draft.priority,
        required: draft.required,
        dependencyKeys,
        completionCriteria: completionCriteria(item.action, targetMinutes, targetCount),
        reasonCode: item.reasonCode
      });
      remainingMinutes -= targetMinutes;
    }
    if (!blockItems.length) return;
    blockSequence += 1;
    blocks.push({
      key: blockKey,
      capabilityNodeId: draft.capability.capabilityNodeId,
      subject: draft.capability.subject,
      module: draft.capability.module,
      teachingGoalCode: draft.teachingGoalCode,
      sequence: blockSequence,
      priority: draft.priority,
      required: draft.required
    });
    items.push(...blockItems);
    usedCapabilities.add(draft.capability.capabilityNodeId);
  };

  for (const review of input.dueReviews) {
    const capability = signalsById.get(review.capabilityNodeId) ?? coverageById.get(review.capabilityNodeId);
    if (!capability) continue;
    appendBlock({
      capability,
      teachingGoalCode: DailyPlanGoalCode.RetentionMaintenance,
      priority: clampPriority(90 + review.priority),
      required: true,
      items: [{ action: DailyPlanItemType.Review, targetMinutes: 12, reasonCode: review.reason || DailyPlanReasonCode.DueReview, reviewQueueItemId: review.id }]
    });
  }
  if (blocks.length) rationaleCodes.push(DailyPlanRationaleCode.ReviewsFirst);

  for (const signal of input.prioritySignals) {
    if (usedCapabilities.has(signal.capabilityNodeId) || remainingMinutes < 5) continue;
    const priority = capabilityPriority(signal, input.strategy);
    appendBlock(blockForSignal(signal, priority, input));
  }

  const coverageBudget = input.strategy.maximumNewCapabilities;
  let coverageCount = 0;
  for (const capability of input.coverageCandidates) {
    if (coverageCount >= coverageBudget || usedCapabilities.has(capability.capabilityNodeId) || remainingMinutes < 10) break;
    if (input.strategy.horizon === PreparationHorizon.Sprint && capability.scoreWeight < 0.04) continue;
    const diagnosisFirst = input.teachingOrder === 'diagnose_then_explain';
    appendBlock({
      capability,
      teachingGoalCode: DailyPlanGoalCode.CapabilityBaseline,
      priority: clampPriority(55 + capability.scoreWeight * 80 + capability.scoreGapRatio * 20),
      required: input.strategy.horizon !== PreparationHorizon.Sprint,
      items: diagnosisFirst
        ? [
            { action: DailyPlanItemType.Diagnosis, targetMinutes: 12, reasonCode: DailyPlanReasonCode.CurriculumCoverageNeeded },
            { action: DailyPlanItemType.Lecture, targetMinutes: lectureMinutes(input.explanationDepth), reasonCode: DailyPlanReasonCode.CurriculumCoverageNeeded, dependsOnPrevious: true }
          ]
        : [
            { action: DailyPlanItemType.Lecture, targetMinutes: lectureMinutes(input.explanationDepth), reasonCode: DailyPlanReasonCode.CurriculumCoverageNeeded },
            { action: DailyPlanItemType.GuidedPractice, targetMinutes: 15, reasonCode: DailyPlanReasonCode.CurriculumCoverageNeeded, dependsOnPrevious: true }
          ]
    });
    coverageCount += 1;
  }

  if (input.currentAffairsCapability && digestMinutes) {
    const capability = input.currentAffairsCapability;
    const blockKey = `block:${capability.capabilityNodeId}:digest`;
    blockSequence += 1;
    blocks.push({
      key: blockKey,
      capabilityNodeId: capability.capabilityNodeId,
      subject: capability.subject,
      module: capability.module,
      teachingGoalCode: DailyPlanGoalCode.CurrentAffairsAwareness,
      sequence: blockSequence,
      priority: 60,
      required: true
    });
    items.push({
      key: `${blockKey}:item:1`,
      blockKey,
      capabilityNodeId: capability.capabilityNodeId,
      category: DailyPlanItemCategory.Accumulate,
      action: DailyPlanItemType.Digest,
      targetMinutes: digestMinutes,
      targetCount: load.digest.targetThemes,
      priority: 60,
      required: true,
      dependencyKeys: [],
      completionCriteria: {
        event: 'digest_completed',
        digestTab: DailyPlanDigestType.CurrentAffairs,
        targetThemes: load.digest.targetThemes,
        minimumMinutes: digestMinutes
      },
      reasonCode: DailyPlanReasonCode.CurrentAffairsAccumulation
    });
    rationaleCodes.push(DailyPlanRationaleCode.CurrentAffairsIncluded);
  }

  if (input.prioritySignals.length) rationaleCodes.push(DailyPlanRationaleCode.WeakCapabilitiesFirst);
  if (coverageCount) rationaleCodes.push(DailyPlanRationaleCode.CurriculumCoverageIncluded);
  if (items.length && remainingMinutes >= 5) rationaleCodes.push(DailyPlanRationaleCode.CapacityReserved);

  return {
    examCycleId: input.examCycleId,
    availableMinutes: input.availableMinutes,
    plannedMinutes: input.availableMinutes - remainingMinutes,
    blocks,
    items,
    rationaleCodes,
    strategy: input.strategy,
    learningLoad: load
  };
}

interface BlockDraft {
  readonly capability: DailyPlanCapabilitySignal | DailyPlanCoverageCandidate;
  readonly teachingGoalCode: string;
  readonly priority: number;
  readonly required: boolean;
  readonly items: readonly {
    readonly action: DailyPlanItemTypeCode;
    readonly targetMinutes: number;
    readonly reasonCode: string;
    readonly reviewQueueItemId?: string;
    readonly dependsOnPrevious?: boolean;
  }[];
}

function blockForSignal(
  signal: DailyPlanCapabilitySignal,
  priority: number,
  input: { readonly strategy: PreparationStrategy; readonly teachingOrder?: string; readonly explanationDepth?: string }
): BlockDraft {
  if (signal.state === 'regressed' || signal.state === 'learning') {
    const practiceFirst = input.teachingOrder === 'practice_then_explain';
    const actions: BlockDraft['items'] = practiceFirst
      ? [
          { action: DailyPlanItemType.GuidedPractice, targetMinutes: 12, reasonCode: DailyPlanReasonCode.MasteryRepairRequired },
          { action: DailyPlanItemType.Lecture, targetMinutes: lectureMinutes(input.explanationDepth), reasonCode: DailyPlanReasonCode.MasteryRepairRequired, dependsOnPrevious: true }
        ]
      : [
          { action: DailyPlanItemType.Lecture, targetMinutes: lectureMinutes(input.explanationDepth), reasonCode: DailyPlanReasonCode.MasteryRepairRequired },
          { action: DailyPlanItemType.GuidedPractice, targetMinutes: 15, reasonCode: DailyPlanReasonCode.MasteryRepairRequired, dependsOnPrevious: true }
        ];
    return { capability: signal, teachingGoalCode: DailyPlanGoalCode.MasteryRepair, priority, required: true, items: actions };
  }
  if (signal.state === 'consolidating') {
    return {
      capability: signal,
      teachingGoalCode: DailyPlanGoalCode.TransferValidation,
      priority,
      required: true,
      items: [{ action: DailyPlanItemType.Transfer, targetMinutes: 18, reasonCode: DailyPlanReasonCode.TransferEvidenceNeeded }]
    };
  }
  const shouldTime = input.strategy.horizon === PreparationHorizon.Sprint && signal.speed < 0.65;
  return {
    capability: signal,
    teachingGoalCode: shouldTime ? DailyPlanGoalCode.TimedStability : DailyPlanGoalCode.IndependentEvidence,
    priority,
    required: signal.state === 'diagnosed' || signal.state === 'practicing',
    items: [{
      action: shouldTime ? DailyPlanItemType.Timed : DailyPlanItemType.IndependentPractice,
      targetMinutes: 20,
      reasonCode: shouldTime ? DailyPlanReasonCode.TimedStabilityNeeded : DailyPlanReasonCode.IndependentEvidenceNeeded
    }]
  };
}

function capabilityPriority(signal: DailyPlanCapabilitySignal, strategy: PreparationStrategy): number {
  const weakness = 1 - (signal.accuracy + signal.stability + signal.retention + signal.transfer) / 4;
  const evidenceNeed = 1 - Math.min(1, signal.confidence * Math.min(1, signal.effectiveSample / 8));
  return clampPriority(40 + signal.scoreWeight * 70 + signal.scoreGapRatio * 20 + weakness * 25 + evidenceNeed * 10 + strategy.urgency * 5);
}

function categoryFor(action: DailyPlanItemTypeCode): DailyPlanItemCategoryCode {
  if (action === DailyPlanItemType.Lecture) return DailyPlanItemCategory.Learn;
  if (action === DailyPlanItemType.Review) return DailyPlanItemCategory.Review;
  if (action === DailyPlanItemType.Diagnosis || action === DailyPlanItemType.Mock) return DailyPlanItemCategory.Assess;
  if (action === DailyPlanItemType.Digest) return DailyPlanItemCategory.Accumulate;
  return DailyPlanItemCategory.Practice;
}

function completionCriteria(
  action: DailyPlanItemTypeCode,
  minutes: number,
  count: number | undefined
): Readonly<Record<string, string | number | boolean | null>> {
  if (action === DailyPlanItemType.Lecture) return { event: 'lecture_completed', minimumMinutes: minutes };
  if (action === DailyPlanItemType.Digest) return { event: 'digest_completed', minimumMinutes: minutes };
  if (action === DailyPlanItemType.Essay) return { event: 'essay_submitted' };
  return { event: 'practice_submitted', targetCount: count ?? null };
}

function lectureMinutes(depth: string | undefined): number {
  if (depth === 'deep') return 18;
  if (depth === 'concise') return 8;
  return 12;
}

function dailyDigestMinutes(availableMinutes: number): number {
  if (availableMinutes < 15) return 0;
  if (availableMinutes < 45) return 5;
  if (availableMinutes < 90) return 8;
  return 10;
}

function normalizeMaximumFocus(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 60;
  return Math.max(5, Math.min(240, Math.round(value)));
}

function clampPriority(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function assertAvailableMinutes(value: number): void {
  if (!Number.isInteger(value) || value < 5 || value > 480) {
    throw new RangeError('Daily available minutes must be between 5 and 480');
  }
}
