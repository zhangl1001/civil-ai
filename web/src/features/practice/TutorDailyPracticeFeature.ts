import { objectiveSubjectCodes } from '@/domain/subjectDelivery';
import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { TutorDatabaseRuntime } from '@/composition-root/public';
import {
  AssessmentRole,
  type LocalDate,
  type SubjectCode
} from '@/kernel/public';
import type { CapabilityNode } from '@/modules/curriculum/public';
import {
  DailyPlanReasonCode,
  decidePreparationStrategy,
  prescribeDailyLearningLoad,
  targetCountForPlanItem
} from '@/modules/planning/public';
import type { DailyPlanAggregate, DailyPlanItemRecord } from '@/modules/planning/public';
import { ReviewReasonCode } from '@/modules/mastery/public';
import { ReviewPracticeFeature } from './ReviewPracticeFeature';
import { StructuredPracticeFeature } from './StructuredPracticeFeature';

export interface TutorPracticePrescription {
  readonly plan?: DailyPlanAggregate;
  readonly planItem?: DailyPlanItemRecord;
  readonly capability: CapabilityNode;
  readonly requestedCount: number;
  readonly assessmentRole: typeof AssessmentRole[keyof typeof AssessmentRole];
  readonly title: string;
  readonly description: string;
}

export interface TutorPracticeStartResult {
  readonly questionSetId: string;
  readonly learningThreadId: string;
  readonly reviewQueueItemId?: string;
  readonly dailyPlanItemId?: string;
}

/** Resolves today's deterministic plan into one executable practice prescription. */
export class TutorDailyPracticeFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async prepare(preference: {
    readonly planItemId?: string;
    readonly capabilityNodeId?: string;
    readonly module?: string;
  } = {}): Promise<TutorPracticePrescription> {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const curriculum = await this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId);
    if (!curriculum) throw new Error('当前考试大纲未安装。');

    let plan = await this.runtime.dailyPlanRepository.findCurrent(cycle.examCycle.id, today());
    if (!plan) {
      const proposal = await this.runtime.buildDailyPlanProposal.execute({
        examCycleId: cycle.examCycle.id,
        availableMinutes: availableMinutesForToday(cycle.studyConstraints.weekdayMinutes, cycle.studyConstraints.weekendMinutes),
        examDate: cycle.examCycle.examDate,
        phase: cycle.examCycle.phase
      });
      if (proposal.items.length) {
        plan = await this.runtime.persistDailyPlanProposal.execute({
          proposal,
          planDate: today(),
          phase: cycle.examCycle.phase
        });
      }
    }

    const executableItems = plan?.items.filter((item) => (
      item.status === 'pending' || item.status === 'in_progress'
    )) ?? [];
    const objective = objectiveSubjectCodes();
    const nodes = curriculum.capabilityNodes.filter((node) => node.status === 'active' && objective.has(node.subject));
    const objectiveCapabilityIds = new Set(nodes.map((node) => node.id));
    const objectiveItems = executableItems.filter((item) => objectiveCapabilityIds.has(item.capabilityNodeId));
    const requestedPlanItem = preference.planItemId
      ? executableItems.find((item) => item.id === preference.planItemId)
      : undefined;
    if (requestedPlanItem && !objectiveCapabilityIds.has(requestedPlanItem.capabilityNodeId)) {
      throw new Error('所选每日计划项不是客观题练习，请从对应科目入口继续。');
    }
    const planItem = (
      preference.planItemId
        ? objectiveItems.find((item) => item.id === preference.planItemId)
        : undefined
    ) ?? objectiveItems[0];
    const explicitlyRequested = nodes.find((node) => node.id === preference.capabilityNodeId)
      ?? nodes.find((node) => preference.module && node.module === preference.module);
    const effectivePlanItem = explicitlyRequested && planItem?.capabilityNodeId !== explicitlyRequested.id
      ? undefined
      : planItem;
    const capability = (
      explicitlyRequested
      ?? (effectivePlanItem ? nodes.find((node) => node.id === effectivePlanItem.capabilityNodeId) : undefined)
      ?? await this.resolveFallbackCapability(nodes)
    );
    if (!capability) throw new Error('当前大纲没有可训练的能力节点。');

    const load = prescribeDailyLearningLoad({
      availableMinutes: plan?.plan.availableMinutes ?? availableMinutesForToday(cycle.studyConstraints.weekdayMinutes, cycle.studyConstraints.weekendMinutes),
      strategy: decidePreparationStrategy({ remainingDays: daysUntil(cycle.examCycle.examDate) })
    });
    const requestedCount = clampCount(effectivePlanItem?.targetCount ?? defaultCountFor(effectivePlanItem, load));
    return {
      plan,
      planItem: effectivePlanItem,
      capability,
      requestedCount,
      assessmentRole: roleFor(effectivePlanItem),
      title: effectivePlanItem
        ? `${actionLabel(effectivePlanItem.itemType)} · ${capability.name}`
        : `建立能力样本 · ${capability.name}`,
      description: effectivePlanItem
        ? `${planReasonLabel(effectivePlanItem.reason)}，计划 ${effectivePlanItem.targetMinutes} 分钟${effectivePlanItem.targetCount ? `、${requestedCount} 题` : ''}。`
        : '当前还没有可执行的训练项，先从优先能力点建立真实作答证据。'
    };
  }

  async start(prescription: TutorPracticePrescription, gateway: ProviderGateway): Promise<TutorPracticeStartResult> {
    const item = prescription.planItem;
    if (item?.reviewQueueItemId) {
      const result = await new ReviewPracticeFeature(this.runtime).start(
        item.reviewQueueItemId as Parameters<ReviewPracticeFeature['start']>[0],
        gateway
      );
      return {
        questionSetId: result.questionSetId,
        learningThreadId: result.thread.id,
        reviewQueueItemId: result.review.id,
        dailyPlanItemId: item.id
      };
    }

    if (item) {
      await this.runtime.updateDailyPlanItemStatus.execute({
        dailyPlanItemId: item.id,
        status: 'in_progress'
      });
    }
    try {
      const feature = new StructuredPracticeFeature(this.runtime);
      const aggregate = await feature.request({
        idempotencyKey: `practice:daily-plan:${item?.id ?? prescription.capability.id}:${Date.now()}`,
        capabilityNodeId: prescription.capability.id,
        assessmentRole: prescription.assessmentRole,
        requestedCount: prescription.requestedCount,
        difficultyMin: difficultyFor(prescription.assessmentRole)[0],
        difficultyMax: difficultyFor(prescription.assessmentRole)[1],
        goal: `按今日私教计划完成${prescription.capability.name}训练`,
        constraints: {
          source: 'daily_plan',
          dailyPlanId: prescription.plan?.plan.id ?? null,
          dailyPlanItemId: item?.id ?? null,
          capabilityCode: prescription.capability.code,
          capabilityName: prescription.capability.name
        }
      });
      const result = await feature.run(aggregate.workflow.id, gateway);
      if (!result.questionSetId) throw new Error('题组未能发布。');
      return {
        questionSetId: result.questionSetId,
        learningThreadId: aggregate.spec.learningThreadId!,
        dailyPlanItemId: item?.id
      };
    } catch (error) {
      if (item) {
        await this.runtime.updateDailyPlanItemStatus.execute({
          dailyPlanItemId: item.id,
          status: 'pending',
          failureCode: 'practice_generation_failed',
          failureMessage: error instanceof Error ? error.message.slice(0, 240) : '生成练习失败，请稍后重试。'
        });
      }
      throw error;
    }
  }

  private async resolveFallbackCapability(
    nodes: readonly CapabilityNode[]
  ): Promise<CapabilityNode | undefined> {
    const subjects = [...new Set(nodes.map((node) => node.subject))];
    const snapshots = await Promise.all(subjects.map((subject) => (
      this.runtime.buildLearnerPrioritySnapshot.execute({ subject: subject as SubjectCode })
    )));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const selected = snapshots
      .flatMap((snapshot) => snapshot?.priorities ?? [])
      .filter((item) => nodeIds.has(item.capabilityNodeId))
      .sort((left, right) => right.priority - left.priority)[0];
    return selected ? nodes.find((node) => node.id === selected.capabilityNodeId) : nodes[0];
  }
}

