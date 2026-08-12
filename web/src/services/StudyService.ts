import { initializeTutorRuntime } from '@/composition-root/public';
import { CapabilityNodeType, type CapabilityNode } from '@/modules/curriculum/public';
import { LearningAssetKind, LearningAssetStatus } from '@/modules/content/public';
import { LearningProgressStatus, LearningResourceType } from '@/modules/learning-progress/public';
import {
  CapabilityRecommendationMode,
  LearnerPriorityAction,
  type CapabilityRecommendationMode as CapabilityRecommendationModeCode,
  type LearnerPriorityResult
} from '@/modules/mastery/public';
import { generationTaskService } from './GenerationTaskService';

export interface StudyPoint {
  capabilityNodeId: string;
  subject: string;
  module: string;
  group: string;
  name: string;
  wrongCount: number;
  evidenceScore: number;
  priority: number;
  recommendationAction: LearnerPriorityResult['action'];
  reason: string;
  hasLearningEvidence: boolean;
  learningStatus: 'not_started' | 'started' | 'completed';
}

export interface StudyModule {
  name: string;
  total: number;
  groups: Array<{ name: string; points: StudyPoint[] }>;
}

export interface StudyDashboard {
  modules: StudyModule[];
  weakPoints: StudyPoint[];
  completedPointCount: number;
  trackedPointCount: number;
  hasLearningEvidence: boolean;
}

export interface StudyLectureSummary {
  id: string;
  title: string;
  module: string;
  topic: string;
  capabilityNodeId?: string;
  updatedAt: number;
}

export interface DailyPlanLearningContext {
  readonly dailyPlanItemId: string;
  readonly capabilityNodeId?: string;
}

function score(value: number | undefined, fallback = 0): number {
  return Math.round(Math.max(0, Math.min(1, value ?? fallback)) * 100);
}

