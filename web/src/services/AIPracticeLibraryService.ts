import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { TaskTargetType } from '@/modules/agent/public';
import {
  QuestionSetEntryMode,
  contentDocumentText,
  type QuestionSetEntryModeCode,
  type QuestionSetLibraryEntry
} from '@/modules/content/public';

export type PracticeLibraryScope = 'today' | 'recent' | 'active' | 'all';
export type PracticeLibraryEntryMode = QuestionSetEntryModeCode | 'all';
export type PracticeQuestionSetSection = 'overview' | 'questions' | 'lecture';

export interface PracticeLibraryQuery {
  readonly scope: PracticeLibraryScope;
  readonly entryMode?: PracticeLibraryEntryMode;
  readonly module?: string;
  readonly capabilityKeyword?: string;
  readonly limit?: number;
}

export interface PracticeLibrarySnapshot {
  readonly scope: PracticeLibraryScope;
  readonly entryMode: PracticeLibraryEntryMode;
  readonly librarySetCount: number;
  readonly libraryQuestionCount: number;
  readonly readySetCount: number;
  readonly readyQuestionCount: number;
  readonly activeTaskCount: number;
  readonly availableOutsideScope: boolean;
  readonly isLibraryScanTruncated: boolean;
  readonly sets: readonly {
    readonly questionSetId: string;
    readonly learningThreadId?: string;
    readonly capabilityName: string;
    readonly module: string;
    readonly entryMode: QuestionSetEntryModeCode;
    readonly source?: string;
    readonly questionCount: number;
    readonly createdAt: number;
  }[];
  readonly activeTasks: readonly {
    readonly taskId: string;
    readonly title: string;
    readonly detail: string;
    readonly status: string;
    readonly statusText: string;
    readonly updatedAt: number;
  }[];
}

/**
 * Read-only Agent projection. Library search reads lightweight metadata; body content is loaded
 * only after the model selects one questionSetId through readQuestionSet().
 */
export class AIPracticeLibraryService {
  async read(runtime: TutorDatabaseRuntime, query: PracticeLibraryQuery): Promise<PracticeLibrarySnapshot> {
    const scope = normalizeScope(query.scope);
    const entryMode = normalizeEntryMode(query.entryMode);
    const limit = normalizeLimit(query.limit);
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');

    const needsLibrary = scope !== 'active';
    const [library, recentRuns, curriculum] = await Promise.all([
      needsLibrary
        ? runtime.contentRepository.listQuestionSetLibrary(cycle.examCycle.id, 100)
        : Promise.resolve([] as readonly QuestionSetLibraryEntry[]),
      runtime.getAgentRunViews.execute({ limit: 50 }),
      needsLibrary
        ? runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId)
        : Promise.resolve(undefined)
    ]);
    const capabilityNames = new Map(
      (curriculum?.capabilityNodes || []).map((node) => [node.id, node.name])
    );
    const dayStart = startOfLocalDay(Date.now());
    const recentStart = dayStart - 6 * 86_400_000;
    const moduleFilter = cleanFilter(query.module);
    const capabilityFilter = cleanFilter(query.capabilityKeyword);
    const entryModeSets = library
      .filter((item) => entryMode === 'all' || item.entryMode === entryMode)
      .filter((item) => !moduleFilter || item.module.toLowerCase().includes(moduleFilter))
      .filter((item) => {
        if (!capabilityFilter) return true;
        const capabilityName = capabilityNames.get(item.capabilityNodeId) || '';
        return capabilityName.toLowerCase().includes(capabilityFilter);
      });
    const matchingSets = entryModeSets
      .filter((item) => scope !== 'today' || item.createdAt >= dayStart)
      .filter((item) => scope !== 'recent' || item.createdAt >= recentStart);
    const activeTasks = recentRuns
      .filter((run) => run.targetResourceType === TaskTargetType.StructuredPractice && run.isActive)
      .filter((run) => entryMode === 'all' || taskEntryMode(run.scopeKey, run.actionParams.mode) === entryMode)
      .slice(0, limit)
      .map((run) => ({
        taskId: run.id,
        title: run.title,
        detail: run.detail,
        status: run.status,
        statusText: run.statusText,
        updatedAt: run.updatedAt
      }));

