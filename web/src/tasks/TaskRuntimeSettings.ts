import { settingsService } from '@/services/SettingsService';
import { DEFAULT_MAX_CONCURRENT_TASKS, MAX_MAX_CONCURRENT_TASKS, MIN_MAX_CONCURRENT_TASKS, taskQueue } from './TaskQueue';

const TASK_CONCURRENCY_KEY = 'task:maxConcurrent';

function normalize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT_TASKS;
  return Math.max(MIN_MAX_CONCURRENT_TASKS, Math.min(MAX_MAX_CONCURRENT_TASKS, Math.round(value)));
}

export class TaskRuntimeSettings {
  async load(): Promise<number> {
    const saved = await settingsService.get<number>(TASK_CONCURRENCY_KEY, DEFAULT_MAX_CONCURRENT_TASKS);
    const value = normalize(saved);
    taskQueue.setMaxConcurrent(value);
    return value;
  }

  async saveMaxConcurrent(value: number): Promise<number> {
    const normalized = normalize(value);
    await settingsService.set(TASK_CONCURRENCY_KEY, normalized);
    taskQueue.setMaxConcurrent(normalized);
    return normalized;
  }
}

export const taskRuntimeSettings = new TaskRuntimeSettings();
