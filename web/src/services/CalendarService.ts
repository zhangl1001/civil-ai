import type { CalendarDayDetail, CalendarDayTask, CalendarMonthCell, CalendarMonthSummary } from '@/domain/calendar';
import type { LearningEvent } from '@/domain/learning';
import type { PracticeSession } from '@/domain/practice';
import { calendarTaskTitle } from '@/domain/labels';
import { projectRepository } from './ProjectRepository';
import { learningEventRepository } from './LearningEventRepository';
import { practiceSessionRepository } from './PracticeSessionRepository';
import { questionRepository } from './QuestionRepository';

function localDate(date = new Date()): string {
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

function eventAccuracy(event: LearningEvent): number | null {
  if (typeof event.accuracy === 'number') return event.accuracy;
  if (event.total && typeof event.correct === 'number') {
    return Math.round((event.correct / event.total) * 100);
  }
  return null;
}

function sessionToTask(session: PracticeSession): CalendarDayTask {
  return {
    id: session.id,
    type: session.mode === 'mock' ? 'mock' : session.mode === 'essay' ? 'essay' : session.mode === 'review' ? 'review' : 'practice',
    title: calendarTaskTitle(session.mode, session.module),
    module: session.module,
    status: session.questionCount > 0 ? 'done' : 'pending',
    questionCount: session.questionCount,
    correct: session.correctCount,
    accuracy: session.accuracy,
    sourceRef: session.sourceFile || session.id
  };
}

function isCalendarEvent(event: LearningEvent): boolean {
  return event.type === 'practice' || event.type === 'review' || event.type === 'essay' || event.type === 'mock' || event.type === 'grade';
}

export class CalendarService {
  async getMonth(year: number, month: number): Promise<CalendarMonthSummary> {
    const project = await projectRepository.getActiveProject();
    const [events, sessions] = await Promise.all([
      learningEventRepository.listByProject(project.id),
      practiceSessionRepository.listByProject(project.id)
    ]);
    const prefix = monthPrefix(year, month);
    const today = localDate();
    const cells: CalendarMonthCell[] = [];

    for (let day = 1; day <= daysInMonth(year, month); day++) {
      const date = `${prefix}-${String(day).padStart(2, '0')}`;
      const dayEvents = events.filter((event) => event.date === date && isCalendarEvent(event));
      const daySessions = sessions.filter((session) => session.date === date);
      const total = daySessions.reduce((sum, session) => sum + session.questionCount, 0)
        || dayEvents.reduce((sum, event) => sum + (event.total || 0), 0);
      const correct = daySessions.reduce((sum, session) => sum + session.correctCount, 0)
        || dayEvents.reduce((sum, event) => sum + (event.correct || 0), 0);
      const accuracy = total ? Math.round((correct / total) * 100) : average(dayEvents.map(eventAccuracy));

      cells.push({
        date,
        day,
        isToday: date === today,
        hasPractice: dayEvents.some((event) => event.type === 'practice' || event.type === 'review') || daySessions.some((session) => session.mode === 'practice' || session.mode === 'review' || session.mode === 'diagnostic'),
        hasEssay: dayEvents.some((event) => event.type === 'essay') || daySessions.some((session) => session.mode === 'essay'),
        hasMock: dayEvents.some((event) => event.type === 'mock') || daySessions.some((session) => session.mode === 'mock'),
        total,
        correct,
        accuracy
      });
    }

    const activeDays = cells.filter((cell) => cell.hasPractice || cell.hasEssay || cell.hasMock || cell.total > 0).length;
    return {
      year,
      month,
      activeDays,
      streak: this.streak(events, sessions),
      averageAccuracy: average(cells.map((cell) => cell.accuracy)),
      cells
    };
  }

  async getDayDetail(date: string): Promise<CalendarDayDetail> {
    const project = await projectRepository.getActiveProject();
    const [events, sessions, questionCountsBySource] = await Promise.all([
      learningEventRepository.listByDate(project.id, date),
      practiceSessionRepository.listByDate(project.id, date),
      questionRepository.countBySource(project.id)
    ]);

    const tasks = this.tasksFromData(events, sessions, questionCountsBySource);
    const total = tasks.reduce((sum, task) => sum + task.questionCount, 0);
    const correct = tasks.reduce((sum, task) => sum + (task.correct || 0), 0);
    const weakModules = tasks
      .filter((task) => task.module && typeof task.accuracy === 'number' && task.accuracy < 60)
      .map((task) => ({ module: task.module!, accuracy: task.accuracy! }));

    return {
      date,
      isToday: date === localDate(),
      hasActivity: tasks.length > 0,
      tasks,
      total,
      correct,
      accuracy: total ? Math.round((correct / total) * 100) : average(tasks.map((task) => task.accuracy ?? null)),
      weakModules
    };
  }

  private tasksFromData(events: LearningEvent[], sessions: PracticeSession[], questionCountsBySource: Map<string, number>): CalendarDayTask[] {
    const seen = new Set<string>();
    const tasks: CalendarDayTask[] = [];

    sessions.forEach((session) => {
      tasks.push(sessionToTask(session));
      seen.add(session.id);
    });

    events.filter(isCalendarEvent).forEach((event) => {
      const id = event.sourceRef || event.id;
      if (seen.has(id)) return;
      const questionCount = event.total || this.questionCountFromQuestions(questionCountsBySource, event.sourceRef);
      tasks.push({
        id,
        type: event.type,
        title: calendarTaskTitle(event.type, event.module),
        module: event.module,
        status: event.total || event.correct || event.accuracy !== undefined ? 'done' : 'pending',
        questionCount,
        correct: event.correct,
        accuracy: eventAccuracy(event) ?? undefined,
        sourceRef: event.sourceRef
      });
    });

    return tasks.sort((a, b) => typeOrder(a.type) - typeOrder(b.type));
  }

  private questionCountFromQuestions(questionCountsBySource: Map<string, number>, sourceRef?: string): number {
    if (!sourceRef) return 0;
    return questionCountsBySource.get(sourceRef) || 0;
  }

  private streak(events: LearningEvent[], sessions: PracticeSession[]): number {
    const active = new Set<string>();
    events.filter(isCalendarEvent).forEach((event) => active.add(event.date));
    sessions.forEach((session) => active.add(session.date));
    let streak = 0;
    const cursor = new Date();
    for (let guard = 0; guard < 1000; guard++) {
      const key = localDate(cursor);
      if (!active.has(key)) break;
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }
}

function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function typeOrder(type: CalendarDayTask['type']): number {
  return { practice: 0, review: 1, essay: 2, mock: 3, digest: 4, grade: 5 }[type] ?? 9;
}

export const calendarService = new CalendarService();
