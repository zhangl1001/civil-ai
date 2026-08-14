import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { LocalDate } from '@/kernel/public';
import { AssessmentRole } from '@/kernel/public';
import { CapabilityNodeType, type CapabilityNode } from '@/modules/curriculum/public';
import type { DailyPlanAggregate, DailyPlanItemRecord } from '@/modules/planning/public';
import type { EssayQuestionSetPurpose } from '@/domain/essayQuestionSet';

export interface EssayTutorPlanPreference {
  readonly dailyPlanItemId?: string;
  readonly capabilityNodeId?: string;
}

export interface EssayTutorPlanPrescription {
  readonly context: EssayTutorGenerationContext;
  readonly questionCount: number;
  readonly title: string;
  readonly capability: CapabilityNode;
  readonly planItem?: DailyPlanItemRecord;
}

export interface EssayTutorGenerationContext {
  readonly date: string;
  readonly topic: string;
  readonly type: 'short' | 'long';
  readonly entryMode: 'tutor';
  readonly purpose: EssayQuestionSetPurpose;
  readonly capabilityNodeId: string;
  readonly dailyPlanId?: string;
  readonly dailyPlanItemId?: string;
  readonly reviewQueueItemId?: string;
  readonly assessmentRole: string;
}

/** Resolves an essay daily-plan item without ever falling back to aptitude capabilities. */
export class EssayTutorPlanFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async prepare(preference: EssayTutorPlanPreference): Promise<EssayTutorPlanPrescription> {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const [curriculum, plan] = await Promise.all([
      this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      this.runtime.dailyPlanRepository.findCurrent(cycle.examCycle.id, today())
    ]);
    if (!curriculum) throw new Error('当前考试大纲未安装。');
    return resolveEssayTutorPlanPrescription({
      plan,
      nodes: curriculum.capabilityNodes,
      preference,
      date: today()
    });
  }
}

export function resolveEssayTutorPlanPrescription(input: {
  readonly plan?: DailyPlanAggregate;
  readonly nodes: readonly CapabilityNode[];
  readonly preference: EssayTutorPlanPreference;
  readonly date: LocalDate;
}): EssayTutorPlanPrescription {
  const activeEssayNodes = input.nodes.filter((node) => node.status === 'active' && node.subject === 'essay');
  const requestedItem = input.preference.dailyPlanItemId
    ? input.plan?.items.find((item) => item.id === input.preference.dailyPlanItemId)
    : undefined;
  if (input.preference.dailyPlanItemId && !requestedItem) {
    throw new Error('当前申论计划项不存在或已失效，请返回今日计划刷新。');
  }

  const requestedCapabilityId = input.preference.capabilityNodeId || requestedItem?.capabilityNodeId;
  const requestedCapability = requestedCapabilityId
    ? activeEssayNodes.find((node) => node.id === requestedCapabilityId)
    : undefined;
  if (requestedCapabilityId && !requestedCapability) {
    throw new Error('当前计划能力点不属于申论，已停止生成以避免科目串线。');
  }
  if (requestedItem && requestedCapability && requestedItem.capabilityNodeId !== requestedCapability.id) {
    throw new Error('申论计划项与能力点不一致，请返回今日计划刷新。');
  }

  const fallbackItem = input.plan?.items.find((item) => (
    item.status !== 'completed'
    && item.status !== 'cancelled'
    && activeEssayNodes.some((node) => node.id === item.capabilityNodeId)
  ));
  const planItem = requestedItem || fallbackItem;
  const capability = requestedCapability
    || activeEssayNodes.find((node) => node.id === planItem?.capabilityNodeId)
    || activeEssayNodes.find((node) => node.nodeType !== CapabilityNodeType.Subject);
  if (!capability) throw new Error('当前大纲没有可训练的申论能力点。');

  const type = capability.nodeType === CapabilityNodeType.ExpressionSkill ? 'long' : 'short';
  const questionCount = type === 'long' ? 1 : clampQuestionCount(planItem?.targetCount);
  return {
    capability,
    planItem,
    questionCount,
    title: planItem ? `申论计划 · ${capability.name}` : `申论私教 · ${capability.name}`,
    context: {
      date: input.date,
      topic: capability.name,
      type,
      entryMode: 'tutor',
      purpose: 'practice',
      capabilityNodeId: capability.id,
      dailyPlanId: input.plan?.plan.id,
      dailyPlanItemId: planItem?.id,
      reviewQueueItemId: planItem?.reviewQueueItemId,
      assessmentRole: planItem?.itemType === 'review' ? AssessmentRole.Retention : AssessmentRole.Practice
    }
  };
}

function clampQuestionCount(value?: number): number {
  return Math.max(1, Math.min(3, Math.round(value ?? 1)));
}

function today(): LocalDate {
  return new Date().toLocaleDateString('en-CA') as LocalDate;
}