    return {
      scope,
      entryMode,
      librarySetCount: entryModeSets.length,
      libraryQuestionCount: sumQuestions(entryModeSets),
      readySetCount: matchingSets.length,
      readyQuestionCount: sumQuestions(matchingSets),
      activeTaskCount: activeTasks.length,
      availableOutsideScope: matchingSets.length === 0 && entryModeSets.length > 0,
      isLibraryScanTruncated: library.length === 100,
      sets: matchingSets.slice(0, limit).map((item) => ({
        questionSetId: item.id,
        learningThreadId: item.learningThreadId,
        capabilityName: capabilityNames.get(item.capabilityNodeId) || '未命名知识点',
        module: item.module,
        entryMode: item.entryMode,
        source: item.source,
        questionCount: item.questionCount,
        createdAt: item.createdAt
      })),
      activeTasks
    };
  }

  async readQuestionSet(
    runtime: TutorDatabaseRuntime,
    query: {
      readonly questionSetId: string;
      readonly section: PracticeQuestionSetSection;
      readonly offset?: number;
      readonly limit?: number;
    }
  ): Promise<Record<string, unknown>> {
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const bundle = await runtime.contentRepository.findQuestionSet(
      query.questionSetId as Parameters<TutorDatabaseRuntime['contentRepository']['findQuestionSet']>[0]
    );
    if (!bundle || bundle.questionSet.examCycleId !== cycle.examCycle.id) {
      throw new Error('当前备考档案中没有找到该题组。');
    }
    const [curriculum, sessions] = await Promise.all([
      runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      runtime.learningSessionRepository.listByQuestionSet(bundle.questionSet.id, 5)
    ]);
    const capability = curriculum?.capabilityNodes.find((node) => (
      node.id === bundle.questionSet.capabilityNodeId
    ));
    const overview = {
      questionSetId: bundle.questionSet.id,
      learningThreadId: bundle.questionSet.learningThreadId ?? null,
      capabilityName: capability?.name || '未命名知识点',
      module: bundle.questionSet.module,
      purpose: bundle.questionSet.purpose,
      assessmentRole: bundle.questionSet.assessmentRole,
      entryMode: entryModeOf(bundle.generationSpec.constraints),
      questionCount: bundle.questionSet.questionCount,
      createdAt: bundle.questionSet.createdAt,
      recentSessions: sessions.map((facts) => ({
        sessionId: facts.session.id,
        status: facts.session.status,
        completedAt: facts.session.completedAt,
        answeredCount: facts.session.answeredCount,
        correctCount: facts.session.correctCount,
        questionCount: facts.session.questionCount
      }))
    };
    if (query.section === 'overview') return { section: query.section, overview };
    if (query.section === 'lecture') {
      const documents = new Map(bundle.documents.map((document) => [document.id, document]));
      return {
        section: query.section,
        overview,
        lectures: bundle.lectures.map((lecture) => ({
          lectureId: lecture.id,
          objective: lecture.objective,
          title: documents.get(lecture.contentDocumentId)?.title || null,
          content: documents.get(lecture.contentDocumentId)
            ? contentDocumentText(documents.get(lecture.contentDocumentId)!.content).slice(0, 8_000)
            : ''
        }))
      };
    }
    const offset = normalizeOffset(query.offset);
    const limit = normalizeQuestionLimit(query.limit);
    const questions = bundle.questions.slice(offset, offset + limit);
    return {
      section: query.section,
      overview,
      offset,
      returnedCount: questions.length,
      hasMore: offset + questions.length < bundle.questions.length,
      questions: questions.map((question) => ({
        questionId: question.id,
        sequence: question.sequence,
        difficulty: question.difficulty,
        cognitiveLevel: question.cognitiveLevel,
        material: question.content.material ? contentDocumentText(question.content.material) : null,
        prompt: contentDocumentText(question.content.prompt),
        options: question.content.options.map((option) => ({
          id: option.id,
          content: contentDocumentText(option.content)
        }))
      }))
    };
  }
}

function normalizeScope(value: unknown): PracticeLibraryScope {
  if (value === 'today' || value === 'recent' || value === 'active' || value === 'all') return value;
  throw new Error('题库查询范围必须明确为 today、recent、active 或 all。');
}

function normalizeEntryMode(value: unknown): PracticeLibraryEntryMode {
  if (value === QuestionSetEntryMode.Tutor || value === QuestionSetEntryMode.Self) return value;
  return 'all';
}

function normalizeLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? Math.round(value) : 5;
  return Math.max(1, Math.min(10, Number.isFinite(numeric) ? numeric : 5));
}

function normalizeOffset(value: unknown): number {
  const numeric = typeof value === 'number' ? Math.round(value) : 0;
  return Math.max(0, Number.isFinite(numeric) ? numeric : 0);
}

function normalizeQuestionLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? Math.round(value) : 3;
  return Math.max(1, Math.min(5, Number.isFinite(numeric) ? numeric : 3));
}

function cleanFilter(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function entryModeOf(constraints: Readonly<Record<string, unknown>>): QuestionSetEntryModeCode {
  if (constraints.entryMode === QuestionSetEntryMode.Self) return QuestionSetEntryMode.Self;
  if (constraints.entryMode === QuestionSetEntryMode.Tutor) return QuestionSetEntryMode.Tutor;
  return constraints.source === 'custom' ? QuestionSetEntryMode.Self : QuestionSetEntryMode.Tutor;
}

function taskEntryMode(scopeKey: string | undefined, explicit: unknown): QuestionSetEntryModeCode {
  if (explicit === QuestionSetEntryMode.Tutor) return QuestionSetEntryMode.Tutor;
  if (explicit === QuestionSetEntryMode.Self) return QuestionSetEntryMode.Self;
  return scopeKey?.startsWith('practice:tutor:')
    ? QuestionSetEntryMode.Tutor
    : QuestionSetEntryMode.Self;
}

function sumQuestions(values: readonly QuestionSetLibraryEntry[]): number {
  return values.reduce((total, item) => total + item.questionCount, 0);
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
