import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AbilityProfile, LearningEvent } from '@/domain/learning';
import type { PracticeSession } from '@/domain/practice';
import { projectRepository } from '@/services/ProjectRepository';
import type { Countdown, ModuleStat, TodayTask } from '@/stores/home';
import { abilityDiagnosisService } from './AbilityDiagnosisService';
import { profiles } from './ExamProfiles';
import { homeFeatureService } from './HomeFeatureService';
import { planService } from './PlanService';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function greetingText(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，保持节奏';
  if (hour < 12) return '上午好，开始今天的学习吧';
  if (hour < 18) return '下午好，继续稳步推进';
  return '晚上好，做一次轻量复盘';
}

function taskDone(events: LearningEvent[], type: LearningEvent['type']): boolean {
  return events.some((event) => event.type === type);
}

function defaultTasks(events: LearningEvent[]): TodayTask[] {
  return [
    {
      id: 'daily-plan',
      type: 'daily',
      text: '每日积累',
      sub: '整理今天的常识、申论和错题要点',
      done: taskDone(events, 'digest'),
      icon: 'CalendarCheck'
    },
    {
      id: 'practice-daily',
      type: 'practice',
      text: '专项练习',
      sub: '完成一组结构化题目训练',
      done: taskDone(events, 'practice'),
      icon: 'Edit3'
    },
    {
      id: 'wrong-review',
      type: 'review',
      text: '错题复习',
      sub: '巩固已进入错题本的薄弱项',
      done: taskDone(events, 'review'),
      icon: 'RotateCcw'
    }
  ];
}

function countdownFromPlan(plan: Awaited<ReturnType<typeof planService.getPlan>>): Countdown | null {
  if (!plan.exam_date) return null;
  const end = new Date(`${plan.exam_date}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
  let start = new Date();
  if (plan.phases) {
    for (const phase of ['基础期', '强化期', '冲刺期'] as const) {
      const matched = String(plan.phases[phase] || '').match(/(\d{4}-\d{2}-\d{2})/);
      if (matched) {
        start = new Date(`${matched[1]}T00:00:00`);
        break;
      }
    }
  }
  const total = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  const elapsed = Math.max(0, total - days);
  return {
    days,
    phase: planService.getPhase(plan),
    progress: Math.min(100, Math.round((elapsed / total) * 100)),
    label: plan.exam_name ? `${plan.exam_name} · ${plan.exam_date}` : plan.exam_date
  };
}

export class HomeDashboardRepository {
  async getHomeData() {
    const project = await projectRepository.getActiveProject();
    const [abilityProfiles, sessions, todayEvents, plan, examProfile, diagnosis] = await Promise.all([
      database.queryByIndex<AbilityProfile>(STORES.abilityProfiles, 'projectId', project.id),
      database.queryByIndex<PracticeSession>(STORES.practiceSessions, 'projectId', project.id),
      database.queryByIndex<LearningEvent>(STORES.learningEvents, 'projectDate', [project.id, today()]),
      planService.getPlan(project.id),
      profiles.getActiveProfile(project.id),
      abilityDiagnosisService.latestOrCurrent()
    ]);

    const moduleStats = this.moduleStats(abilityProfiles, sessions);
    const weakest = moduleStats.length
      ? [...moduleStats].sort((a, b) => a.accuracy - b.accuracy)[0]
      : undefined;

    const totalQuestions = sessions.reduce((sum, session) => sum + session.questionCount, 0);
    const totalWrong = sessions.reduce((sum, session) => sum + Math.max(0, session.questionCount - session.correctCount), 0);
    const reviewDue = 0;

    return {
      activeProject: { id: project.id, name: project.name, status: project.status, activeProfileId: project.activeProfileId },
      requiresOnboarding: project.status === 'onboarding' || !examProfile,
      countdown: countdownFromPlan(plan),
      todayTasks: defaultTasks(todayEvents),
      featureGroups: homeFeatureService.buildGroups({
        plan,
        hasAbility: abilityProfiles.length > 0,
        totalQuestions,
        totalWrong,
        reviewDue
      }),
      moduleStats,
      diagnosisSummary: this.diagnosisSummary(diagnosis),
      focusModules: diagnosis.recommendation.focusModules,
      greeting: greetingText(),
      greetingSub: weakest
        ? `薄弱项：${weakest.name} · 正确率 ${weakest.accuracy}%`
        : '完成一组练习后，这里会生成能力概览'
    };
  }

  private diagnosisSummary(diagnosis: Awaited<ReturnType<typeof abilityDiagnosisService.current>>): string {
    const phaseText = {
      onboarding: '建档期',
      diagnosis: '摸底期',
      foundation: '基础期',
      improvement: '强化期',
      sprint: '冲刺期'
    }[diagnosis.overall.phase];
    const focus = diagnosis.recommendation.focusModules.length
      ? `重点：${diagnosis.recommendation.focusModules.join('、')}`
      : '完成更多练习后会生成重点模块';
    return `${phaseText} · ${focus}`;
  }

  private moduleStats(profiles: AbilityProfile[], sessions: PracticeSession[]): ModuleStat[] {
    if (profiles.length) {
      return profiles
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8)
        .map((profile) => ({ name: profile.module, accuracy: profile.accuracy }));
    }

    const grouped = new Map<string, { total: number; correct: number }>();
    sessions.forEach((session) => {
      const module = session.module || '专项练习';
      const current = grouped.get(module) || { total: 0, correct: 0 };
      current.total += session.questionCount;
      current.correct += session.correctCount;
      grouped.set(module, current);
    });

    return Array.from(grouped.entries()).map(([name, value]) => ({
      name,
      accuracy: value.total ? Math.round((value.correct / value.total) * 100) : 0
    }));
  }
}

export const homeDashboardRepository = new HomeDashboardRepository();
