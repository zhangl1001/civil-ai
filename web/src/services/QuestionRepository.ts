import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { Question as StoredQuestion } from '@/domain/question';
import type { QuestionContentKind, QuestionRenderTemplate } from '@/domain/question';
import { normalizeQuestionTextBlock, resolveQuestionContentKind, resolveQuestionRenderTemplate } from '@/domain/questionPresentation';
import type { AnswerRecord, PracticeSession } from '@/domain/practice';
import type { LocalTask, TaskLog } from '@/domain/task';
import type { WrongItem } from '@/domain/wrongbook';
import { projectRepository } from '@/services/ProjectRepository';

export interface PracticeQuestion {
  id: string;
  module: string;
  knowledgePoint?: string;
  type: StoredQuestion['type'];
  contentKind: QuestionContentKind;
  renderTemplate: QuestionRenderTemplate;
  material?: string;
  groupId?: string;
  subQuestionIndex?: number;
  subQuestionCount?: number;
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  lectureId?: string;
  sourceFile?: string;
  sourceDate?: string;
}

export interface PracticeLecture {
  id: string;
  projectId: string;
  module: string;
  knowledgePoint?: string;
  title: string;
  summary: string;
  methods: string[];
  traps: string[];
  steps: string[];
  reviewFocus: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PracticeLectureInput {
  module?: string;
  knowledgePoint?: string;
  title?: string;
  summary?: string;
  methods?: string[];
  traps?: string[];
  steps?: string[];
  reviewFocus?: string[];
}

export interface GeneratedQuestionBatch {
  id: string;
  sourceRef: string;
  module: string;
  knowledgePoint?: string;
  questionCount: number;
  createdAt: number;
  updatedAt: number;
}

interface ListQuestionOptions {
  module?: string;
  knowledgePoint?: string;
  limit?: number;
  sourceRef?: string;
}

function answerToIndex(answer: string | string[]): number {
  const value = Array.isArray(answer) ? answer[0] : answer;
  if (/^\d+$/.test(value)) return Number(value);
  const letter = value.trim().toUpperCase().charCodeAt(0);
  return letter >= 65 && letter <= 90 ? letter - 65 : -1;
}

function toPracticeQuestion(question: StoredQuestion): PracticeQuestion | null {
  const answer = answerToIndex(question.answer);
  if (answer < 0 || !question.options.length) return null;
  const material = normalizeQuestionTextBlock((question as StoredQuestion & { material?: unknown }).material);
  const stem = normalizeQuestionTextBlock((question as StoredQuestion & { stem?: unknown }).stem);
  const options = question.options.map((option) => normalizeQuestionTextBlock(option));
  const presentation = {
    module: question.module,
    knowledgePoint: question.knowledgePoint,
    stem,
    options,
    contentKind: question.contentKind,
    renderTemplate: question.renderTemplate,
    material,
    groupId: question.groupId,
    subQuestionCount: question.subQuestionCount
  };
  return {
    id: question.id,
    module: question.module,
    knowledgePoint: question.knowledgePoint,
    type: question.type,
    contentKind: resolveQuestionContentKind(presentation),
    renderTemplate: resolveQuestionRenderTemplate(presentation),
    material: material || undefined,
    groupId: question.groupId,
    subQuestionIndex: question.subQuestionIndex,
    subQuestionCount: question.subQuestionCount,
    stem,
    options,
    answer,
    explanation: question.explanation || '暂无解析',
    lectureId: question.lectureId,
    sourceFile: question.sourceFile,
    sourceDate: question.sourceDate
  };
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function selectPracticeQuestions(questions: PracticeQuestion[], limit: number): PracticeQuestion[] {
  const units: PracticeQuestion[][] = [];
  const sharedGroups = new Map<string, PracticeQuestion[]>();

  questions.forEach((question) => {
    if (question.contentKind === 'shared_material' && question.groupId) {
      const group = sharedGroups.get(question.groupId);
      if (group) group.push(question);
      else {
        const nextGroup = [question];
        sharedGroups.set(question.groupId, nextGroup);
        units.push(nextGroup);
      }
      return;
    }
    units.push([question]);
  });

  units.forEach((unit) => unit.sort((left, right) => (left.subQuestionIndex || 0) - (right.subQuestionIndex || 0)));
  const selected: PracticeQuestion[] = [];
  for (const unit of shuffle(units)) {
    if (selected.length >= limit) break;
    if (unit.length > 1 && selected.length > 0 && selected.length + unit.length > limit) continue;
    selected.push(...unit);
  }
  return selected.slice(0, Math.max(limit, selected[0]?.subQuestionCount || 0));
}

function dominantKnowledgePoint(questions: PracticeQuestion[]): string | undefined {
  const counts = new Map<string, number>();
  questions.forEach((question) => {
    if (!question.knowledgePoint) return;
    counts.set(question.knowledgePoint, (counts.get(question.knowledgePoint) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export class QuestionRepository {
  private devSeedPurged = false;

  async getById(questionId: string): Promise<PracticeQuestion | undefined> {
    const row = await database.get<StoredQuestion>(STORES.questions, questionId);
    return row ? toPracticeQuestion(row) || undefined : undefined;
  }

  async listByIds(questionIds: string[]): Promise<PracticeQuestion[]> {
    if (!questionIds.length) return [];
    const questions = await Promise.all(questionIds.map((questionId) => this.getById(questionId)));
    return questions.filter((question): question is PracticeQuestion => Boolean(question));
  }

  async countBySource(projectId: string): Promise<Map<string, number>> {
    const rows = await database.queryByIndex<StoredQuestion>(STORES.questions, 'projectId', projectId);
    const counts = new Map<string, number>();
    rows.forEach((question) => {
      if (!question.sourceFile) return;
      counts.set(question.sourceFile, (counts.get(question.sourceFile) || 0) + 1);
    });
    return counts;
  }

  async listForPractice(options: ListQuestionOptions = {}): Promise<PracticeQuestion[]> {
    const project = await projectRepository.getActiveProject();
    await this.purgeDevSeed(project.id);

    const rows = options.sourceRef
      ? await database.queryByIndex<StoredQuestion>(STORES.questions, 'projectSource', [project.id, options.sourceRef])
      : options.module
      ? await database.queryByIndex<StoredQuestion>(STORES.questions, 'projectModule', [project.id, options.module])
      : await database.queryByIndex<StoredQuestion>(STORES.questions, 'projectId', project.id);

    const questions = rows
      .map(toPracticeQuestion)
      .filter((question): question is PracticeQuestion => Boolean(question))
      .filter((question) => !options.knowledgePoint || question.stem.includes(options.knowledgePoint) || (question.material || '').includes(options.knowledgePoint) || question.explanation.includes(options.knowledgePoint));

    return selectPracticeQuestions(questions, options.limit || 10);
  }

  async saveGenerated(projectId: string, questions: PracticeQuestion[], sourceRef?: string, lecture?: PracticeLectureInput): Promise<void> {
    const now = Date.now();
    const savedLecture = lecture ? await this.saveLecture(projectId, {
      module: lecture.module || questions[0]?.module,
      knowledgePoint: lecture.knowledgePoint || dominantKnowledgePoint(questions),
      title: lecture.title,
      summary: lecture.summary,
      methods: lecture.methods,
      traps: lecture.traps,
      steps: lecture.steps,
      reviewFocus: lecture.reviewFocus
    }) : undefined;
    await database.putMany<StoredQuestion>(STORES.questions, questions.map((question) => ({
      id: question.id,
      projectId,
      module: question.module,
      type: 'single',
      contentKind: resolveQuestionContentKind(question),
      renderTemplate: resolveQuestionRenderTemplate(question),
      material: normalizeQuestionTextBlock(question.material) || undefined,
      groupId: question.groupId,
      subQuestionIndex: question.subQuestionIndex,
      subQuestionCount: question.subQuestionCount,
      stem: normalizeQuestionTextBlock(question.stem),
      options: question.options.map((option) => normalizeQuestionTextBlock(option)),
      answer: String(question.answer),
      explanation: question.explanation,
      knowledgePoint: question.knowledgePoint,
      lectureId: savedLecture?.id || question.lectureId,
      sourceFile: sourceRef,
      createdAt: now,
      updatedAt: now
    })));
  }

  async saveLecture(projectId: string, input: PracticeLectureInput): Promise<PracticeLecture> {
    const module = input.module || '专项练习';
    const knowledgePoint = input.knowledgePoint || '';
    const id = `${projectId}:${module}:${knowledgePoint || 'general'}`;
    const current = await database.get<PracticeLecture>(STORES.practiceLectures, id);
    const now = Date.now();
    const lecture: PracticeLecture = {
      id,
      projectId,
      module,
      knowledgePoint: knowledgePoint || undefined,
      title: input.title || `${knowledgePoint || module}讲义`,
      summary: input.summary || `围绕${knowledgePoint || module}建立解题框架，再进入题目训练。`,
      methods: normalizeLectureList(input.methods, ['先识别题型和问法，再决定解法。', '把题干条件转成可检查的结构，避免凭感觉选。']),
      traps: normalizeLectureList(input.traps, ['警惕绝对化表述、偷换概念和范围变化。', '解析时回看错因，不只记正确答案。']),
      steps: normalizeLectureList(input.steps, ['读问法，标出目标。', '整理条件，排除明显错误选项。', '代入或推导，确认答案唯一。']),
      reviewFocus: normalizeLectureList(input.reviewFocus, ['记录错因和对应考点。']),
      createdAt: current?.createdAt || now,
      updatedAt: now
    };
    await database.put<PracticeLecture>(STORES.practiceLectures, lecture);
    return lecture;
  }

  async getLecture(lectureId?: string): Promise<PracticeLecture | undefined> {
    if (!lectureId) return undefined;
    return database.get<PracticeLecture>(STORES.practiceLectures, lectureId);
  }

  async lectureForQuestions(questions: PracticeQuestion[]): Promise<PracticeLecture | undefined> {
    const lectureId = questions.find((question) => question.lectureId)?.lectureId;
    if (lectureId) return this.getLecture(lectureId);
    return undefined;
  }

  async generatedBatches(module?: string, limit = 60): Promise<GeneratedQuestionBatch[]> {
    const project = await projectRepository.getActiveProject();
    const rows = await database.queryByIndex<StoredQuestion>(STORES.questions, 'projectId', project.id);
    const groups = new Map<string, StoredQuestion[]>();
    rows.forEach((question) => {
      if (!question.sourceFile || question.sourceFile === 'dev-seed') return;
      const key = question.sourceFile;
      groups.set(key, [...(groups.get(key) || []), question]);
    });

    return Array.from(groups.entries())
      .map(([sourceRef, items]) => {
        const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
        const moduleCounts = new Map<string, number>();
        sorted.forEach((question) => {
          moduleCounts.set(question.module, (moduleCounts.get(question.module) || 0) + 1);
        });
        const mainModule = Array.from(moduleCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '专项练习';
        return {
          id: sourceRef,
          sourceRef,
          module: mainModule,
          knowledgePoint: sorted.find((question) => question.knowledgePoint)?.knowledgePoint,
          questionCount: sorted.length,
          createdAt: sorted[0]?.createdAt || Date.now(),
          updatedAt: Math.max(...sorted.map((question) => question.updatedAt || question.createdAt))
        };
      })
      .filter((batch) => !module || batch.module === module)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  async discardGeneratedBatch(sourceRef?: string): Promise<{ questions: number; sessions: number }> {
    if (!sourceRef || sourceRef === 'dev-seed') return { questions: 0, sessions: 0 };
    const project = await projectRepository.getActiveProject();
    const questions = await database.queryByIndex<StoredQuestion>(STORES.questions, 'projectSource', [project.id, sourceRef]);
    if (!questions.length) return { questions: 0, sessions: 0 };
    const questionIds = new Set(questions.map((question) => question.id));
    const lectureIds = new Set(questions.map((question) => question.lectureId).filter((id): id is string => Boolean(id)));
    const sessions = (await database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectId', project.id))
      .filter((session) => session.sourceFile === sourceRef);
    const sessionIds = new Set(sessions.map((session) => session.id));
    const answers = (await database.list<AnswerRecord>(STORES.answers))
      .filter((answer) => sessionIds.has(answer.sessionId) || questionIds.has(answer.questionId));
    const wrongItems = (await database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id))
      .filter((item) => questionIds.has(item.questionId));
    const tasks = (await database.queryByIndex<LocalTask>(STORES.aiTasks, 'projectId', project.id))
      .filter((task) => task.id === sourceRef || task.payload?.sourceId === sourceRef);
    const taskIds = new Set(tasks.map((task) => task.id));
    const logs = (await database.list<TaskLog>(STORES.taskLogs))
      .filter((log) => taskIds.has(log.taskId));
    const sharedLectureIds = new Set((await database.queryByIndex<StoredQuestion>(STORES.questions, 'projectId', project.id))
      .filter((question) => question.sourceFile !== sourceRef && question.lectureId && lectureIds.has(question.lectureId))
      .map((question) => question.lectureId as string));
    const removableLectureIds = [...lectureIds].filter((id) => !sharedLectureIds.has(id));
    await database.transaction([
      ...questions.map((question) => ({ type: 'delete' as const, storeName: STORES.questions, key: question.id })),
      ...sessions.map((session) => ({ type: 'delete' as const, storeName: STORES.practiceSessions, key: session.id })),
      ...answers.map((answer) => ({ type: 'delete' as const, storeName: STORES.answers, key: answer.id })),
      ...wrongItems.map((item) => ({ type: 'delete' as const, storeName: STORES.wrongItems, key: item.id })),
      ...tasks.map((task) => ({ type: 'delete' as const, storeName: STORES.aiTasks, key: task.id })),
      ...logs.map((log) => ({ type: 'delete' as const, storeName: STORES.taskLogs, key: log.id })),
      ...removableLectureIds.map((id) => ({ type: 'delete' as const, storeName: STORES.practiceLectures, key: id }))
    ]);
    return { questions: questions.length, sessions: sessions.length };
  }

  private async purgeDevSeed(projectId: string): Promise<void> {
    if (this.devSeedPurged) return;
    this.devSeedPurged = true;
    const rows = await database.queryByIndex<StoredQuestion>(STORES.questions, 'projectSource', [projectId, 'dev-seed']);
    if (!rows.length) return;
    await Promise.all(rows.map((question) => database.delete(STORES.questions, question.id)));
  }
}

function normalizeLectureList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6);
  return items.length ? items : fallback;
}

export const questionRepository = new QuestionRepository();
