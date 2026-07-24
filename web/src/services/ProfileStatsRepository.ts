import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { LearningEvent } from '@/domain/learning';
import type { PracticeSession } from '@/domain/practice';
import type { WrongItem } from '@/domain/wrongbook';
import { projectRepository } from '@/services/ProjectRepository';

export interface ProfileStats {
  projectName: string;
  practiceCount: number;
  questionCount: number;
  correctCount: number;
  accuracy: number;
  wrongCount: number;
  activeDays: number;
}

export class ProfileStatsRepository {
  async getStats(): Promise<ProfileStats> {
    const project = await projectRepository.getActiveProject();
    const [sessions, wrongItems, events] = await Promise.all([
      database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectId', project.id),
      database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id),
      database.queryByIndex<LearningEvent>(STORES.learningEvents, 'projectId', project.id)
    ]);

    const questionCount = sessions.reduce((total, session) => total + session.questionCount, 0);
    const correctCount = sessions.reduce((total, session) => total + session.correctCount, 0);
    const activeDays = new Set(events.map((event) => event.date)).size;

    return {
      projectName: project.name,
      practiceCount: sessions.length,
      questionCount,
      correctCount,
      accuracy: questionCount ? Math.round((correctCount / questionCount) * 100) : 0,
      wrongCount: wrongItems.filter((item) => item.status !== 'mastered').length,
      activeDays
    };
  }
}

export const profileStatsRepository = new ProfileStatsRepository();
