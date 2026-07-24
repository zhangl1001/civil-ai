import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AbilityProfile, LearningEvent } from '@/domain/learning';
import type { PracticeSession } from '@/domain/practice';
import type { WrongItem } from '@/domain/wrongbook';
import { abilityDiagnosisService, type AbilityDiagnosis, type ModuleDiagnosis } from './AbilityDiagnosisService';
import { practiceFlowService } from './PracticeFlowService';
import { projectRepository } from './ProjectRepository';

export interface QualityModule {
  name: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface QualityTrendPoint {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface QualityDashboard {
  score: number;
  grade: string;
  totalQuestions: number;
  practiceDays: number;
  streak: number;
  weekQuestions: number;
  weekMinutes: number;
  avgSecondsPerQuestion: number;
  weakestModule?: QualityModule;
  modules: QualityModule[];
  trend: QualityTrendPoint[];
  openWrongCount: number;
  reviewDueCount: number;
  eventsCount: number;
  advice: string[];
  diagnosis: AbilityDiagnosis;
  diagnosisSummary: string;
  moduleDiagnoses: ModuleDiagnosis[];
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function gradeFor(score: number): string {
  if (score >= 85) return 'S 级';
  if (score >= 75) return 'A 级';
  if (score >= 65) return 'B 级';
  if (score >= 55) return 'C 级';
  return 'D 级';
}

function streakFrom(dates: Set<string>): number {
  let count = 0;
  let cursor = new Date();
  while (dates.has(iso(cursor))) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export class QualityDashboardService {
  async dashboard(): Promise<QualityDashboard> {
    const project = await projectRepository.getActiveProject();
    const [profiles, sessions, wrongItems, events, diagnosis] = await Promise.all([
      database.queryByIndex<AbilityProfile>(STORES.abilityProfiles, 'projectId', project.id),
      database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectId', project.id),
      database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id),
      database.queryByIndex<LearningEvent>(STORES.learningEvents, 'projectId', project.id),
      abilityDiagnosisService.latestOrCurrent()
    ]);

    const modules = this.modules(profiles, sessions);
    const totalQuestions = sessions.reduce((sum, session) => sum + session.questionCount, 0);
    const totalCorrect = sessions.reduce((sum, session) => sum + session.correctCount, 0);
    const totalDuration = sessions.reduce((sum, session) => sum + (session.durationMs || 0), 0);
    const accuracy = totalQuestions ? totalCorrect / totalQuestions : 0;
    const recent = sessions.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
    const recentTotal = recent.reduce((sum, session) => sum + session.questionCount, 0);
    const recentCorrect = recent.reduce((sum, session) => sum + session.correctCount, 0);
    const recentAccuracy = recentTotal ? recentCorrect / recentTotal : 0;
    const avgSecondsPerQuestion = totalQuestions && totalDuration ? Math.round(totalDuration / totalQuestions / 1000) : 0;
    const speedScore = avgSecondsPerQuestion ? Math.max(0, Math.min(1, 70 / avgSecondsPerQuestion)) : 0;
    const dates = new Set(sessions.map((session) => session.date));
    const score = Math.min(100, Math.round(accuracy * 55 + recentAccuracy * 20 + speedScore * 15 + Math.min(10, dates.size)));
    const weekStart = iso(addDays(new Date(), -6));
    const weekSessions = sessions.filter((session) => session.date >= weekStart);
    const weakestModule = modules.filter((module) => module.total > 0).sort((a, b) => a.accuracy - b.accuracy)[0];
    const reviewDueCount = wrongItems.filter((item) => item.status !== 'mastered' && (!item.nextReviewAt || item.nextReviewAt <= Date.now())).length;

    return {
      score,
      grade: gradeFor(score),
      totalQuestions,
      practiceDays: dates.size,
      streak: streakFrom(dates),
      weekQuestions: weekSessions.reduce((sum, session) => sum + session.questionCount, 0),
      weekMinutes: Math.round(weekSessions.reduce((sum, session) => sum + (session.durationMs || 0), 0) / 60000),
      avgSecondsPerQuestion,
      weakestModule,
      modules,
      trend: this.trend(sessions),
      openWrongCount: wrongItems.filter((item) => item.status !== 'mastered').length,
      reviewDueCount,
      eventsCount: events.length,
      advice: this.advice({ totalQuestions, weakestModule, reviewDueCount, avgSecondsPerQuestion }),
      diagnosis,
      diagnosisSummary: this.diagnosisSummary(diagnosis),
      moduleDiagnoses: diagnosis.modules.slice(0, 5)
    };
  }

  startWeakPractice(module?: string): void {
    practiceFlowService.writeStartContext({
      module: module || '资料分析',
      date: today(),
      mode: 'practice',
      source: 'practice-center',
      questionCount: 10
    });
  }

  private modules(profiles: AbilityProfile[], sessions: PracticeSession[]): QualityModule[] {
    if (profiles.length) {
      return profiles
        .map((profile) => ({ name: profile.module, total: profile.total, correct: profile.correct, accuracy: profile.accuracy }))
        .sort((a, b) => b.total - a.total);
    }
    const grouped = new Map<string, { total: number; correct: number }>();
    sessions.forEach((session) => {
      const name = session.module || '专项练习';
      const current = grouped.get(name) || { total: 0, correct: 0 };
      current.total += session.questionCount;
      current.correct += session.correctCount;
      grouped.set(name, current);
    });
    return Array.from(grouped.entries()).map(([name, value]) => ({
      name,
      total: value.total,
      correct: value.correct,
      accuracy: value.total ? Math.round(value.correct / value.total * 100) : 0
    })).sort((a, b) => b.total - a.total);
  }

  private trend(sessions: PracticeSession[]): QualityTrendPoint[] {
    return Array.from({ length: 7 }, (_, index) => iso(addDays(new Date(), index - 6))).map((date) => {
      const day = sessions.filter((session) => session.date === date);
      const total = day.reduce((sum, session) => sum + session.questionCount, 0);
      const correct = day.reduce((sum, session) => sum + session.correctCount, 0);
      return { date, total, correct, accuracy: total ? Math.round(correct / total * 100) : 0 };
    });
  }

  private advice(input: { totalQuestions: number; weakestModule?: QualityModule; reviewDueCount: number; avgSecondsPerQuestion: number }): string[] {
    const items: string[] = [];
    if (input.totalQuestions < 30) items.push('诊断样本不足，先完成 3 组专项练习再判断能力波动。');
    if (input.weakestModule) items.push(`优先补强 ${input.weakestModule.name}，当前正确率 ${input.weakestModule.accuracy}%。`);
    if (input.reviewDueCount > 0) items.push(`${input.reviewDueCount} 道错题到期，建议先复习再做新题。`);
    if (input.avgSecondsPerQuestion > 90) items.push('平均作答速度偏慢，练习时加入限时模式。');
    return items.length ? items : ['当前训练节奏稳定，保持每日练习和错题回流。'];
  }

  private diagnosisSummary(diagnosis: AbilityDiagnosis): string {
    const phaseText: Record<AbilityDiagnosis['overall']['phase'], string> = {
      onboarding: '建档期',
      diagnosis: '摸底期',
      foundation: '基础期',
      improvement: '强化期',
      sprint: '冲刺期'
    };
    const focus = diagnosis.recommendation.focusModules.length
      ? `优先训练 ${diagnosis.recommendation.focusModules.join('、')}`
      : '当前模块表现相对稳定';
    const gaps = [
      diagnosis.overall.xingceGap !== undefined ? `行测差距 ${diagnosis.overall.xingceGap} 分` : '',
      diagnosis.overall.shenlunGap !== undefined ? `申论差距 ${diagnosis.overall.shenlunGap} 分` : ''
    ].filter(Boolean).join('，');
    return `${phaseText[diagnosis.overall.phase]} · ${focus}${gaps ? ` · ${gaps}` : ''}`;
  }
}

export const qualityDashboardService = new QualityDashboardService();
