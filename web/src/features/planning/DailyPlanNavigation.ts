import type { RouteLocationRaw } from 'vue-router';
import type { SubjectCode } from '@/kernel/public';
import { ExamDeliveryKind } from '@/modules/curriculum/public';
import { subjectDeliveryKind } from '@/domain/subjectDelivery';
import { PracticeSubject } from '@/features/practice/PracticeSubject';
import { DailyPlanDigestType, DailyPlanItemType, type DailyPlanItemRecord } from '@/modules/planning/public';

const PRACTICE_ITEM_TYPES = new Set<DailyPlanItemRecord['itemType']>([
  DailyPlanItemType.GuidedPractice,
  DailyPlanItemType.IndependentPractice,
  DailyPlanItemType.Variant,
  DailyPlanItemType.Timed,
  DailyPlanItemType.Review,
  DailyPlanItemType.Transfer
]);

export function dailyPlanItemLocation(item: DailyPlanItemRecord, subject?: SubjectCode): RouteLocationRaw {
  const context = {
    source: 'daily-plan',
    dailyPlanItemId: item.id,
    capabilityNodeId: item.capabilityNodeId
  };

  if (PRACTICE_ITEM_TYPES.has(item.itemType)) {
    // Which flow answers this item is decided by how its subject is answered.
    // Reading the subject code here sends every package that does not name its
    // subjects the civil-service way to the objective practice page.
    const delivery = subjectDeliveryKind(subject);
    if (delivery === ExamDeliveryKind.Interview) {
      return {
        path: '/vue/interview',
        query: context
      };
    }
    return {
      path: '/vue/practice',
      query: {
        ...context,
        subject: delivery === ExamDeliveryKind.Subjective ? PracticeSubject.Essay : PracticeSubject.Aptitude,
        mode: 'tutor',
        start: '1'
      }
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
    return { path: '/vue/practice', query: { ...context, subject: PracticeSubject.Essay, mode: 'tutor' } };
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
