import { initializeTutorRuntime } from '@/composition-root/public';
import type { SubjectCode } from '@/kernel/public';
import type { EssayMockType, ExamStartContext } from '@/domain/examMock';
import { ExamDeliveryKind, GetExamSubjects, type ExamSubjectView } from '@/modules/curriculum/public';
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

export type { EssayMockType, ExamStartContext } from '@/domain/examMock';

export interface ExamHistoryItem {
  readonly id: string;
  readonly subjectCode: SubjectCode;
  readonly date: string;
  readonly title: string;
  readonly questionCount: number;
  readonly correctCount: number;
  readonly accuracy: number;
  readonly durationMs?: number;
  readonly createdAt: number;
  readonly manifestId?: string;
  readonly questionSetId?: string;
  readonly essayEntryMode?: EssayQuestionSetMode;
  readonly essayTopic?: string;
  readonly essayType?: EssayMockType;
  readonly essayPurpose?: 'mock';
}

export interface ExamStats {
  readonly total: number;
  readonly averageAccuracy: number;
  readonly bestAccuracy: number;
  readonly latest?: ExamHistoryItem;
}

export interface ExamDashboard {
  readonly projectName: string;
  /** Subjects the installed curriculum package offers a mock exam for. */
  readonly subjects: readonly ExamSubjectView[];
  readonly subject: ExamSubjectView;
  readonly history: readonly ExamHistoryItem[];
  readonly stats: ExamStats;
}

/**
 * Storage keys owned by this flow. `exam-subject-code` replaced the earlier
 * `exam-subject` key because the stored value changed from a display name to a
 * curriculum subject code; a stale name simply resolves to no subject.
 */
const PreferenceKey = {
  SubjectCode: 'exam-subject-code',
  Date: 'exam-date',
  QuestionCount: 'exam-question-count',
  DurationMinutes: 'exam-duration-minutes',
  FocusTags: 'exam-focus-tags',
  EssayType: 'exam-essay-type'
} as const;

const ESSAY_LONG_TOPIC = '申发论述';
const ESSAY_SHORT_TOPIC = '申论小题';

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function normalizeDate(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today();
}

function normalizePositiveNumber(value: string | number | null | undefined, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function normalizeTags(value: string | null | undefined, allowed: readonly string[]): readonly string[] {
  const stored = (value || '').split(',').map((item) => item.trim()).filter(Boolean);
  const selected = stored.filter((item) => allowed.includes(item));
  return selected.length ? selected : allowed.slice(0, 2);
}

function statsFrom(history: readonly ExamHistoryItem[]): ExamStats {
  const accuracies = history.map((item) => item.accuracy).filter((value) => Number.isFinite(value));
  return {
    total: history.length,
    averageAccuracy: accuracies.length ? Math.round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length) : 0,
    bestAccuracy: accuracies.length ? Math.max(...accuracies) : 0,
    latest: history[0]
  };
}

function essayMockStats(total: number, history: readonly ExamHistoryItem[]): ExamStats {
  // Essay mock question assets are not scored records yet. Keep the aggregate
  // explicitly unscored instead of deriving misleading values from page one.
  return {
    total,
    averageAccuracy: 0,
    bestAccuracy: 0,
    latest: history[0]
  };
}

