import { initializeTutorRuntime } from '@/composition-root/public';
import {
  LearningAssetKind,
  LearningAssetPurpose,
  LearningAssetStatus,
  type LearningAssetRecord
} from '@/modules/content/public';
import { generationTaskService } from './GenerationTaskService';
import { essayFlowService } from './EssayFlowService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';
import { normalizeEssayQuestionSetMode, type EssayQuestionSetMode } from '@/domain/essayQuestionSet';

export type ExamSubject = '行测' | '申论';
export type EssayMockType = 'short' | 'long';

export interface ExamScheme {
  label: string;
  count: number;
  durationMinutes: number;
}

export interface ExamStartContext {
  subject: ExamSubject;
  date: string;
  questionCount: number;
  durationMinutes: number;
  tags: string[];
  essayType: EssayMockType;
}

export interface ExamHistoryItem {
  id: string;
  subject: ExamSubject;
  date: string;
  title: string;
  questionCount: number;
  correctCount: number;
  accuracy: number;
  durationMs?: number;
  createdAt: number;
  manifestId?: string;
  questionSetId?: string;
  essayEntryMode?: EssayQuestionSetMode;
  essayTopic?: string;
  essayType?: EssayMockType;
  essayPurpose?: 'mock';
}

export interface ExamStats {
  total: number;
  averageAccuracy: number;
  bestAccuracy: number;
  latest?: ExamHistoryItem;
}

export interface ExamDashboard {
  projectName: string;
  defaultQuestionCount: number;
  schemes: ExamScheme[];
  focusTags: string[];
  history: ExamHistoryItem[];
  stats: ExamStats;
}

const XC_MODULES = ['资料分析', '判断推理', '言语理解', '数量关系', '常识判断'];
const FOCUS_TAGS = ['近5年真题', '高频考点', '易错题型', '时政热点', '新题型预测', '基础巩固', '拔高难题'];
const SCHEMES: ExamScheme[] = [
  { label: '国考标准', count: 135, durationMinutes: 120 },
  { label: '省考标准', count: 120, durationMinutes: 120 },
  { label: '精简版', count: 60, durationMinutes: 60 }
];

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function normalizeSubject(value?: string): ExamSubject {
  return value === '申论' ? '申论' : '行测';
}

function normalizeDate(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today();
}

