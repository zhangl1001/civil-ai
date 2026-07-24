import type { LocalTask, TaskType } from '@/domain/task';
import type { TaskStore } from './TaskStore';

export interface TaskRunContext {
  store: TaskStore;
  signal: AbortSignal;
  update(progress: number, progressText?: string): Promise<void>;
  log(message: string): Promise<void>;
}

export type TaskRunner = (task: LocalTask, context: TaskRunContext) => Promise<void>;

export type TaskRunnerRegistry = Partial<Record<TaskType, TaskRunner>>;