function moduleAncestor(node: CapabilityNode, byId: Map<string, CapabilityNode>): CapabilityNode | undefined {
  let current: CapabilityNode | undefined = node;
  while (current) {
    if (current.nodeType === CapabilityNodeType.Module) return current;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}

function groupAncestor(node: CapabilityNode, module: CapabilityNode, byId: Map<string, CapabilityNode>): CapabilityNode {
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  let candidate = node;
  while (current && current.id !== module.id) {
    candidate = current;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return candidate;
}

export class StudyService {
  async dashboard(): Promise<StudyDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return { modules: [], weakPoints: [], completedPointCount: 0, trackedPointCount: 0, hasLearningEvidence: false };
    const [curriculum, prioritySnapshot] = await Promise.all([
      runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      runtime.buildLearnerPrioritySnapshot.execute()
    ]);
    if (!curriculum) return { modules: [], weakPoints: [], completedPointCount: 0, trackedPointCount: 0, hasLearningEvidence: false };
    const byId = new Map(curriculum.capabilityNodes.map((node) => [node.id, node]));
    const priorities = prioritySnapshot?.priorities ?? [];
    const priorityByNode = new Map(priorities.map((priority) => [priority.capabilityNodeId, priority]));
    const pointNodes = curriculum.capabilityNodes.filter((node) => (
      node.status === 'active'
      && (
        node.nodeType === CapabilityNodeType.KnowledgePoint
        || node.nodeType === CapabilityNodeType.SubPoint
        || node.nodeType === CapabilityNodeType.QuestionType
        || node.nodeType === CapabilityNodeType.CognitiveSkill
        || node.nodeType === CapabilityNodeType.ProblemSolvingSkill
        || node.nodeType === CapabilityNodeType.ExpressionSkill
      )
    ));
    const moduleMap = new Map<string, Map<string, StudyPoint[]>>();
    pointNodes.forEach((node) => {
      const module = moduleAncestor(node, byId);
      if (!module) return;
      const group = groupAncestor(node, module, byId);
      const priority = priorityByNode.get(node.id);
      if (!priority) return;
      const evidenceScore = Math.round((
        priority.accuracy * 0.35
        + priority.stability * 0.25
        + priority.retention * 0.2
        + priority.transfer * 0.2
      ) * 100);
      const wrongCount = Math.max(0, Math.round(priority.effectiveSample * (1 - priority.accuracy)));
      const hasLearningEvidence = priority.effectiveSample > 0;
      const point: StudyPoint = {
        capabilityNodeId: node.id,
        subject: node.subject,
        module: module.name,
        group: group.name,
        name: node.name,
        wrongCount,
        evidenceScore,
        priority: priority.priority,
        recommendationAction: priority.action,
        reason: studyReason(priority, wrongCount),
        hasLearningEvidence,
        learningStatus: priority.learningStatus ?? 'not_started'
      };
      const groups = moduleMap.get(module.name) ?? new Map<string, StudyPoint[]>();
      groups.set(group.name, [...(groups.get(group.name) ?? []), point]);
      moduleMap.set(module.name, groups);
    });
    const modules = Array.from(moduleMap.entries()).map(([name, groups]) => ({
      name,
      total: Array.from(groups.values()).reduce((sum, points) => sum + points.length, 0),
      groups: Array.from(groups.entries()).map(([groupName, points]) => ({
        name: groupName,
        points: points.sort((left, right) => right.priority - left.priority)
      }))
    }));
    const weakPoints = modules
      .flatMap((module) => module.groups.flatMap((group) => group.points))
      .filter((point) => (
        point.hasLearningEvidence || point.learningStatus === LearningProgressStatus.Completed
      ) && point.recommendationAction !== LearnerPriorityAction.Maintain)
      .sort((a, b) => b.priority - a.priority || a.evidenceScore - b.evidenceScore)
      .slice(0, 6);
    return {
      modules,
      weakPoints,
      completedPointCount: priorities.filter((priority) => priority.learningStatus === LearningProgressStatus.Completed).length,
      trackedPointCount: priorities.filter((priority) => Boolean(priority.learningStatus)).length,
      hasLearningEvidence: priorities.some((priority) => priority.effectiveSample > 0)
    };
  }

  async setRecommendationPreference(input: {
    readonly capabilityNodeId: string;
    readonly mode: CapabilityRecommendationModeCode;
  }): Promise<void> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const pausedUntil = input.mode === CapabilityRecommendationMode.Paused
      ? (Date.now() + 7 * 86_400_000) as Parameters<typeof runtime.updateLearningPreferences.setCapabilityRecommendation>[0]['pausedUntil']
      : undefined;
    await runtime.updateLearningPreferences.setCapabilityRecommendation({
      examCycleId: cycle.examCycle.id,
      capabilityNodeId: input.capabilityNodeId as Parameters<typeof runtime.updateLearningPreferences.setCapabilityRecommendation>[0]['capabilityNodeId'],
      mode: input.mode,
      ...(pausedUntil === undefined ? {} : { pausedUntil })
    });
  }

  async startLearning(
    point: Pick<StudyPoint, 'module' | 'name' | 'capabilityNodeId'> | { module?: string; name: string; capabilityNodeId?: string },
    planContext?: DailyPlanLearningContext
  ) {
    const module = point.module || '公考';
    return generationTaskService.enqueue({
      intent: 'study',
      title: '生成考点精讲',
      detail: `${module} · ${point.name}`,
      module,
      sourceId: planContext?.dailyPlanItemId || `study:${module}:${point.name}`,
      payload: {
        topic: point.name,
        prompt: `请系统讲解公考${module}考点「${point.name}」，包括核心概念、常见陷阱、典型例题、解题步骤和复盘提问。`,
        capabilityNodeId: point.capabilityNodeId ?? planContext?.capabilityNodeId ?? null,
        ...(planContext ? {
          dailyPlanItemId: planContext.dailyPlanItemId,
          capabilityNodeId: planContext.capabilityNodeId ?? null
        } : {})
      }
    });
  }

  async startDailyPlanLecture(context: DailyPlanLearningContext) {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    if (!context.capabilityNodeId) throw new Error('今日计划缺少能力节点，请刷新计划后重试。');
    const curriculum = await runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId);
    const node = curriculum?.capabilityNodes.find((candidate) => candidate.id === context.capabilityNodeId);
    if (!node || !curriculum) throw new Error('今日计划对应考点已失效，请刷新计划后重试。');
    const byId = new Map(curriculum.capabilityNodes.map((candidate) => [candidate.id, candidate]));
    return this.startLearning({
      module: moduleAncestor(node, byId)?.name || node.module || '公考',
      name: node.name,
      capabilityNodeId: node.id
    }, context);
  }

  async markLectureStarted(input: {
    readonly assetId: string;
    readonly capabilityNodeId?: string;
    readonly dailyPlanItemId?: string;
  }) {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return undefined;
    return runtime.trackLearningProgress.start({
      examCycleId: cycle.examCycle.id,
      resourceType: LearningResourceType.Lecture,
      resourceKey: lectureResourceKey(input.assetId, input.capabilityNodeId),
      assetId: input.assetId,
      capabilityNodeId: input.capabilityNodeId,
      dailyPlanItemId: input.dailyPlanItemId
    });
  }

  async completeLecture(input: {
    readonly assetId: string;
    readonly capabilityNodeId?: string;
    readonly dailyPlanItemId?: string;
    readonly actualMinutes?: number;
  }): Promise<void> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    await runtime.trackLearningProgress.complete({
      examCycleId: cycle.examCycle.id,
      resourceType: LearningResourceType.Lecture,
      resourceKey: lectureResourceKey(input.assetId, input.capabilityNodeId),
      assetId: input.assetId,
      capabilityNodeId: input.capabilityNodeId,
      dailyPlanItemId: input.dailyPlanItemId
    });
    if (!input.dailyPlanItemId) return;
    await runtime.completeDailyPlanItem.execute({
      dailyPlanItemId: input.dailyPlanItemId,
      actualMinutes: input.actualMinutes,
      resultSummary: { assetId: input.assetId, contentConsumed: true },
      sourceId: `study-lecture:${input.assetId}:completed`
    });
  }

  async listLectures(limit = 20): Promise<StudyLectureSummary[]> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return [];
    const boundedLimit = Math.min(40, Math.max(1, Math.round(limit)));
    const assets = await runtime.learningAssetStore.list({
      examCycleId: cycle.examCycle.id,
      kinds: [LearningAssetKind.StudyLecture],
      status: LearningAssetStatus.Ready,
      limit: Math.min(100, boundedLimit * 3)
    });
    const seen = new Set<string>();
    return assets.flatMap((asset): StudyLectureSummary[] => {
      if (seen.has(asset.businessKey)) return [];
      seen.add(asset.businessKey);
      return [{
        id: asset.id,
        title: asset.title,
        module: payloadString(asset.payload.module) || '公考',
        topic: payloadString(asset.payload.topic) || asset.title,
        capabilityNodeId: payloadString(asset.payload.capabilityNodeId) || undefined,
        updatedAt: asset.updatedAt
      }];
    }).slice(0, boundedLimit);
  }

}

function payloadString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function lectureResourceKey(assetId: string, capabilityNodeId?: string): string {
  return capabilityNodeId ? `capability:${capabilityNodeId}` : `asset:${assetId}`;
}

function studyReason(priority: LearnerPriorityResult, wrongCount: number): string {
  if (priority.reasonCodes.includes('learning_needs_validation')) return '讲义已学，等待练习验证';
  if (!priority.reliable) return '有效样本不足，建议先诊断';
  if (priority.action === LearnerPriorityAction.Review) return '证据已衰减，需要及时复习';
  if (wrongCount) return `近阶段约错 ${wrongCount} 次`;
  return `证据置信度 ${score(priority.evidenceConfidence)}%`;
}

export const studyService = new StudyService();
