import { initializeTutorRuntime } from '@/composition-root/public';
import type { CapabilityNode } from '@/modules/curriculum/public';
import type { MasteryTrack } from '@/modules/mastery/public';

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

function remainDays(examDate?: string): number | null {
  if (!examDate) return null;
  const end = new Date(`${examDate}T00:00:00`);
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

export class SprintService {
  async dashboard(overrideIntensity?: SprintIntensity): Promise<SprintDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) {
      return {
        remainDays: null,
        phase: '请先建立备考档案',
        intensity: overrideIntensity || 'normal',
        dailyQuestions: dailyQuestions(overrideIntensity || 'normal'),
        weekMissions: [],
        weakPoints: [],
        emergencyReview: []
      };
    }
    const [curriculum, tracks, reviews, wrongEntries] = await Promise.all([
      runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      runtime.masteryRepository.listPriorityTracks(cycle.examCycle.id, 100),
      runtime.masteryRepository.listReviews(cycle.examCycle.id, 100),
      runtime.getWrongBookEntries.execute({ examCycleId: cycle.examCycle.id, limit: 100 }).then((page) => page.entries)
    ]);
    const days = remainDays(cycle.examCycle.examDate);
    const intensity = overrideIntensity || intensityFor(days);
    const weakPoints = this.weakPoints(tracks, curriculum?.capabilityNodes || [], wrongEntries);
    const missions = this.missions(weakPoints, intensity);
    const nodeMap = new Map((curriculum?.capabilityNodes || []).map((node) => [node.id, node]));
    const dueNames = new Set(reviews
      .filter((item) => item.status === 'scheduled' && Number(item.dueAt) <= Date.now())
      .map((item) => nodeMap.get(item.capabilityNodeId)?.name)
      .filter((name): name is string => Boolean(name)));

    return {
      examDate: cycle.examCycle.examDate,
      remainDays: days,
      phase: days === null ? '请先设置备考计划' : intensity === 'extreme' ? '极限冲刺期' : intensity === 'high' ? '强化冲刺期' : '稳步冲刺期',
      intensity,
      dailyQuestions: dailyQuestions(intensity),
      todayMission: missions.find((mission) => mission.date === iso()) || missions[0],
      weekMissions: missions,
      weakPoints,
      emergencyReview: weakPoints
        .filter((point) => point.proficiency < 40 || dueNames.has(point.name))
        .slice(0, 5)
    };
  }

  private weakPoints(
    tracks: readonly MasteryTrack[],
    nodes: readonly CapabilityNode[],
    wrongEntries: readonly { attempt: { capabilityNodeId: string }; diagnoses: readonly { causeCode: string }[] }[]
  ): SprintWeakPoint[] {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const moduleNames = new Map(nodes.filter((node) => node.nodeType === 'module').map((node) => [node.module, node.name]));
    const wrongCounts = new Map<string, number>();
    const causes = new Map<string, string>();
    wrongEntries.forEach((entry) => {
      const key = entry.attempt.capabilityNodeId;
      wrongCounts.set(key, (wrongCounts.get(key) || 0) + 1);
      const cause = errorCauseLabel(entry.diagnoses[0]?.causeCode);
      if (cause) causes.set(key, cause);
    });
    return tracks
      .filter((track) => track.effectiveSample > 0)
      .map((track) => {
        const node = nodeMap.get(track.capabilityNodeId);
        return {
          module: moduleNames.get(node?.module || '') || node?.module || '专项练习',
          name: node?.name || String(track.capabilityNodeId),
          proficiency: Math.round(track.accuracy * 100),
          wrongCount: wrongCounts.get(track.capabilityNodeId) || 0,
          dominantError: causes.get(track.capabilityNodeId)
        };
      })
      .sort((left, right) => left.proficiency - right.proficiency || right.wrongCount - left.wrongCount)
      .slice(0, 12);
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

function errorCauseLabel(code?: string): string | undefined {
  const labels: Record<string, string> = {
    concept_gap: '概念缺口',
    recognition_error: '题型识别',
    method_selection_error: '方法选择',
    reasoning_error: '推理链',
    calculation_error: '计算',
    evidence_extraction_error: '材料定位',
    trap_misjudgment: '陷阱识别',
    time_management_error: '时间管理',
    careless_error: '粗心',
    transfer_failure: '迁移失败',
    retention_failure: '遗忘'
  };
  return code ? labels[code] : undefined;
}