export class ExamFlowService {
  /** Subjects the installed curriculum package offers a mock exam for, in package order. */
  async listMockSubjects(): Promise<readonly ExamSubjectView[]> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    return mockSubjectsOf(runtime, cycle.examCycle.curriculumVersionId);
  }

  /** First mock-capable subject answered the given way. Used by agent tools that ask for a kind, not a name. */
  async findMockSubject(deliveryKind: ExamDeliveryKind): Promise<ExamSubjectView> {
    const subjects = await this.listMockSubjects();
    const subject = subjects.find((item) => item.deliveryKind === deliveryKind);
    if (!subject) throw new Error('当前考试大纲没有可用的模考科目。');
    return subject;
  }

  readContext(subject: ExamSubjectView): ExamStartContext {
    const mockExam = subject.mockExam;
    const defaultQuestionCount = mockExam?.defaultQuestionCount ?? 1;
    const questionCount = normalizePositiveNumber(localStorage.getItem(PreferenceKey.QuestionCount), defaultQuestionCount);
    return {
      subjectCode: subject.code,
      date: normalizeDate(localStorage.getItem(PreferenceKey.Date)),
      questionCount,
      durationMinutes: normalizePositiveNumber(
        localStorage.getItem(PreferenceKey.DurationMinutes),
        mockExam?.defaultDurationMinutes ?? 120
      ),
      tags: normalizeTags(localStorage.getItem(PreferenceKey.FocusTags), mockExam?.focusTags ?? []),
      essayType: localStorage.getItem(PreferenceKey.EssayType) === 'long' ? 'long' : 'short'
    };
  }

  writeContext(context: ExamStartContext): void {
    localStorage.setItem(PreferenceKey.SubjectCode, context.subjectCode);
    localStorage.setItem(PreferenceKey.Date, context.date);
    localStorage.setItem(PreferenceKey.QuestionCount, String(context.questionCount));
    localStorage.setItem(PreferenceKey.DurationMinutes, String(context.durationMinutes));
    localStorage.setItem(PreferenceKey.FocusTags, context.tags.join(','));
    localStorage.setItem(PreferenceKey.EssayType, context.essayType);
  }

  /** Subject to open on entry: the last one used, else the first the package offers. */
  selectInitialSubject(subjects: readonly ExamSubjectView[]): ExamSubjectView | undefined {
    const stored = localStorage.getItem(PreferenceKey.SubjectCode);
    return subjects.find((subject) => subject.code === stored) ?? subjects[0];
  }

  async dashboard(subjectCode?: SubjectCode): Promise<ExamDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const subjects = await mockSubjectsOf(runtime, cycle.examCycle.curriculumVersionId);
    const subject = subjects.find((item) => item.code === subjectCode) ?? this.selectInitialSubject(subjects);
    if (!subject) throw new Error('当前考试大纲没有可用的模考科目。');

    const isObjective = subject.deliveryKind === ExamDeliveryKind.Objective;
    const [assets, essayMockTotal] = isObjective
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
    const recentSessions = isObjective
      ? await runtime.learningSessionRepository.listRecent(cycle.examCycle.id, 500)
      : [];
    const history = assets
      .map((asset): ExamHistoryItem | undefined => {
        if (!isObjective) return essayMockHistoryItem(asset, subject.code);
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
          subjectCode: subject.code,
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
      subjects,
      subject,
      history,
      stats: isObjective ? statsFrom(history) : essayMockStats(essayMockTotal, history)
    };
  }

  async listEssayMockHistory(subjectCode: SubjectCode, offset: number, limit: number): Promise<readonly ExamHistoryItem[]> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const assets = await listEssayMockAssets(runtime, cycle.examCycle.id, offset, limit);
    return assets.map((asset) => essayMockHistoryItem(asset, subjectCode));
  }

  async startMock(context: ExamStartContext, idempotencyKey?: string): Promise<AgentTaskEnqueueResult> {
    const subjects = await this.listMockSubjects();
    const subject = subjects.find((item) => item.code === context.subjectCode);
    if (!subject) throw new Error('所选科目不在当前考试大纲中。');
    this.writeContext(context);

    if (subject.deliveryKind === ExamDeliveryKind.Objective) {
      return generationTaskService.enqueue({
        idempotencyKey,
        intent: 'mock',
        title: `${subject.name}模考`,
        detail: `${context.questionCount} 题 · ${context.durationMinutes} 分钟`,
        module: subject.name,
        sourceId: `mock:${subject.code}:${context.date}:${context.questionCount}`,
        payload: {
          subjectCode: subject.code,
          subjectName: subject.name,
          deliveryKind: subject.deliveryKind,
          modules: subject.modules.map((item) => item.name),
          date: context.date,
          questionCount: context.questionCount,
          durationMinutes: context.durationMinutes,
          focusTags: [...context.tags]
        }
      });
    }

    // Subjective mock exams are currently backed by essay assets. A second
    // subjective mock subject would move this mapping into the delivery policy.
    const topic = context.essayType === 'long' ? ESSAY_LONG_TOPIC : ESSAY_SHORT_TOPIC;
    return essayFlowService.enqueueQuestionGeneration({
      date: context.date,
      topic,
      type: context.essayType,
      entryMode: 'self',
      purpose: 'mock'
    }, { questionCount: 1, title: `${subject.name}模考`, idempotencyKey });
  }
}

export const examFlowService = new ExamFlowService();

/**
 * Built per call rather than held in the runtime: it is a stateless projection
 * over `curriculumRepository`, which the runtime already publishes.
 */
async function mockSubjectsOf(
  runtime: Awaited<ReturnType<typeof initializeTutorRuntime>>,
  curriculumVersionId: Parameters<GetExamSubjects['execute']>[0]
): Promise<readonly ExamSubjectView[]> {
  const subjects = await new GetExamSubjects(runtime.curriculumRepository).execute(curriculumVersionId);
  return subjects.filter((subject) => subject.mockExam !== undefined);
}

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

function essayMockHistoryItem(asset: LearningAssetRecord, subjectCode: SubjectCode): ExamHistoryItem {
  const rawContext = asset.payload.essayContext;
  const essayContext = rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
    ? rawContext as Record<string, unknown>
    : {};
  return {
    id: asset.id,
    subjectCode,
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
