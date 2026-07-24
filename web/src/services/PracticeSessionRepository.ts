import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AnswerRecord, PracticeMode, PracticeSession } from '@/domain/practice';
import type { AbilityProfile, LearningEvent } from '@/domain/learning';
import type { WrongItem } from '@/domain/wrongbook';
import { abilityDiagnosisService } from './AbilityDiagnosisService';
import { projectRepository } from '@/services/ProjectRepository';

interface CompletedQuestion {
  id: string;
  answer: number;
  module?: string;
  explanation?: string;
  sourceFile?: string;
}

interface SaveSessionInput {
  mode?: PracticeMode;
  module?: string;
  questions: CompletedQuestion[];
  userAnswers: (number | null)[];
  durationMs?: number;
  sourceFile?: string;
}

export interface PracticeGradeItem {
  questionId: string;
  errorType?: string;
  errorDetail?: string;
  correctApproach?: string;
  tips?: string;
}

const VALID_ERROR_TYPES = new Set(['概念性错误', '理解性错误', '计算性错误', '审题性错误', '方法选择错误', '粗心失误', '未作答']);

function normalizeErrorType(value?: string): string | undefined {
  const text = value?.trim();
  if (!text || /标准答案|答案错误|选择错误|不一致|不符合题意/.test(text)) return undefined;
  return VALID_ERROR_TYPES.has(text) ? text : undefined;
}

