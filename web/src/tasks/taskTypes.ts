import type { LocalTask, TaskStatus, TaskType } from '@/domain/task';

export const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['queued', 'running', 'retrying', 'paused']);

export interface CreateTaskInput {
  type: TaskType;
  projectId: string;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  inputHash?: string;
  lockKey?: string;
}

export interface TaskUpdate {
  status?: TaskStatus;
  title?: string;
  detail?: string;
  progress?: number;
  progressText?: string;
  payload?: Record<string, unknown>;
  resultRef?: string;
  error?: string;
}

export interface EnqueueResult {
  task: LocalTask;
  reused: boolean;
  reason?: string;
}

export function isActiveTask(task: LocalTask): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status);
}
