import type { CapabilityNodeId, ExamCycleId } from '@/kernel/public';
import type { MasteryTrack, ReviewQueueItem } from '../contracts/MasteryRepository';

export type DailyTeachingAction = 'review' | 'repair' | 'lecture' | 'guided_practice' | 'independent_practice' | 'transfer';

export const DailyPlanReasonCode = {
  MasteryRepairRequired: 'mastery_repair_required',
  IndependentEvidenceNeeded: 'independent_evidence_needed',
  TransferEvidenceNeeded: 'transfer_evidence_needed',
  RecentPerformanceRegression: 'recent_performance_regression',
  SpacedRetentionMaintenance: 'spaced_retention_maintenance',
  MasteryEvidenceIncomplete: 'mastery_evidence_incomplete'
} as const;

export interface DailyPlanProposalItem {
  readonly capabilityNodeId: CapabilityNodeId;
  readonly reviewQueueItemId?: string;
  readonly action: DailyTeachingAction;
  readonly targetMinutes: number;
  readonly targetCount?: number;
  readonly reasonCode: string;
}

export interface DailyPlanProposal {
  readonly examCycleId: ExamCycleId;
  readonly availableMinutes: number;
  readonly plannedMinutes: number;
  readonly items: readonly DailyPlanProposalItem[];
  readonly rationale: readonly string[];
}

/** Local first plan: due independent evidence precedes new drilling, and no item may exceed the time budget. */
export function proposeDailyPlan(input: {
  readonly examCycleId: ExamCycleId;
  readonly availableMinutes: number;
  readonly dueReviews: readonly ReviewQueueItem[];
  readonly priorityTracks: readonly MasteryTrack[];
}): DailyPlanProposal {
  if (!Number.isInteger(input.availableMinutes) || input.availableMinutes < 5 || input.availableMinutes > 480) {
    throw new RangeError('Daily available minutes must be between 5 and 480');
  }
  let remaining = input.availableMinutes;
  const items: DailyPlanProposalItem[] = [];
  const rationale: string[] = [];
  const add = (item: DailyPlanProposalItem) => {
    const minutes = Math.min(item.targetMinutes, remaining);
    if (minutes < 5) return;
    items.push({ ...item, targetMinutes: minutes });
    remaining -= minutes;
  };

  for (const review of input.dueReviews) {
    if (remaining < 5) break;
    add({ capabilityNodeId: review.capabilityNodeId, reviewQueueItemId: review.id, action: review.reviewType === 'repair' ? 'repair' : 'review', targetMinutes: 12, targetCount: 4, reasonCode: review.reason });
  }
  if (items.length) rationale.push('先完成到期复习，避免已学内容在遗忘后被新题覆盖。');

  for (const track of input.priorityTracks) {
    if (remaining < 10 || items.some((item) => item.capabilityNodeId === track.capabilityNodeId)) continue;
    if (track.state === 'regressed' || track.state === 'learning') {
      add({ capabilityNodeId: track.capabilityNodeId, action: 'lecture', targetMinutes: 12, reasonCode: DailyPlanReasonCode.MasteryRepairRequired });
      add({ capabilityNodeId: track.capabilityNodeId, action: 'guided_practice', targetMinutes: 15, targetCount: 4, reasonCode: DailyPlanReasonCode.MasteryRepairRequired });
    } else if (track.state === 'practicing' || track.state === 'diagnosed') {
      add({ capabilityNodeId: track.capabilityNodeId, action: 'independent_practice', targetMinutes: 20, targetCount: 6, reasonCode: DailyPlanReasonCode.IndependentEvidenceNeeded });
    } else if (track.state === 'consolidating') {
      add({ capabilityNodeId: track.capabilityNodeId, action: 'transfer', targetMinutes: 18, targetCount: 4, reasonCode: DailyPlanReasonCode.TransferEvidenceNeeded });
    }
  }
  if (items.length && remaining >= 5) rationale.push('剩余时间刻意留白，避免为凑题量而牺牲反馈、休息和完成质量。');
  return { examCycleId: input.examCycleId, availableMinutes: input.availableMinutes, plannedMinutes: input.availableMinutes - remaining, items, rationale };
}
