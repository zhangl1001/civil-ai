import type { RouteLocationRaw } from 'vue-router';
import { DailyPlanDigestType, DailyPlanItemType, type DailyPlanItemRecord } from '@/modules/planning/public';

const PRACTICE_ITEM_TYPES = new Set<DailyPlanItemRecord['itemType']>([
  DailyPlanItemType.GuidedPractice,
  DailyPlanItemType.IndependentPractice,
  DailyPlanItemType.Variant,
  DailyPlanItemType.Timed,
  DailyPlanItemType.Review,
  DailyPlanItemType.Transfer
]);

export function dailyPlanItemLocation(item: DailyPlanItemRecord): RouteLocationRaw {
  const context = {
    source: 'daily-plan',
    dailyPlanItemId: item.id,
    capabilityNodeId: item.capabilityNodeId
  };

  if (PRACTICE_ITEM_TYPES.has(item.itemType)) {
    return {
      path: '/vue/practice',
      query: { ...context, mode: 'tutor', start: '1' }
    };
  }
  if (item.itemType === DailyPlanItemType.Lecture) {
    const assetId = resultText(item.resultSummary, 'assetId') || resultText(item.resultSummary, 'resultRef');
    return {
      path: '/vue/study/lecture',
      query: { ...context, ...(assetId ? { assetId } : { start: '1' }) }
    };
  }
  if (item.itemType === DailyPlanItemType.Diagnosis) {
    return { path: '/vue/diagnosis', query: context };
  }
  if (item.itemType === DailyPlanItemType.Mock) {
    return { path: '/vue/exam', query: context };
  }
  if (item.itemType === DailyPlanItemType.Essay) {
    return { path: '/vue/essay', query: { ...context, entryMode: 'tutor' } };
  }
  return {
    path: '/vue/digest',
    query: {
      ...context,
      tab: item.exitCriteria.digestTab === DailyPlanDigestType.CurrentAffairs
        ? DailyPlanDigestType.CurrentAffairs
        : DailyPlanDigestType.KnowledgeTips,
      start: '1'
    }
  };
}

function resultText(value: DailyPlanItemRecord['resultSummary'], field: string): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}