function today(): LocalDate {
  return new Date().toLocaleDateString('en-CA') as LocalDate;
}

function availableMinutesForToday(weekdayMinutes: number, weekendMinutes: number): number {
  const weekday = new Date().getDay();
  return Math.max(5, weekday === 0 || weekday === 6 ? weekendMinutes : weekdayMinutes);
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(20, Math.round(count)));
}

function defaultCountFor(
  item: DailyPlanItemRecord | undefined,
  load: ReturnType<typeof prescribeDailyLearningLoad>
): number {
  return targetCountForPlanItem(item?.itemType ?? 'independent_practice', item?.targetMinutes ?? 20, load) ?? load.baselinePracticeCount;
}

function roleFor(item?: DailyPlanItemRecord) {
  if (item?.itemType === 'lecture') return AssessmentRole.Teaching;
  if (item?.itemType === 'diagnosis') return AssessmentRole.Anchor;
  if (item?.itemType === 'guided_practice') return AssessmentRole.Guided;
  if (item?.itemType === 'transfer') return AssessmentRole.Transfer;
  if (item?.itemType === 'review') return AssessmentRole.Retention;
  return AssessmentRole.Practice;
}

export function difficultyFor(role: typeof AssessmentRole[keyof typeof AssessmentRole]): readonly [number, number] {
  if (role === AssessmentRole.Guided) return [0.25, 0.55];
  if (role === AssessmentRole.Transfer) return [0.5, 0.8];
  if (role === AssessmentRole.Retention) return [0.4, 0.65];
  return [0.35, 0.68];
}

function actionLabel(type: DailyPlanItemRecord['itemType']): string {
  if (type === 'lecture') return '知识讲解';
  if (type === 'guided_practice') return '引导练习';
  if (type === 'independent_practice') return '独立练习';
  if (type === 'review') return '间隔复习';
  if (type === 'transfer') return '迁移训练';
  if (type === 'diagnosis') return '能力诊断';
  if (type === 'variant') return '变式训练';
  if (type === 'timed') return '限时训练';
  if (type === 'mock') return '模拟测评';
  if (type === 'essay') return '申论训练';
  return '每日积累';
}

function planReasonLabel(reason: string): string {
  const labels: Readonly<Record<string, string>> = {
    [DailyPlanReasonCode.MasteryRepairRequired]: '当前掌握出现回退，需要先补讲并修复',
    [DailyPlanReasonCode.IndependentEvidenceNeeded]: '还缺少独立作答证据',
    [DailyPlanReasonCode.TransferEvidenceNeeded]: '需要用变式题验证迁移能力',
    [ReviewReasonCode.RecentPerformanceRegression]: '最近表现出现回退，需要及时复习',
    [ReviewReasonCode.SpacedRetentionMaintenance]: '已到间隔复习时间',
    [ReviewReasonCode.MasteryEvidenceIncomplete]: '当前掌握证据还不充分'
  };
  return labels[reason] ?? '根据当前能力证据安排';
}

function daysUntil(examDate: string): number | undefined {
  const target = Date.parse(`${examDate}T12:00:00`);
  if (!Number.isFinite(target)) return undefined;
  return Math.max(0, Math.ceil((target - Date.now()) / 86_400_000));
}
