import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AbilityProfile } from '@/domain/learning';
import type { DailyPlan, ExamPlan, PlanTask } from '@/domain/plan';
import { abilityDiagnosisService, type AbilityDiagnosis } from './AbilityDiagnosisService';
import { projectRepository } from './ProjectRepository';
import { planService } from './PlanService';

export interface PlanModuleStat {
  name: string;
  total: number;
  accuracy: number;
}

export interface PlanHistoryRow {
  date: string;
  done: number;
  total: number;
  percent: number;
}

export interface PlanCountdown {
  days: number;
  phase: string;
  progress: number;
  label: string;
}

export interface PlanDashboard {
  projectId: string;
  projectName: string;
  plan: ExamPlan;
  countdown: PlanCountdown | null;
  modules: PlanModuleStat[];
  todayPlan: DailyPlan | null;
  todayTasks: PlanTask[];
  history: PlanHistoryRow[];
  diagnosis: AbilityDiagnosis;
  diagnosisSummary: string;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function countdown(plan: ExamPlan): PlanCountdown | null {
  if (!plan.exam_date) return null;
  const end = new Date(`${plan.exam_date}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  let start = new Date();
  for (const phase of ['基础期', '强化期', '冲刺期'] as const) {
    const matched = String(plan.phases?.[phase] || '').match(/(\d{4}-\d{2}-\d{2})/);
    if (matched) {
      start = new Date(`${matched[1]}T00:00:00`);
      break;
    }
  }
  const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
  const total = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  const elapsed = Math.max(0, total - days);
  return {
    days,
    phase: planService.getPhase(plan),
    progress: Math.min(100, Math.round((elapsed / total) * 100)),
    label: plan.exam_name ? `${plan.exam_name} · ${plan.exam_date}` : plan.exam_date
  };
}

function history(plan: ExamPlan): PlanHistoryRow[] {
  return Object.entries(plan.tasks || {})
    .filter(([date]) => date !== today())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)
    .map(([date, daily]) => {
      const items = daily.items || [];
      const done = items.filter((item) => item.done).length;
      return {
        date,
        done,
        total: items.length,
        percent: items.length ? Math.round((done / items.length) * 100) : 0
      };
    });
}

export class PlanDashboardService {
  async getDashboard(): Promise<PlanDashboard> {
    const project = await projectRepository.getActiveProject();
    const [plan, profiles, diagnosis] = await Promise.all([
      planService.getPlan(project.id),
      database.queryByIndex<AbilityProfile>(STORES.abilityProfiles, 'projectId', project.id),
      abilityDiagnosisService.latestOrCurrent()
    ]);
    const daily = plan.tasks?.[today()] || null;
    return {
      projectId: project.id,
      projectName: project.name,
      plan,
      countdown: countdown(plan),
      modules: profiles
        .filter((profile) => profile.total > 0)
        .sort((a, b) => a.accuracy - b.accuracy)
        .map((profile) => ({ name: profile.module, total: profile.total, accuracy: profile.accuracy })),
      todayPlan: daily,
      todayTasks: daily?.items || [],
      history: history(plan),
      diagnosis,
      diagnosisSummary: diagnosisSummary(diagnosis)
    };
  }

  async generateTodayPlan(): Promise<PlanDashboard> {
    const project = await projectRepository.getActiveProject();
    await planService.generateTodayPlan(project.id);
    return this.getDashboard();
  }
}

export const planDashboardService = new PlanDashboardService();

function diagnosisSummary(diagnosis: AbilityDiagnosis): string {
  const phase = {
    onboarding: '建档期',
    diagnosis: '摸底期',
    foundation: '基础期',
    improvement: '强化期',
    sprint: '冲刺期'
  }[diagnosis.overall.phase];
  const focus = diagnosis.recommendation.focusModules.length
    ? `重点 ${diagnosis.recommendation.focusModules.join('、')}`
    : '继续补充训练样本';
  return `${phase} · ${focus} · 建议每日 ${diagnosis.recommendation.dailyQuestionTarget} 题`;
}