function normalizePositiveNumber(value: string | number | null | undefined, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function normalizeTags(value: string | null | undefined): string[] {
  return (value || '高频考点,近5年真题')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function statsFrom(history: ExamHistoryItem[]): ExamStats {
  const accuracies = history.map((item) => item.accuracy).filter((value) => Number.isFinite(value));
  return {
    total: history.length,
    averageAccuracy: accuracies.length ? Math.round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length) : 0,
    bestAccuracy: accuracies.length ? Math.max(...accuracies) : 0,
    latest: history[0]
  };
}

export class ExamFlowService {
  readContext(): ExamStartContext {
    const subject = normalizeSubject(localStorage.getItem('exam-subject') || '行测');
    const questionCount = normalizePositiveNumber(localStorage.getItem('exam-question-count'), 120);
    return {
      subject,
      date: normalizeDate(localStorage.getItem('exam-date')),
      questionCount,
      durationMinutes: normalizePositiveNumber(localStorage.getItem('exam-duration-minutes'), questionCount <= 60 ? 60 : 120),
      tags: normalizeTags(localStorage.getItem('exam-focus-tags')),
      essayType: localStorage.getItem('exam-essay-type') === 'long' ? 'long' : 'short'
    };
  }

  writeContext(patch: Partial<ExamStartContext>): ExamStartContext {
    const raw = { ...this.readContext(), ...patch };
    const next: ExamStartContext = {
      ...raw,
      subject: normalizeSubject(raw.subject),
      date: normalizeDate(raw.date),
      questionCount: normalizePositiveNumber(raw.questionCount, 120),
      durationMinutes: normalizePositiveNumber(raw.durationMinutes, 120),
      tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : normalizeTags(undefined),
      essayType: raw.essayType === 'long' ? 'long' : 'short'
    };
    localStorage.setItem('exam-subject', next.subject);
    localStorage.setItem('exam-date', next.date);
    localStorage.setItem('exam-question-count', String(next.questionCount));
    localStorage.setItem('exam-duration-minutes', String(next.durationMinutes));
    localStorage.setItem('exam-focus-tags', next.tags.join(','));
    localStorage.setItem('exam-essay-type', next.essayType);
    return next;
  }

  async dashboard(subject: ExamSubject): Promise<ExamDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const [assets, essayMockTotal] = subject === '行测'
      ? await runtime.learningAssetStore.list({
        examCycleId: cycle.examCycle.id,
        kinds: [LearningAssetKind.MockManifest],
        status: LearningAssetStatus.Ready,
        limit: 100
      }).then((items) => [items, 0] as const)
      : await Promise.all([
        listEssayMockAssets(runtime, cycle.examCycle.id, 0, 30),
        countEssayMockAssets(runtime, cycle.examCycle.id)
      ]);
    const recentSessions = subject === '行测'
      ? await runtime.learningSessionRepository.listRecent(cycle.examCycle.id, 500)
      : [];
    const history = assets
      .map((asset): ExamHistoryItem | undefined => {
        if (subject === '申论') return essayMockHistoryItem(asset);
        const sections = Array.isArray(asset.payload.sections) ? asset.payload.sections : [];
        const setIds = new Set(sections.flatMap((item) => {
          const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
          return typeof record.questionSetId === 'string' ? [record.questionSetId] : [];
        }));
        const completed = recentSessions.filter((session) => setIds.has(session.session.questionSetId));
        const attempts = completed.flatMap((session) => session.attempts);
        const correctCount = attempts.filter((attempt) => attempt.result === 'correct').length;
        const questionCount = typeof asset.payload.actualCount === 'number' ? asset.payload.actualCount : sections.length;
        return {
          id: asset.id,
          manifestId: asset.id,
          subject,
          date: typeof asset.payload.date === 'string' ? asset.payload.date : new Date(asset.createdAt).toISOString().slice(0, 10),
          title: asset.title,
          questionCount,
          correctCount,
          accuracy: attempts.length ? Math.round((correctCount / attempts.length) * 100) : 0,
          durationMs: completed.reduce((sum, session) => sum + (session.session.elapsedMs || 0), 0) || undefined,
          createdAt: asset.createdAt
        };
      })
      .filter((item): item is ExamHistoryItem => Boolean(item))
      .slice(0, 30);

    return {
      projectName: cycle.project.name,
      defaultQuestionCount: 120,
      schemes: SCHEMES,
      focusTags: FOCUS_TAGS,
      history,
      stats: subject === '申论'
        ? { ...statsFrom(history), total: essayMockTotal }
        : statsFrom(history)
    };
  }

  async listEssayMockHistory(offset: number, limit: number): Promise<ExamHistoryItem[]> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const assets = await listEssayMockAssets(runtime, cycle.examCycle.id, offset, limit);
    return assets.map(essayMockHistoryItem);
  }

  async startMock(context: ExamStartContext, idempotencyKey?: string): Promise<AgentTaskEnqueueResult> {
    const normalized = this.writeContext(context);
    if (normalized.subject === '行测') {
      const result = await generationTaskService.enqueue({
        idempotencyKey,
        intent: 'mock',
        title: '行测模考',
        detail: `${normalized.questionCount} 题 · ${normalized.durationMinutes} 分钟`,
        module: '行测',
        sourceId: `mock:行测:${normalized.date}:${normalized.questionCount}`,
        payload: {
          subject: '行测',
          modules: XC_MODULES,
          date: normalized.date,
          questionCount: normalized.questionCount,
          durationMinutes: normalized.durationMinutes,
          focusTags: normalized.tags
        }
      });
      return result;
    }

    const topic = normalized.essayType === 'long' ? '申发论述' : '申论小题';
    return essayFlowService.enqueueQuestionGeneration({
      date: normalized.date,
      topic,
      type: normalized.essayType,
      entryMode: 'self',
      purpose: 'mock'
    }, { questionCount: 1, title: '申论模考', idempotencyKey });
  }

}

export const examFlowService = new ExamFlowService();

async function listEssayMockAssets(
  runtime: Awaited<ReturnType<typeof initializeTutorRuntime>>,
  examCycleId: Parameters<typeof runtime.learningAssetStore.list>[0]['examCycleId'],
  offset: number,
  limit: number
) {
  return runtime.learningAssetStore.list({
    examCycleId,
    kinds: [LearningAssetKind.EssayQuestion],
    status: LearningAssetStatus.Ready,
    purposes: [LearningAssetPurpose.Mock],
    latestPerBusinessKey: true,
    offset,
    limit
  });
}

export function isEssayMockAsset(asset: LearningAssetRecord): boolean {
  return asset.purpose === LearningAssetPurpose.Mock;
}

function countEssayMockAssets(
  runtime: Awaited<ReturnType<typeof initializeTutorRuntime>>,
  examCycleId: Parameters<typeof runtime.learningAssetStore.list>[0]['examCycleId']
): Promise<number> {
  return runtime.learningAssetStore.count({
    examCycleId,
    kinds: [LearningAssetKind.EssayQuestion],
    status: LearningAssetStatus.Ready,
    purposes: [LearningAssetPurpose.Mock],
    latestPerBusinessKey: true
  });
}

function essayMockHistoryItem(asset: LearningAssetRecord): ExamHistoryItem {
  const rawContext = asset.payload.essayContext;
  const essayContext = rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
    ? rawContext as Record<string, unknown>
    : {};
  return {
    id: asset.id,
    subject: '申论',
    date: typeof essayContext.date === 'string'
      ? essayContext.date
      : new Date(asset.createdAt).toISOString().slice(0, 10),
    title: asset.title,
    questionSetId: asset.businessKey,
    essayEntryMode: normalizeEssayQuestionSetMode(essayContext.entryMode),
    essayTopic: typeof essayContext.topic === 'string' ? essayContext.topic : asset.title,
    essayType: essayContext.type === 'long' ? 'long' : 'short',
    essayPurpose: 'mock',
    questionCount: 1,
    correctCount: 0,
    accuracy: 0,
    createdAt: asset.createdAt
  };
}
