import type { Router } from 'vue-router';
import type { LocalTask } from '@/domain/task';
import { practiceFlowService, type PracticeStartContext } from '@/services/PracticeFlowService';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function practiceContextFromTask(task: LocalTask): PracticeStartContext {
  const payload = task.payload || {};
  const mode = asString(payload.mode);
  return {
    module: asString(payload.module) || task.detail?.split(' · ')[0] || '资料分析',
    knowledgePoint: asString(payload.knowledgePoint) || undefined,
    date: asString(payload.date) || today(),
    mode: task.type === 'redo' || mode === 'review' ? 'review' : task.type === 'mock' ? 'mock' : 'practice',
    source: 'practice-center',
    questionCount: asNumber(payload.questionCount, task.type === 'mock' ? 120 : 10),
    sourceRef: task.id,
    needsGeneration: ['queued', 'running', 'retrying', 'paused'].includes(task.status)
  };
}

export async function openTaskTarget(task: LocalTask, router: Router): Promise<boolean> {
  if (task.type === 'generate' || task.type === 'redo') {
    practiceFlowService.writeStartContext(practiceContextFromTask(task));
    await router.push('/vue/practice/objective-session');
    return true;
  }

  if (task.type === 'mock') {
    if (asString(task.payload?.subject) === '申论') {
      await router.push('/vue/essay');
      return true;
    }
    practiceFlowService.writeStartContext(practiceContextFromTask(task));
    await router.push('/vue/practice/objective-session');
    return true;
  }

  if (task.type === 'grade' || task.type === 'essay') {
    if (task.payload?.intent === 'practiceGrade') {
      const sourceRef = asString(task.payload?.sourceId);
      const questionCount = asNumber(task.payload?.questionCount, 10);
      practiceFlowService.writeStartContext({
        module: asString(task.payload?.module) || task.detail?.split(' · ')[0] || '资料分析',
        date: asString(task.payload?.date) || today(),
        mode: 'practice',
        source: 'practice-center',
        questionCount,
        sourceRef,
        needsGeneration: false
      });
      await router.push('/vue/practice/objective-session');
      return true;
    }
    await router.push('/vue/essay');
    return true;
  }

  if (task.type === 'digest') {
    await router.push(task.payload?.digestScope === 'monthly' ? '/vue/monthly-digest' : '/vue/digest');
    return true;
  }

  if (task.type === 'study') {
    await router.push('/vue/study/lecture');
    return true;
  }

  if (task.type === 'interview') {
    await router.push('/vue/interview');
    return true;
  }

  return false;
}
