import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AbilityProfile, LearningEvent } from '@/domain/learning';
import type { PracticeSession } from '@/domain/practice';
import type { WrongItem } from '@/domain/wrongbook';
import { examProfileRepository } from './ExamProfileRepository';
import { profileAnalysisRepository } from './ProfileAnalysisRepository';
import { projectRepository } from './ProjectRepository';

export interface ModuleStats {
  module: string;
  questionCount: number;
  correctCount: number;
  accuracy: number;
  avgSeconds: number;
  wrongCount: number;
  repeatWrongRate: number;
  recentQuestionCount: number;
  recentAccuracy: number;
}

export interface AbilityStats {
  projectId: string;
  profileId?: string;
  generatedAt: number;
  totals: {
    questionCount: number;
    correctCount: number;
    accuracy: number;
    practiceDays: number;
    wrongCount: number;
    reviewDueCount: number;
  };
  modules: ModuleStats[];
}

const RECENT_WINDOW_MS = 30 * 86400000;

function moduleName(value?: string): string {
  return value && value.trim() ? value.trim() : '专项练习';
}

export class AbilityStatsService {
  async current(): Promise<AbilityStats> {
    const project = await projectRepository.getActiveProject();
    return this.forProject(project.id);
  }

  async forProject(projectId: string): Promise<AbilityStats> {
    const [sessions, wrongItems, profiles, events, profile] = await Promise.all([
      database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectId', projectId),
      database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', projectId),
      database.queryByIndex<AbilityProfile>(STORES.abilityProfiles, 'projectId', projectId),
      database.queryByIndex<LearningEvent>(STORES.learningEvents, 'projectId', projectId),
      examProfileRepository.getActiveProfile(projectId)
    ]);
    const now = Date.now();
    const grouped = new Map<string, {
      total: number;
      correct: number;
      durationMs: number;
      timedQuestions: number;
      recentTotal: number;
      recentCorrect: number;
      wrong: number;
      repeatWrong: number;
    }>();

    sessions.forEach((session) => {
      const module = moduleName(session.module);
      const current = grouped.get(module) || {
        total: 0,
        correct: 0,
        durationMs: 0,
        timedQuestions: 0,
        recentTotal: 0,
        recentCorrect: 0,
        wrong: 0,
        repeatWrong: 0
      };
      current.total += session.questionCount;
      current.correct += session.correctCount;
      if (session.durationMs && session.questionCount) {
        current.durationMs += session.durationMs;
        current.timedQuestions += session.questionCount;
      }
      if (now - session.createdAt <= RECENT_WINDOW_MS) {
        current.recentTotal += session.questionCount;
        current.recentCorrect += session.correctCount;
      }
      grouped.set(module, current);
    });

    profiles.forEach((profileRow) => {
      const module = moduleName(profileRow.module);
      if (grouped.has(module)) return;
      grouped.set(module, {
        total: profileRow.total,
        correct: profileRow.correct,
        durationMs: 0,
        timedQuestions: 0,
        recentTotal: 0,
        recentCorrect: 0,
        wrong: 0,
        repeatWrong: 0
      });
    });

    wrongItems.forEach((item) => {
      const module = moduleName(item.module);
      const current = grouped.get(module) || {
        total: 0,
        correct: 0,
        durationMs: 0,
        timedQuestions: 0,
        recentTotal: 0,
        recentCorrect: 0,
        wrong: 0,
        repeatWrong: 0
      };
      current.wrong += 1;
      if ((item.wrongCount || 0) > 1) current.repeatWrong += 1;
      grouped.set(module, current);
    });

    const modules = Array.from(grouped.entries()).map(([module, value]) => ({
      module,
      questionCount: value.total,
      correctCount: value.correct,
      accuracy: value.total ? Math.round((value.correct / value.total) * 100) : 0,
      avgSeconds: value.timedQuestions ? Math.round(value.durationMs / value.timedQuestions / 1000) : 0,
      wrongCount: value.wrong,
      repeatWrongRate: value.wrong ? Math.round((value.repeatWrong / value.wrong) * 100) : 0,
      recentQuestionCount: value.recentTotal,
      recentAccuracy: value.recentTotal ? Math.round((value.recentCorrect / value.recentTotal) * 100) : 0
    })).sort((a, b) => b.questionCount - a.questionCount || a.accuracy - b.accuracy);

    const questionCount = sessions.reduce((sum, session) => sum + session.questionCount, 0);
    const correctCount = sessions.reduce((sum, session) => sum + session.correctCount, 0);
    const practiceDays = new Set(events.filter((event) => event.type === 'practice' || event.type === 'mock' || event.type === 'review').map((event) => event.date)).size;
    return {
      projectId,
      profileId: profile?.id,
      generatedAt: now,
      totals: {
        questionCount,
        correctCount,
        accuracy: questionCount ? Math.round((correctCount / questionCount) * 100) : 0,
        practiceDays,
        wrongCount: wrongItems.filter((item) => item.status !== 'mastered').length,
        reviewDueCount: wrongItems.filter((item) => item.status !== 'mastered' && (!item.nextReviewAt || item.nextReviewAt <= now)).length
      },
      modules
    };
  }

  async refreshProject(projectId: string): Promise<AbilityStats> {
    const stats = await this.forProject(projectId);
    await profileAnalysisRepository.saveStatsSnapshot({
      projectId,
      profileId: stats.profileId,
      range: 'all',
      algorithmVersion: 'ability-stats-v1',
      generatedAt: stats.generatedAt,
      stats
    });
    return stats;
  }
}

export const abilityStatsService = new AbilityStatsService();
