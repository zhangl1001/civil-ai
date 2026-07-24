import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AbilityProfile } from '@/domain/learning';
import type { ExamPlan } from '@/domain/plan';
import type { Question } from '@/domain/question';
import type { WrongItem } from '@/domain/wrongbook';
import { practiceFlowService } from './PracticeFlowService';
import { projectRepository } from './ProjectRepository';
import { planService } from './PlanService';

export type SprintIntensity = 'normal' | 'high' | 'extreme';

export interface SprintWeakPoint {
  module: string;
  name: string;
  proficiency: number;
  wrongCount: number;
  dominantError?: string;
}

export interface SprintMission {
  date: string;
  focusModule: string;
  questionCount: number;
  reviewCount: number;
  intensity: SprintIntensity;
  priorityPoints: string[];
}

export interface SprintDashboard {
  examDate?: string;
  remainDays: number | null;
  phase: string;
  intensity: SprintIntensity;
  dailyQuestions: number;
  todayMission?: SprintMission;
  weekMissions: SprintMission[];
  weakPoints: SprintWeakPoint[];
  emergencyReview: SprintWeakPoint[];
}

function iso(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function remainDays(plan: ExamPlan): number | null {
  if (!plan.exam_date) return null;
  const end = new Date(`${plan.exam_date}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}

function intensityFor(days: number | null): SprintIntensity {
  if (days !== null && days <= 7) return 'extreme';
  if (days !== null && days <= 14) return 'high';
  return 'normal';
}

function dailyQuestions(intensity: SprintIntensity): number {
  if (intensity === 'extreme') return 40;
  if (intensity === 'high') return 24;
  return 16;
}

function normalizeCategory(reason?: string): string | undefined {
  if (!reason || reason === '练习答错') return undefined;
  if (reason.includes('概念')) return '概念性';
  if (reason.includes('理解')) return '理解性';
  if (reason.includes('执行')) return '执行性';
  return reason;
}

export class SprintService {
  async dashboard(overrideIntensity?: SprintIntensity): Promise<SprintDashboard> {
    const project = await projectRepository.getActiveProject();
    const [plan, profiles, wrongItems] = await Promise.all([
      planService.getPlan(project.id),
      database.queryByIndex<AbilityProfile>(STORES.abilityProfiles, 'projectId', project.id),
      database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id)
    ]);
    const days = remainDays(plan);
    const intensity = overrideIntensity || intensityFor(days);
    const weakPoints = await this.weakPoints(wrongItems.filter((item) => item.status !== 'mastered'), profiles);
    const missions = this.missions(weakPoints, intensity);

    return {
      examDate: plan.exam_date,
      remainDays: days,
      phase: days === null ? '请先设置备考计划' : intensity === 'extreme' ? '极限冲刺期' : intensity === 'high' ? '强化冲刺期' : '稳步冲刺期',
      intensity,
      dailyQuestions: dailyQuestions(intensity),
      todayMission: missions.find((mission) => mission.date === iso()) || missions[0],
      weekMissions: missions,
      weakPoints,
      emergencyReview: weakPoints.filter((point) => point.proficiency < 40).slice(0, 5)
    };
  }

  startWeakPractice(point?: SprintWeakPoint): void {
    practiceFlowService.writeStartContext({
      module: point?.module || '资料分析',
      knowledgePoint: point?.name,
      date: iso(),
      mode: 'practice',
      source: 'sprint',
      questionCount: 10
    });
  }

  private async weakPoints(wrongItems: WrongItem[], profiles: AbilityProfile[]): Promise<SprintWeakPoint[]> {
    const questions = await this.questionMap(wrongItems.map((item) => item.questionId));
    const grouped = new Map<string, SprintWeakPoint>();
    const profileMap = new Map(profiles.map((profile) => [profile.module, profile]));
    for (const item of wrongItems) {
      const question = questions.get(item.questionId);
      const module = item.module || question?.module || '专项练习';
      const name = question?.knowledgePoint || this.inferPoint(question?.stem) || module;
      const key = `${module}:${name}`;
      const current = grouped.get(key) || {
        module,
        name,
        proficiency: profileMap.has(module) ? profileMap.get(module)!.accuracy : 50,
        wrongCount: 0,
        dominantError: normalizeCategory(item.reason)
      };
      current.wrongCount += Math.max(1, item.wrongCount || 1);
      current.proficiency = Math.max(0, Math.min(current.proficiency, 100 - current.wrongCount * 12));
      current.dominantError = current.dominantError || normalizeCategory(item.reason);
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).sort((a, b) => a.proficiency - b.proficiency || b.wrongCount - a.wrongCount).slice(0, 12);
  }

  private async questionMap(questionIds: string[]): Promise<Map<string, Question>> {
    const pairs = await Promise.all(Array.from(new Set(questionIds)).map(async (id) => [id, await database.get<Question>(STORES.questions, id)] as const));
    return new Map(pairs.filter((pair): pair is readonly [string, Question] => Boolean(pair[1])));
  }

  private inferPoint(stem?: string): string | undefined {
    if (!stem) return undefined;
    const clean = stem.replace(/\s+/g, '');
    return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean;
  }

  private missions(points: SprintWeakPoint[], intensity: SprintIntensity): SprintMission[] {
    const modules = Array.from(new Set(points.map((point) => point.module)));
    if (!modules.length) return [];
    const count = dailyQuestions(intensity);
    return Array.from({ length: 7 }, (_, index) => {
      const focusModule = modules[index % modules.length];
      const modulePoints = points.filter((point) => point.module === focusModule).slice(0, 5);
      return {
        date: iso(addDays(new Date(), index)),
        focusModule,
        questionCount: count,
        reviewCount: Math.round(count * 0.3),
        intensity,
        priorityPoints: modulePoints.map((point) => point.name)
      };
    });
  }
}

export const sprintService = new SprintService();
