import { initializeTutorRuntime } from '@/composition-root/public';
import type { CalendarDayDetail, CalendarDayTask, CalendarMonthCell, CalendarMonthSummary } from '@/domain/calendar';
import { calendarTaskTitle, practiceModuleLabel } from '@/domain/labels';
import type { LearningAssetRecord } from '@/modules/content/public';
import { LearningAssetKind, LearningAssetStatus } from '@/modules/content/public';
import type { ObjectiveSessionFacts } from '@/modules/evidence/public';

interface CalendarFact {
  readonly date: string;
  readonly task: CalendarDayTask;
}

function localDate(input: Date | number = new Date()): string {
  const date = typeof input === 'number' ? new Date(input) : input;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export class CalendarService {
  async getMonth(year: number, month: number): Promise<CalendarMonthSummary> {
    const facts = await this.loadFacts();
    const prefix = monthPrefix(year, month);
    const today = localDate();
    const cells: CalendarMonthCell[] = [];

    for (let day = 1; day <= daysInMonth(year, month); day++) {
      const date = `${prefix}-${String(day).padStart(2, '0')}`;
      const tasks = facts.filter((fact) => fact.date === date).map((fact) => fact.task);
      const total = tasks.reduce((sum, task) => sum + task.questionCount, 0);
      const correct = tasks.reduce((sum, task) => sum + (task.correct || 0), 0);
      cells.push({
        date,
        day,
        isToday: date === today,
        hasPractice: tasks.some((task) => task.type === 'practice' || task.type === 'review'),
        hasEssay: tasks.some((task) => task.type === 'essay'),
        hasMock: tasks.some((task) => task.type === 'mock'),
        total,
        correct,
        accuracy: total ? Math.round(correct / total * 100) : average(tasks.map((task) => task.accuracy))
      });
    }

    const activeDates = new Set(facts.map((fact) => fact.date));
    return {
      year,
      month,
      activeDays: cells.filter((cell) => activeDates.has(cell.date)).length,
      streak: streakFrom(activeDates),
      averageAccuracy: average(cells.map((cell) => cell.accuracy)),
      cells
    };
  }

  async getDayDetail(date: string): Promise<CalendarDayDetail> {
    const tasks = (await this.loadFacts())
      .filter((fact) => fact.date === date)
      .map((fact) => fact.task)
      .sort((left, right) => typeOrder(left.type) - typeOrder(right.type));
    const total = tasks.reduce((sum, task) => sum + task.questionCount, 0);
    const correct = tasks.reduce((sum, task) => sum + (task.correct || 0), 0);
    return {
      date,
      isToday: date === localDate(),
      hasActivity: tasks.length > 0,
      tasks,
      total,
      correct,
      accuracy: total ? Math.round(correct / total * 100) : average(tasks.map((task) => task.accuracy)),
      weakModules: tasks
        .filter((task) => task.module && typeof task.accuracy === 'number' && task.accuracy < 60)
        .map((task) => ({ module: practiceModuleLabel(task.module), accuracy: task.accuracy! }))
    };
  }

  private async loadFacts(): Promise<CalendarFact[]> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return [];
    const [sessions, essayAttempts] = await Promise.all([
      runtime.learningSessionRepository.listRecent(cycle.examCycle.id, 500),
      runtime.learningAssetStore.list({
        examCycleId: cycle.examCycle.id,
        kinds: [LearningAssetKind.EssayAttempt],
        status: LearningAssetStatus.Ready,
        limit: 500
      })
    ]);
    const bundles = await Promise.all(sessions.map((facts) => (
      runtime.contentRepository.findQuestionSet(facts.session.questionSetId)
    )));
    return [
      ...sessions.map((facts, index) => sessionFact(facts, bundles[index]?.questionSet.module)),
      ...essayAttempts.map(assetFact)
    ];
  }
}

function sessionFact(facts: ObjectiveSessionFacts, module?: string): CalendarFact {
  const type = facts.session.sessionType === 'mock'
    ? 'mock'
    : facts.session.sessionType === 'review' || facts.session.sessionType === 'retention'
      ? 'review'
      : 'practice';
  const accuracy = facts.session.questionCount
    ? Math.round(facts.session.correctCount / facts.session.questionCount * 100)
    : undefined;
  return {
    date: localDate(Number(facts.session.completedAt)),
    task: {
      id: facts.session.id,
      type,
      title: calendarTaskTitle(type, module),
      module,
      status: 'done',
      questionCount: facts.session.questionCount,
      correct: facts.session.correctCount,
      accuracy,
      sourceRef: facts.session.questionSetId,
      target: {
        type: 'objective_question_set',
        questionSetId: facts.session.questionSetId,
        learningThreadId: facts.session.learningThreadId
      }
    }
  };
}

function assetFact(asset: LearningAssetRecord): CalendarFact {
  const score = typeof asset.payload.score === 'number' ? asset.payload.score : undefined;
  const context = recordOf(asset.payload.essayContext);
  return {
    date: typeof context.date === 'string' ? context.date : localDate(Number(asset.createdAt)),
    task: {
      id: asset.id,
      type: 'essay',
      title: asset.title,
      module: '申论',
      status: 'done',
      questionCount: 1,
      correct: score !== undefined && score >= 60 ? 1 : 0,
      accuracy: score,
      sourceRef: asset.id
    }
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function average(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!numbers.length) return null;
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function streakFrom(activeDates: ReadonlySet<string>): number {
  let streak = 0;
  const cursor = new Date();
  for (let guard = 0; guard < 1000; guard++) {
    if (!activeDates.has(localDate(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function typeOrder(type: CalendarDayTask['type']): number {
  return { practice: 0, review: 1, essay: 2, mock: 3, digest: 4, grade: 5 }[type] ?? 9;
}

export const calendarService = new CalendarService();
