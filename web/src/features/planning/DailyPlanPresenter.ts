import type { CapabilityNodeId, JsonObject } from '@/kernel/public';
import { practiceModuleLabel } from '@/domain/labels';
import type {
  DailyPlanAggregate,
  DailyPlanBlockRecord,
  DailyPlanItemCategoryCode,
  DailyPlanItemRecord
} from '@/modules/planning/public';

export interface DailyPlanCapabilityMeta {
  readonly id: CapabilityNodeId;
  readonly name: string;
  readonly module: string;
}

export interface DailyPlanViewGroup {
  readonly category: DailyPlanItemCategoryCode;
  readonly label: string;
  readonly items: readonly DailyPlanViewItem[];
}

export interface DailyPlanViewItem {
  readonly item: DailyPlanItemRecord;
  readonly block?: DailyPlanBlockRecord;
  readonly capabilityName: string;
  readonly moduleName: string;
}

const CATEGORY_ORDER: readonly DailyPlanItemCategoryCode[] = ['review', 'learn', 'practice', 'assess', 'accumulate'];

export function buildDailyPlanGroups(
  aggregate: DailyPlanAggregate,
  capabilities: ReadonlyMap<string, DailyPlanCapabilityMeta>
): readonly DailyPlanViewGroup[] {
  const blocks = new Map(aggregate.blocks.map((block) => [block.id, block]));
  const groups = new Map<DailyPlanItemCategoryCode, DailyPlanViewItem[]>();
  for (const item of aggregate.items) {
    const block = blocks.get(item.dailyPlanBlockId);
    const capability = capabilities.get(item.capabilityNodeId);
    const entries = groups.get(item.category) ?? [];
    entries.push({
      item,
      block,
      capabilityName:capability?.name || '待诊断能力点',
      moduleName: practiceModuleLabel(block?.module || capability?.module || '')
    });
    groups.set(item.category, entries);
  }
  return CATEGORY_ORDER.flatMap((category) => {
    const items = groups.get(category);
    return items?.length ? [{ category, label:categoryLabel(category), items }] : [];
  });
}

export function actionLabel(type: DailyPlanItemRecord['itemType']): string {
  const labels: Readonly<Record<DailyPlanItemRecord['itemType'], string>> = {
    diagnosis:'能力诊断',
    lecture:'知识讲解',
    guided_practice:'引导练习',
    independent_practice:'独立练习',
    variant:'变式训练',
    timed:'限时训练',
    review:'间隔复习',
    transfer:'迁移训练',
    mock:'模拟测评',
    essay:'申论训练',
    digest:'每日积累'
  };
  return labels[type];
}

export function planItemActionLabel(item: DailyPlanItemRecord): string {
  if (item.itemType === 'digest' && item.exitCriteria.digestTab === 'news') return '每日热点';
  return actionLabel(item.itemType);
}

export function targetCountLabel(item: DailyPlanItemRecord): string {
  if (!item.targetCount) return '';
  return item.itemType === 'digest' ? ` · ${item.targetCount} 个主题` : ` · ${item.targetCount} 题`;
}

export function statusLabel(status: DailyPlanItemRecord['status']): string {
  return { pending:'', in_progress:' · 进行中', completed:' · 已完成', skipped:' · 已跳过', cancelled:' · 已取消' }[status];
}

export function planProgressLabel(plan: DailyPlanAggregate): string {
  const completed = plan.items.filter((item) => item.status === 'completed').length;
  return `${completed}/${plan.items.length} 项完成 · ${plan.plan.availableMinutes} 分钟计划`;
}

export function preparationHorizonLabel(factors: JsonObject): string {
  const strategy = factors.strategy;
  if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) return '动态计划';
  const horizon = (strategy as Record<string, unknown>).horizon;
  return {
    extended:'长期打底',
    progressive:'稳步提升',
    consolidation:'强化巩固',
    sprint:'考前冲刺'
  }[String(horizon)] || '动态计划';
}

function categoryLabel(category: DailyPlanItemCategoryCode): string {
  return { review:'今日复习', learn:'今日学习', practice:'今日练习', assess:'能力测评', accumulate:'知识积累' }[category];
}
