import { shallowRef } from 'vue';
import type { CapabilityNode } from '@/modules/curriculum/public';
import type { LearningEventType } from './learning';
import type { PracticeMode } from './practice';

export { APTITUDE_MODULE_CODES, PracticeModuleCode } from './practiceModuleCodes';

export const DEFAULT_PRACTICE_MODULE = '专项练习';

export const PROVINCE_OPTIONS = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'
] as const;

export interface CurriculumModuleOption {
  readonly code: string;
  readonly name: string;
}

interface CurriculumLabelCatalog {
  readonly labelByCode: Readonly<Record<string, string>>;
  readonly codeByLabel: Readonly<Record<string, string>>;
  readonly moduleOptions: readonly CurriculumModuleOption[];
}

const EMPTY_CATALOG: CurriculumLabelCatalog = { labelByCode: {}, codeByLabel: {}, moduleOptions: [] };

const SUBJECT_NODE_TYPE = 'subject';
const MODULE_NODE_TYPE = 'module';
const ACTIVE_NODE_STATUS = 'active';

/**
 * Display names for subjects and modules, projected from the active exam
 * package. Codes are stable and defined in code; the Chinese names are not —
 * they belong to the package, so a different package renames the whole UI
 * without touching application code.
 *
 * Held in a `shallowRef` because the active package can change: the app installs
 * the default package before mounting and re-installs the candidate's own
 * package once the runtime resolves it. Readers stay plain function calls and
 * any template that used one re-renders on its own.
 */
const catalog = shallowRef<CurriculumLabelCatalog>(EMPTY_CATALOG);

export function installCurriculumLabels(nodes: readonly CapabilityNode[]): void {
  const named = nodes
    .filter((node) => node.status === ACTIVE_NODE_STATUS)
    .filter((node) => node.nodeType === SUBJECT_NODE_TYPE || node.nodeType === MODULE_NODE_TYPE);
  catalog.value = {
    labelByCode: Object.fromEntries(named.map((node) => [node.module, displayName(node)])),
    codeByLabel: Object.fromEntries(named.flatMap((node) => {
      const display = displayName(node);
      // Both forms resolve back to the code so a name written by the model or
      // stored on an older record still maps home.
      return display === node.name ? [[display, node.module]] : [[display, node.module], [node.name, node.module]];
    })),
    moduleOptions: named
      .filter((node) => node.nodeType === MODULE_NODE_TYPE)
      .sort((left, right) => left.sequence - right.sequence)
      .map((node) => ({ code: node.module, name: displayName(node) }))
  };
}

function displayName(node: CapabilityNode): string {
  return node.shortName?.trim() || node.name;
}

/** Modules of the active package, in package order. Drives filters and pickers. */
export function curriculumModuleOptions(): readonly CurriculumModuleOption[] {
  return catalog.value.moduleOptions;
}

export function practiceModuleLabel(code?: string): string {
  const normalized = code?.trim() || '';
  return catalog.value.labelByCode[normalized] || normalized || DEFAULT_PRACTICE_MODULE;
}

export function practiceModuleCode(value?: string): string {
  const normalized = value?.trim() || '';
  if (catalog.value.labelByCode[normalized]) return normalized;
  return catalog.value.codeByLabel[normalized] || normalized;
}

export const LEARNING_EVENT_LABELS: Record<LearningEventType, string> = {
  practice: '客观题练习',
  review: '错题复习',
  essay: '主观题练习',
  mock: '模拟考试',
  digest: '每日积累',
  grade: '批改反馈'
};

export const PRACTICE_MODE_LABELS: Record<PracticeMode, string> = {
  practice: '练习',
  review: '复习',
  mock: '模考',
  essay: '主观题',
  diagnostic: '诊断'
};

export function calendarTaskTitle(type: LearningEventType | PracticeMode, module?: string): string {
  if (type === 'mock') return LEARNING_EVENT_LABELS.mock;
  if (type === 'essay') return LEARNING_EVENT_LABELS.essay;
  if (type === 'review') return `${practiceModuleLabel(module)}复习`;
  if (type === 'digest') return LEARNING_EVENT_LABELS.digest;
  if (type === 'grade') return LEARNING_EVENT_LABELS.grade;
  return `${practiceModuleLabel(module)}练习`;
}
