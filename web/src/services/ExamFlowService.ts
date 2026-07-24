import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { PracticeSession } from '@/domain/practice';
import { projectRepository } from './ProjectRepository';
import { planService } from './PlanService';
import { generationTaskService } from './GenerationTaskService';
import { practiceFlowService } from './PracticeFlowService';
import { essayFlowService } from './EssayFlowService';
import type { EnqueueResult } from '@/tasks/taskTypes';

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
    const subject = normalizeSubject(localStorage.getItem('exam-subject') || localStorage.getItem('mp-target-module') || '行测');
    const questionCount = normalizePositiveNumber(localStorage.getItem('exam-question-count'), 120);
    return {
      subject,
      date: normalizeDate(localStorage.getItem('mp-practice-date') || localStorage.getItem('es-date')),
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
    localStorage.setItem('mp-practice-date', next.date);
    localStorage.setItem('exam-question-count', String(next.questionCount));
    localStorage.setItem('exam-duration-minutes', String(next.durationMinutes));
    localStorage.setItem('exam-focus-tags', next.tags.join(','));
    localStorage.setItem('exam-essay-type', next.essayType);
    return next;
  }

  async dashboard(subject: ExamSubject): Promise<ExamDashboard> {
    const project = await projectRepository.getActiveProject();
    const plan = await planService.getPlan(project.id);
    const defaultQuestionCount = Number(plan?.mock_exam_count || plan?.business_model?.question_count || 120);
    const sessions = await database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectId', project.id);
    const history = sessions
      .filter((session) => session.mode === 'mock' && normalizeSubject(session.module) === subject)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map((session) => ({
        id: session.id,
        subject,
        date: session.date,
        title: `${subject}模考 · ${session.date}`,
        questionCount: session.questionCount,
        correctCount: session.correctCount,
        accuracy: session.accuracy,
        durationMs: session.durationMs,
        createdAt: session.createdAt
      }));

    return {
      projectName: project.name,
      defaultQuestionCount,
      schemes: SCHEMES,
      focusTags: FOCUS_TAGS,
      history,
      stats: statsFrom(history)
    };
  }

  async startMock(context: ExamStartContext): Promise<EnqueueResult> {
    const normalized = this.writeContext(context);
    if (normalized.subject === '行测') {
      const practiceContext = practiceFlowService.writeStartContext({
        module: '行测',
        date: normalized.date,
        mode: 'mock',
        source: 'practice-center',
        questionCount: normalized.questionCount
      });
      const result = await generationTaskService.enqueue({
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
      practiceFlowService.writeStartContext({ ...practiceContext, sourceRef: result.task.id });
      return result;
    }

    const topic = normalized.essayType === 'long' ? '申发论述' : '申论小题';
    essayFlowService.writeContext({
      date: normalized.date,
      topic,
      type: normalized.essayType
    });
    return generationTaskService.enqueue({
      intent: 'mock',
      title: '申论模考',
      detail: `${topic} · ${normalized.date}`,
      module: '申论',
      sourceId: `mock:申论:${normalized.date}:${normalized.essayType}`,
      payload: {
        subject: '申论',
        date: normalized.date,
        essayTopic: topic,
        essayType: normalized.essayType
      }
    });
  }

  openHistoryItem(item: ExamHistoryItem): void {
    practiceFlowService.writeStartContext({
      module: item.subject,
      date: item.date,
      mode: 'mock',
      source: 'practice-center',
      questionCount: item.questionCount
    });
  }
}

export const examFlowService = new ExamFlowService();
