import { initializeTutorRuntime } from '@/composition-root/public';
import { CapabilityNodeType, type CapabilityNode } from '@/modules/curriculum/public';
import { generationTaskService } from './GenerationTaskService';

export interface StudyPoint {
  module: string;
  group: string;
  name: string;
  wrongCount: number;
  proficiency: number;
  priority: number;
  reason: string;
}

export interface StudyModule {
  name: string;
  total: number;
  groups: Array<{ name: string; points: StudyPoint[] }>;
}

export interface StudyDashboard {
  modules: StudyModule[];
  weakPoints: StudyPoint[];
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
    if (!cycle) return { modules: [], weakPoints: [] };
    const [curriculum, tracks] = await Promise.all([
      runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      runtime.masteryRepository.listTracks(cycle.examCycle.id, 100)
    ]);
    if (!curriculum) return { modules: [], weakPoints: [] };
    const byId = new Map(curriculum.capabilityNodes.map((node) => [node.id, node]));
    const trackByNode = new Map(tracks.map((track) => [track.capabilityNodeId, track]));
    const pointNodes = curriculum.capabilityNodes.filter((node) => (
      node.status === 'active'
      && node.subject === 'aptitude'
      && (
        node.nodeType === CapabilityNodeType.KnowledgePoint
        || node.nodeType === CapabilityNodeType.SubPoint
        || node.nodeType === CapabilityNodeType.QuestionType
      )
    ));
    const moduleMap = new Map<string, Map<string, StudyPoint[]>>();
    pointNodes.forEach((node) => {
      const module = moduleAncestor(node, byId);
      if (!module) return;
      const group = groupAncestor(node, module, byId);
      const track = trackByNode.get(node.id);
      const proficiency = track
        ? Math.round((score(track.concept) + score(track.method) + score(track.accuracy) + score(track.retention)) / 4)
        : 0;
      const wrongCount = track ? Math.max(0, Math.round(track.effectiveSample * (1 - track.accuracy))) : 0;
      const confidencePenalty = track ? Math.round((1 - track.confidence) * 30) : 35;
      const priority = Math.round((100 - proficiency) * 0.7 + confidencePenalty + wrongCount * 4);
      const point: StudyPoint = {
        module: module.name,
        group: group.name,
        name: node.name,
        wrongCount,
        proficiency,
        priority,
        reason: !track
          ? '尚未形成学习证据'
          : wrongCount
            ? `近阶段约错 ${wrongCount} 次`
            : `掌握可信度 ${score(track.confidence)}%`
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
      .filter((point) => point.proficiency < 75 || point.wrongCount > 0)
      .sort((a, b) => b.priority - a.priority || a.proficiency - b.proficiency)
      .slice(0, 6);
    return { modules, weakPoints };
  }

  async startLearning(point: Pick<StudyPoint, 'module' | 'name'> | { module?: string; name: string }) {
    const module = point.module || '公考';
    return generationTaskService.enqueue({
      intent: 'study',
      title: '生成考点精讲',
      detail: `${module} · ${point.name}`,
      module,
      sourceId: `study:${module}:${point.name}`,
      payload: {
        topic: point.name,
        prompt: `请系统讲解公考${module}考点「${point.name}」，包括核心概念、常见陷阱、典型例题、解题步骤和复盘提问。`
      }
    });
  }

}

export const studyService = new StudyService();
