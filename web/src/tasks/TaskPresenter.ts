import type { LocalTask, TaskStatus } from '@/domain/task';
import { ACTIVE_TASK_STATUSES } from './taskTypes';

const STATUS_TEXT: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '执行中',
  retrying: '重试中',
  paused: '已暂停',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

const STATUS_RANK: Record<TaskStatus, number> = {
  running: 0,
  retrying: 1,
  queued: 2,
  paused: 3,
  failed: 4,
  done: 5,
  cancelled: 6
};

export interface TaskViewModel {
  id: string;
  raw: LocalTask;
  type: LocalTask['type'];
  status: TaskStatus;
  title: string;
  detail: string;
  progressText: string;
  statusText: string;
  summary: string;
  progress: number;
  canCancel: boolean;
  isActive: boolean;
  isRunningLike: boolean;
}

export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

export function canCancelTask(task: LocalTask): boolean {
  return isActiveStatus(task.status);
}

export function taskStatusText(status: TaskStatus): string {
  return STATUS_TEXT[status];
}

export function taskSortRank(task: LocalTask): number {
  return STATUS_RANK[task.status] ?? 9;
}

export function taskBrief(task: LocalTask): string {
  return task.progressText || task.detail || '等待执行';
}

export function taskSummary(task: LocalTask): string {
  return [task.title, taskBrief(task), taskStatusText(task.status)].filter(Boolean).join(' · ');
}

export function taskContentText(task: Pick<TaskViewModel, 'title' | 'detail' | 'progressText' | 'statusText'>): string {
  const duplicateTexts = ['已完成', '执行失败', '失败', '已取消', '任务已取消', '开始执行', '等待执行', task.statusText];
  const source = task.detail || task.progressText || task.statusText;
  const content = source
    .split('·')
    .map((item) => item.trim())
    .filter((item) => item && item !== task.title && !duplicateTexts.includes(item))
    .join(' · ');
  if (content) return content;
  return duplicateTexts.includes(source) ? '' : source;
}

export function taskBelongsToSession(task: LocalTask, sessionId: string | undefined, linkedTaskIds: ReadonlySet<string>): boolean {
  if (task.type === 'chat') return false;
  if (!sessionId) return false;
  return task.payload?.sessionId === sessionId || linkedTaskIds.has(task.id);
}

export function toTaskViewModel(task: LocalTask): TaskViewModel {
  const isActive = isActiveStatus(task.status);
  return {
    id: task.id,
    raw: task,
    type: task.type,
    status: task.status,
    title: task.title,
    detail: task.detail || '',
    progressText: task.progressText || '',
    statusText: taskStatusText(task.status),
    summary: taskSummary(task),
    progress: task.progress,
    canCancel: canCancelTask(task),
    isActive,
    isRunningLike: ['queued', 'running', 'retrying'].includes(task.status)
  };
}

export function visibleTaskRows(tasks: LocalTask[], limit = 2): LocalTask[] {
  const active = tasks.filter((task) => isActiveStatus(task.status)).slice(0, limit);
  return active.length ? active : tasks.slice(0, limit);
}
