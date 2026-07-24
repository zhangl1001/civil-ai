import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { LocalTask, TaskLog, TaskStatus } from '@/domain/task';
import { defaultLockKey } from './TaskLocks';
import type { CreateTaskInput, EnqueueResult, TaskUpdate } from './taskTypes';
import { isActiveTask } from './taskTypes';

const TASK_CHANGED_EVENT = 'zhangl-task-changed';

function taskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function logId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampProgress(progress: number | undefined): number {
  if (typeof progress !== 'number' || Number.isNaN(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export class TaskStore {
  private notify(task?: LocalTask): void {
    window.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT, { detail: { taskId: task?.id || '' } }));
  }

  async list(projectId?: string): Promise<LocalTask[]> {
    const tasks = projectId
      ? await database.queryByIndex<LocalTask>(STORES.aiTasks, 'projectId', projectId)
      : await database.list<LocalTask>(STORES.aiTasks);
    return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listActive(projectId?: string): Promise<LocalTask[]> {
    const tasks = await this.list(projectId);
    return tasks.filter(isActiveTask);
  }

  async get(id: string): Promise<LocalTask | undefined> {
    return database.get<LocalTask>(STORES.aiTasks, id);
  }

  async enqueue(input: CreateTaskInput): Promise<EnqueueResult> {
    const lockKey = input.lockKey || defaultLockKey(input);
    const active = await this.findActiveByLock(lockKey);
    if (active) {
      return { task: active, reused: true, reason: '同类任务正在处理中' };
    }

    const now = Date.now();
    const task: LocalTask = {
      id: taskId(),
      type: input.type,
      projectId: input.projectId,
      status: 'queued',
      title: input.title,
      detail: input.detail,
      payload: input.payload,
      progress: 0,
      inputHash: input.inputHash,
      lockKey,
      createdAt: now,
      updatedAt: now
    };
    await database.put<LocalTask>(STORES.aiTasks, task);
    await this.appendLog(task.id, 'info', '任务已加入队列');
    this.notify(task);
    return { task, reused: false };
  }

  async update(id: string, patch: TaskUpdate): Promise<LocalTask | undefined> {
    const current = await this.get(id);
    if (!current) return undefined;
    const next: LocalTask = {
      ...current,
      ...patch,
      progress: patch.progress === undefined ? current.progress : clampProgress(patch.progress),
      updatedAt: Date.now()
    };
    await database.put<LocalTask>(STORES.aiTasks, next);
    this.notify(next);
    return next;
  }

  async transition(id: string, status: TaskStatus, progressText?: string): Promise<LocalTask | undefined> {
    return this.update(id, {
      status,
      progress: status === 'done' ? 100 : undefined,
      progressText
    });
  }

  async appendLog(taskIdValue: string, level: TaskLog['level'], message: string): Promise<TaskLog> {
    const log: TaskLog = {
      id: logId(),
      taskId: taskIdValue,
      level,
      message,
      createdAt: Date.now()
    };
    await database.put<TaskLog>(STORES.taskLogs, log);
    window.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT, { detail: { taskId: taskIdValue } }));
    return log;
  }

  async logs(taskIdValue: string): Promise<TaskLog[]> {
    const logs = await database.queryByIndex<TaskLog>(STORES.taskLogs, 'taskId', taskIdValue);
    return logs.sort((a, b) => a.createdAt - b.createdAt);
  }

  async findActiveByLock(lockKey: string): Promise<LocalTask | undefined> {
    if (!lockKey) return undefined;
    const tasks = await database.queryByIndex<LocalTask>(STORES.aiTasks, 'lockKey', lockKey);
    return tasks.find(isActiveTask);
  }

  async recoverInterrupted(): Promise<number> {
    const active = await this.listActive();
    const now = Date.now();
    const interrupted = active.filter((task) => task.status === 'running');
    await database.putMany<LocalTask>(STORES.aiTasks, interrupted.map((task) => ({
      ...task,
      status: 'paused',
      progressText: task.progressText || 'App 已恢复，等待继续',
      updatedAt: now
    })));
    await Promise.all(interrupted.map((task) => this.appendLog(task.id, 'warn', '检测到未完成运行任务，已标记为暂停')));
    if (interrupted.length) this.notify();
    return interrupted.length;
  }

  async resumePaused(): Promise<number> {
    const active = await this.listActive();
    const paused = active.filter((task) => task.status === 'paused');
    if (!paused.length) return 0;
    const now = Date.now();
    await database.putMany<LocalTask>(STORES.aiTasks, paused.map((task) => ({
      ...task,
      status: 'retrying',
      progressText: '恢复执行',
      updatedAt: now
    })));
    await Promise.all(paused.map((task) => this.appendLog(task.id, 'info', '任务恢复执行')));
    this.notify();
    return paused.length;
  }
}

export const taskStore = new TaskStore();
export { TASK_CHANGED_EVENT };
