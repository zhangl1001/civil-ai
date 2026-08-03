import type { TutorPracticePrescription } from './TutorDailyPracticeFeature';
import type { PracticeCenterMode } from './usePracticeQuestionSetPagination';

export interface PracticeModeCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly listHeading: string;
  readonly listDescription: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
}

export function practiceModeCopy(
  mode: PracticeCenterMode,
  prescription: TutorPracticePrescription | null,
  tutorDescription: string
): PracticeModeCopy {
  if (mode === 'true') {
    return {
      eyebrow: '真题校准',
      title: '用真实试题校准能力与训练方向',
      description: '按年份、地区和来源练习已导入真题，作答结果进入同一套批改、错因与能力证据链。',
      listHeading: '真题题库',
      listDescription: '官方真题、导入题与自建题独立归档',
      emptyTitle: '还没有可练习的真题',
      emptyDescription: '导入文件或创建联网研究任务，确认草稿后真题会按来源归档在这里。'
    };
  }
  if (mode === 'self') {
    return {
      eyebrow: '自主加练',
      title: '按自己的节奏选择训练内容',
      description: '自主选择模块、细分考点和题量，生成的题组只保存在自主刷题分类中。',
      listHeading: '自主题组',
      listDescription: '由你主动选择条件生成',
      emptyTitle: '还没有自主题组',
      emptyDescription: '设置模块、考点和题量后，自主题组会保存在这里。'
    };
  }
  return {
    eyebrow: '当前私教主线',
    title: prescription?.title || '正在读取今日私教安排',
    description: prescription
      ? `根据计划、薄弱点和复习节奏安排：${tutorDescription}`
      : '私教会结合当前计划、能力证据和待复习知识点确定训练内容。',
    listHeading: '私教题组',
    listDescription: '由计划、薄弱点和复习任务生成',
    emptyTitle: '还没有私教题组',
    emptyDescription: '开始今日教学动作后，私教题组会保存在这里。'
  };
}