function normalizeErrorDetail(value?: string): string | undefined {
  const text = value?.trim();
  if (!text || /^(与?标准答案不一致|答案错误|选择错误|不符合题意|做错了)[。.!！]*$/.test(text)) return undefined;
  return text;
}

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function mostCommonSourceFile(questions: CompletedQuestion[]): string | undefined {
  const counts = new Map<string, number>();
  questions.forEach((question) => {
    if (!question.sourceFile) return;
    counts.set(question.sourceFile, (counts.get(question.sourceFile) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export class PracticeSessionRepository {
  async listByProject(projectId: string): Promise<PracticeSession[]> {
    return database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectId', projectId);
  }

  async listByDate(projectId: string, date: string): Promise<PracticeSession[]> {
    return database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectDate', [projectId, date]);
  }

  async latest(limit = 7): Promise<PracticeSession[]> {
    const project = await projectRepository.getActiveProject();
    const sessions = await this.listByProject(project.id);
    return sessions.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  async latestForSource(sourceFile?: string): Promise<PracticeSession | undefined> {
    if (!sourceFile) return undefined;
    const project = await projectRepository.getActiveProject();
    const sessions = await this.listByProject(project.id);
    return sessions
      .filter((session) => session.sourceFile === sourceFile)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  async historyForModule(module: string, limit = 60): Promise<PracticeSession[]> {
    const project = await projectRepository.getActiveProject();
    const sessions = await this.listByProject(project.id);
    return sessions
      .filter((session) => !module || session.module === module)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async questionIdsForSession(sessionId: string): Promise<string[]> {
    return (await this.answersForSession(sessionId))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((answer) => answer.questionId)
      .filter(Boolean);
  }

  async answersForSession(sessionId: string): Promise<AnswerRecord[]> {
    return database.queryByIndex<AnswerRecord>(STORES.answers, 'sessionId', sessionId);
  }

  async latestAnswersForQuestionIds(questionIds: string[]): Promise<AnswerRecord[]> {
    const ids = new Set(questionIds.filter(Boolean));
    if (!ids.size) return [];
    const project = await projectRepository.getActiveProject();
    const sessions = await this.listByProject(project.id);
    const sessionIds = new Set(sessions.map((session) => session.id));
    const rows = (await database.list<AnswerRecord>(STORES.answers))
      .filter((answer) => sessionIds.has(answer.sessionId) && ids.has(answer.questionId))
      .sort((a, b) => b.createdAt - a.createdAt);
    const latestByQuestion = new Map<string, AnswerRecord>();
    rows.forEach((answer) => {
      if (!latestByQuestion.has(answer.questionId)) latestByQuestion.set(answer.questionId, answer);
    });
    return [...latestByQuestion.values()];
  }

  async sessionById(sessionId: string): Promise<PracticeSession | undefined> {
    return database.get<PracticeSession>(STORES.practiceSessions, sessionId);
  }

  async applyAIGrading(sessionId: string, grades: PracticeGradeItem[], taskId?: string): Promise<void> {
    const project = await projectRepository.getActiveProject();
    const answers = await this.answersForSession(sessionId);
    const byQuestionId = new Map(grades.map((grade) => [grade.questionId, grade]));
    const now = Date.now();
    const updatedAnswers = answers.map((answer) => {
      const grade = byQuestionId.get(answer.questionId);
      if (!grade) return answer;
      const errorType = normalizeErrorType(grade.errorType) || answer.errorType;
      const errorDetail = normalizeErrorDetail(grade.errorDetail) || answer.errorDetail;
      return {
        ...answer,
        errorType,
        errorDetail,
        correctApproach: grade.correctApproach || answer.correctApproach,
        tips: grade.tips || answer.tips,
        aiAnalysisTaskId: taskId || answer.aiAnalysisTaskId
      } satisfies AnswerRecord;
    });
    const wrongUpdates = await Promise.all(updatedAnswers
      .filter((answer) => !answer.correct && answer.questionId)
      .map(async (answer) => {
        const current = await database.get<WrongItem>(STORES.wrongItems, `${project.id}:${answer.questionId}`);
        if (!current) return undefined;
        const reason = [answer.errorType, answer.errorDetail].filter(Boolean).join('：') || current.reason || 'AI 错因分析中';
        return {
          ...current,
          reason,
          updatedAt: now
        } satisfies WrongItem;
      }));
    const wrongItemsToUpdate = wrongUpdates.filter(Boolean) as WrongItem[];
    await database.transaction([
      { type: 'putMany', storeName: STORES.answers, values: updatedAnswers },
      { type: 'putMany', storeName: STORES.wrongItems, values: wrongItemsToUpdate }
    ]);
  }

  async saveCompleted(input: SaveSessionInput): Promise<PracticeSession> {
    const project = await projectRepository.getActiveProject();
    const now = Date.now();
    const questionCount = input.questions.length;
    const correctCount = input.questions.reduce((total, question, index) => {
      return input.userAnswers[index] === question.answer ? total + 1 : total;
    }, 0);
    const sourceFile = input.sourceFile || mostCommonSourceFile(input.questions);
    const session: PracticeSession = {
      id: id('practice_session'),
      projectId: project.id,
      mode: input.mode || 'practice',
      module: input.module || '专项练习',
      date: today(),
      questionCount,
      correctCount,
      accuracy: questionCount ? Math.round((correctCount / questionCount) * 100) : 0,
      durationMs: input.durationMs,
      sourceFile,
      createdAt: now,
      updatedAt: now
    };

    const answers: AnswerRecord[] = input.questions.map((question, index) => ({
      id: id('answer'),
      sessionId: session.id,
      questionId: question.id,
      userAnswer: input.userAnswers[index] === null ? '' : String(input.userAnswers[index]),
      correct: input.userAnswers[index] === question.answer,
      status: input.userAnswers[index] === null ? 'blank' : input.userAnswers[index] === question.answer ? 'correct' : 'wrong',
      correctAnswer: String(question.answer),
      explanationSnapshot: question.explanation || '',
      errorType: input.userAnswers[index] === null ? '未作答' : input.userAnswers[index] === question.answer ? undefined : '练习答错',
      errorDetail: input.userAnswers[index] === null ? '本题未作答，等待 AI 给出复盘建议。' : input.userAnswers[index] === question.answer ? undefined : 'AI 错因分析中。',
      createdAt: now
    }));

    const wrongAnswers = answers.filter((answer) => !answer.correct && answer.questionId);
    const wrongItems = await Promise.all(wrongAnswers.map(async (answer) => {
      const question = input.questions.find((item) => item.id === answer.questionId);
      const existing = await database.get<WrongItem>(STORES.wrongItems, `${project.id}:${answer.questionId}`);
      const wrongCount = (existing?.wrongCount || 0) + 1;
      return {
        id: `${project.id}:${answer.questionId}`,
        projectId: project.id,
        questionId: answer.questionId,
        module: question?.module || input.module,
        reason: answer.errorDetail || 'AI 错因分析中',
        wrongCount,
        status: 'open',
        lastWrongAt: now,
        nextReviewAt: now + Math.min(7, wrongCount * 2) * 86400000,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      } satisfies WrongItem;
    }));

    const event: LearningEvent = {
      id: id('learning_event'),
      projectId: project.id,
      type: session.mode === 'mock' ? 'mock' : 'practice',
      module: session.module,
      date: session.date,
      total: session.questionCount,
      correct: session.correctCount,
      accuracy: session.accuracy,
      sourceRef: session.id,
      createdAt: now
    };

    const abilityProfile = await this.nextAbilityProfile(project.id, session.module || '专项练习', session.questionCount, session.correctCount, now);
    await database.transaction([
      { type: 'put', storeName: STORES.practiceSessions, value: session },
      { type: 'putMany', storeName: STORES.answers, values: answers },
      { type: 'putMany', storeName: STORES.wrongItems, values: wrongItems },
      { type: 'put', storeName: STORES.learningEvents, value: event },
      { type: 'put', storeName: STORES.abilityProfiles, value: abilityProfile }
    ]);
    void abilityDiagnosisService.refreshProject(project.id).catch((error) => {
      console.warn('[ability diagnosis refresh]', error);
    });
    return session;
  }

  private async nextAbilityProfile(
    projectId: string,
    module: string,
    totalDelta: number,
    correctDelta: number,
    updatedAt: number
  ): Promise<AbilityProfile> {
    const id = `${projectId}:${module}`;
    const current = await database.get<AbilityProfile>(STORES.abilityProfiles, id);
    const total = (current?.total || 0) + totalDelta;
    const correct = (current?.correct || 0) + correctDelta;
    return {
      id,
      projectId,
      module,
      total,
      correct,
      accuracy: total ? Math.round((correct / total) * 100) : 0,
      updatedAt
    };
  }
}

export const practiceSessionRepository = new PracticeSessionRepository();
