import type { LearningEventType } from './learning';
import type { PracticeMode } from './practice';

export const DEFAULT_PRACTICE_MODULE = '专项练习';

export const PROVINCE_OPTIONS = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'
] as const;

export const PracticeModuleCode = {
  Judgment: 'judgment',
  Verbal: 'verbal',
  DataAnalysis: 'data_analysis',
  Quantity: 'quantity',
  CommonSense: 'common_sense',
  Aptitude: 'aptitude',
  Essay: 'essay'
} as const;

export type PracticeModuleCode = typeof PracticeModuleCode[keyof typeof PracticeModuleCode];

export const PRACTICE_MODULE_LABELS: Readonly<Record<string, string>> = {
  [PracticeModuleCode.Judgment]: '判断推理',
  [PracticeModuleCode.Verbal]: '言语理解',
  [PracticeModuleCode.DataAnalysis]: '资料分析',
  [PracticeModuleCode.Quantity]: '数量关系',
  [PracticeModuleCode.CommonSense]: '常识判断',
  [PracticeModuleCode.Aptitude]: '行测',
  [PracticeModuleCode.Essay]: '申论',
  行测模考: '行测模考'
};

export const APTITUDE_PRACTICE_MODULE_OPTIONS = [
  { code: PracticeModuleCode.Judgment, name: PRACTICE_MODULE_LABELS[PracticeModuleCode.Judgment] },
  { code: PracticeModuleCode.Verbal, name: PRACTICE_MODULE_LABELS[PracticeModuleCode.Verbal] },
  { code: PracticeModuleCode.DataAnalysis, name: PRACTICE_MODULE_LABELS[PracticeModuleCode.DataAnalysis] },
  { code: PracticeModuleCode.Quantity, name: PRACTICE_MODULE_LABELS[PracticeModuleCode.Quantity] },
  { code: PracticeModuleCode.CommonSense, name: PRACTICE_MODULE_LABELS[PracticeModuleCode.CommonSense] }
] as const;

export function practiceModuleLabel(code?: string): string {
  const normalized = code?.trim() || '';
  return PRACTICE_MODULE_LABELS[normalized] || normalized || DEFAULT_PRACTICE_MODULE;
}

export function practiceModuleCode(value?: string): string {
  const normalized = value?.trim() || '';
  if (PRACTICE_MODULE_LABELS[normalized]) return normalized;
  return Object.entries(PRACTICE_MODULE_LABELS)
    .find(([, label]) => label === normalized)?.[0] || normalized;
}

export const LEARNING_EVENT_LABELS: Record<LearningEventType, string> = {
  practice: '行测练习',
  review: '错题复习',
  essay: '申论练习',
  mock: '模拟考试',
  digest: '每日积累',
  grade: '批改反馈'
};

export const PRACTICE_MODE_LABELS: Record<PracticeMode, string> = {
  practice: '练习',
  review: '复习',
  mock: '模考',
  essay: '申论',
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
