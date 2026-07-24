import { taskQueue } from './TaskQueue';
import { taskStore } from './TaskStore';
import type { TaskRunner } from './TaskRunner';
import { appLifecycleAdapter } from '@/platform/AppLifecycleAdapter';
import { chatRunner, digestRunner, essayGradeRunner, generatePracticeRunner, interviewReviewRunner, mockRunner, studyRunner } from './AIRunners';
import { taskRuntimeSettings } from './TaskRuntimeSettings';

let initialized = false;

const demoRunner: TaskRunner = async (_task, context) => {
  const steps = [
    [16, '准备本地任务环境'],
    [34, '读取 IndexedDB 状态'],
    [58, '生成任务进度反馈'],
    [76, '刷新界面状态'],
    [94, '写入任务结果']
  ] as const;

  for (const [progress, progressText] of steps) {
    if (context.signal.aborted) throw new Error('任务已取消');
    await context.update(progress, progressText);
    await context.log(progressText);
    await new Promise((resolve) => window.setTimeout(resolve, 420));
  }
};

export async function bootstrapTasks(): Promise<void> {
  if (initialized) return;
  initialized = true;
  taskQueue.register('chat', chatRunner);
  taskQueue.register('generate', generatePracticeRunner);
  taskQueue.register('grade', essayGradeRunner);
  taskQueue.register('digest', digestRunner);
  taskQueue.register('study', studyRunner);
  taskQueue.register('mock', mockRunner);
  taskQueue.register('redo', generatePracticeRunner);
  taskQueue.register('interview', interviewReviewRunner);
  if (import.meta.env.DEV) {
    taskQueue.register('demo', demoRunner);
    taskQueue.register('sync', demoRunner);
  }
  await taskRuntimeSettings.load();
  await taskStore.recoverInterrupted();
  await taskStore.resumePaused();
  void taskQueue.drain();

  appLifecycleAdapter.onActive(async () => {
    await taskStore.recoverInterrupted();
    await taskStore.resumePaused();
    void taskQueue.drain();
  });
}
