import type { LearningEventType } from './learning';
import type { PracticeMode } from './practice';

export const DEFAULT_PRACTICE_MODULE = '专项练习';

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
  if (type === 'review') return LEARNING_EVENT_LABELS.review;
  if (type === 'digest') return LEARNING_EVENT_LABELS.digest;
  if (type === 'grade') return LEARNING_EVENT_LABELS.grade;
  return `行测 · ${module || DEFAULT_PRACTICE_MODULE}`;
}
