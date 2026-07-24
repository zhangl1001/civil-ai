import { AIRateLimitError, AITransientError } from '@/ai/AIProvider';
import type { LocalTask, TaskType } from '@/domain/task';
import { taskStore, type TaskStore } from './TaskStore';
import type { CreateTaskInput, EnqueueResult } from './taskTypes';
import type { TaskRunner, TaskRunnerRegistry } from './TaskRunner';

export const DEFAULT_MAX_CONCURRENT_TASKS = 3;
export const MIN_MAX_CONCURRENT_TASKS = 1;
export const MAX_MAX_CONCURRENT_TASKS = 5;
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 12_000;
const RATE_LIMIT_MAX_DELAY_MS = 90_000;

export class TaskQueue {
  private runners: TaskRunnerRegistry = {};
  private draining = false;
  private abortControllers = new Map<string, AbortController>();
  private runningTaskIds = new Set<string>();
  private taskRetryAfter = new Map<string, number>();
  private concurrencyCooldownUntil = 0;
  private maxConcurrentTasks: number;

  constructor(
    private readonly store: TaskStore,
    maxConcurrent = DEFAULT_MAX_CONCURRENT_TASKS
  ) {
    this.maxConcurrentTasks = this.normalizeMaxConcurrent(maxConcurrent);
  }

  register(type: TaskType, runner: TaskRunner): void {
    this.runners[type] = runner;
  }

  async enqueue(input: CreateTaskInput): Promise<EnqueueResult> {
    const result = await this.store.enqueue(input);
    if (result.reused && result.task.status === 'paused') {
      await this.store.update(result.task.id, {
        status: 'retrying',
        progressText: '恢复执行'
      });
      await this.store.appendLog(result.task.id, 'info', '重复触发时恢复未完成任务');
    }
    if (!result.reused || result.task.status === 'queued' || result.task.status === 'retrying' || result.task.status === 'paused') {
      void this.drain();
    }
    return result;
  }

  async cancel(taskId: string): Promise<void> {
    const controller = this.abortControllers.get(taskId);
    if (controller) controller.abort();
    await this.store.update(taskId, {
      status: 'cancelled',
      error: '任务已取消',
      progressText: '已取消'
    });
    await this.store.appendLog(taskId, 'warn', '任务已取消');
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.runningTaskIds.size < this.currentMaxConcurrent()) {
        const next = await this.nextQueuedTask();
        if (!next) return;
        this.runningTaskIds.add(next.id);
        void this.run(next).finally(() => {
          this.runningTaskIds.delete(next.id);
          void this.drain();
        });
      }
    } finally {
      this.draining = false;
    }
  }

  setMaxConcurrent(value: number): void {
    this.maxConcurrentTasks = this.normalizeMaxConcurrent(value);
    void this.drain();
  }

  getMaxConcurrent(): number {
    return this.maxConcurrentTasks;
  }

  private normalizeMaxConcurrent(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT_TASKS;
    return Math.max(MIN_MAX_CONCURRENT_TASKS, Math.min(MAX_MAX_CONCURRENT_TASKS, Math.round(value)));
  }

  private async nextQueuedTask(): Promise<LocalTask | undefined> {
    const now = Date.now();
    const tasks = await this.store.list();
    return tasks
      .filter((task) => task.status === 'queued' || task.status === 'retrying')
      .filter((task) => !this.runningTaskIds.has(task.id))
      .filter((task) => (this.taskRetryAfter.get(task.id) || 0) <= now)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  private currentMaxConcurrent(): number {
    return Date.now() < this.concurrencyCooldownUntil ? 1 : this.maxConcurrentTasks;
  }

  private retryDelay(error: AIRateLimitError | AITransientError, retryCount: number): number {
    const providerDelay = error.retryAfterMs || 0;
    const exponentialDelay = RATE_LIMIT_BASE_DELAY_MS * 2 ** retryCount;
    const jitter = Math.round(Math.random() * 3000);
    return Math.min(RATE_LIMIT_MAX_DELAY_MS, Math.max(providerDelay, exponentialDelay + jitter));
  }

  private applyRateLimitCooldown(delayMs: number): void {
    this.concurrencyCooldownUntil = Math.max(this.concurrencyCooldownUntil, Date.now() + Math.max(delayMs, 30_000));
  }

  private async scheduleProviderRetry(task: LocalTask, error: AIRateLimitError | AITransientError): Promise<boolean> {
    const retryCount = Number(task.payload?.__rateLimitRetryCount || 0);
    if (retryCount >= RATE_LIMIT_MAX_RETRIES) return false;

    const delayMs = this.retryDelay(error, retryCount);
    const isRateLimit = error instanceof AIRateLimitError;
    const nextPayload = {
      ...(task.payload || {}),
      __rateLimitRetryCount: retryCount + 1
    };
    this.taskRetryAfter.set(task.id, Date.now() + delayMs);
    this.applyRateLimitCooldown(delayMs);
    await this.store.update(task.id, {
      status: 'retrying',
      payload: nextPayload,
      error: error.message,
      progressText: `${isRateLimit ? 'AI 服务限流' : 'AI 服务临时异常'}，${Math.ceil(delayMs / 1000)} 秒后自动重试`
    });
    await this.store.appendLog(task.id, 'warn', `${isRateLimit ? 'AI 服务限流' : `AI 服务临时异常(${error.status || 'network'})`}，已临时降级为单任务执行，${Math.ceil(delayMs / 1000)} 秒后第 ${retryCount + 1} 次重试`);
    window.setTimeout(() => {
      this.taskRetryAfter.delete(task.id);
      void this.drain();
    }, delayMs);
    return true;
  }

  private async run(task: LocalTask): Promise<void> {
    const latestBeforeRun = await this.store.get(task.id);
    if (!latestBeforeRun || latestBeforeRun.status === 'cancelled') return;
    if (latestBeforeRun.status !== 'queued' && latestBeforeRun.status !== 'retrying') return;

    const runner = this.runners[task.type];
    if (!runner) {
      await this.store.update(task.id, {
        status: 'failed',
        error: `没有注册任务执行器: ${task.type}`,
        progressText: '缺少执行器'
      });
      await this.store.appendLog(task.id, 'error', `没有注册任务执行器: ${task.type}`);
      return;
    }

    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);
    await this.store.update(task.id, { status: 'running', progressText: '开始执行' });
    await this.store.appendLog(task.id, 'info', '任务开始执行');

    try {
      await runner(task, {
        store: this.store,
        signal: controller.signal,
        update: async (progress, progressText) => {
          await this.store.update(task.id, { progress, progressText });
        },
        log: async (message) => {
          await this.store.appendLog(task.id, 'info', message);
        }
      });
      const latest = await this.store.get(task.id);
      if (latest?.status !== 'cancelled') {
        await this.store.update(task.id, { status: 'done', progress: 100, progressText: '已完成' });
        await this.store.appendLog(task.id, 'info', '任务已完成');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted;
      if (!aborted && (error instanceof AIRateLimitError || error instanceof AITransientError) && await this.scheduleProviderRetry(task, error)) return;
      await this.store.update(task.id, {
        status: aborted ? 'cancelled' : 'failed',
        error: message,
        progressText: aborted ? '已取消' : '执行失败'
      });
      await this.store.appendLog(task.id, aborted ? 'warn' : 'error', message);
    } finally {
      this.abortControllers.delete(task.id);
    }
  }
}

export const taskQueue = new TaskQueue(taskStore);
