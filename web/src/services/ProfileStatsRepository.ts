import { initializeTutorRuntime } from '@/composition-root/public';
import { qualityDashboardService } from './QualityDashboardService';

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
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) {
      return { projectName: '尚未建档', practiceCount: 0, questionCount: 0, correctCount: 0, accuracy: 0, wrongCount: 0, activeDays: 0 };
    }
    const [dashboard, sessions] = await Promise.all([
      qualityDashboardService.dashboard(),
      runtime.learningSessionRepository.listRecent(cycle.examCycle.id, 500)
    ]);
    const correctCount = sessions.reduce((total, facts) => total + facts.session.correctCount, 0);

    return {
      projectName: cycle.project.name,
      practiceCount: dashboard.eventsCount,
      questionCount: dashboard.totalQuestions,
      correctCount,
      accuracy: dashboard.totalQuestions ? Math.round((correctCount / dashboard.totalQuestions) * 100) : 0,
      wrongCount: dashboard.openWrongCount,
      activeDays: dashboard.practiceDays
    };
  }
}

export const profileStatsRepository = new ProfileStatsRepository();
