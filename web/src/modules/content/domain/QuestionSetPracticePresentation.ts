import {
  QuestionSetPracticeStatus,
  type QuestionSetPracticeStatus as QuestionSetPracticeStatusCode
} from './ContentCodes';

const labels: Readonly<Record<QuestionSetPracticeStatusCode, string>> = {
  [QuestionSetPracticeStatus.NotStarted]: '未练习',
  [QuestionSetPracticeStatus.InProgress]: '进行中',
  [QuestionSetPracticeStatus.Completed]: '已完成'
};

export function questionSetPracticeStatusLabel(status: QuestionSetPracticeStatusCode): string {
  return labels[status];
}
