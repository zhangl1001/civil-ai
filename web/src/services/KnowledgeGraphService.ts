import { initializeTutorRuntime } from '@/composition-root/public';
import type { CapabilityNode } from '@/modules/curriculum/public';
import type { MasteryState, MasteryTrack } from '@/modules/mastery/public';

export interface KnowledgePointNode {
  id: string;
  moduleCode: string;
  module: string;
  group: string;
  name: string;
  total: number;
  correct: number;
  accuracy: number;
  proficiency: number;
  confidence: number;
  status: '未学' | '学习中' | '已掌握' | '薄弱';
  wrongCount: number;
}

export interface KnowledgeModuleNode {
  code: string;
  name: string;
  total: number;
  correct: number;
  accuracy: number;
  mastered: number;
  weak: number;
  points: KnowledgePointNode[];
}

export interface KnowledgeGraphDashboard {
  totalPoints: number;
  weakPoints: number;
  masteredPoints: number;
  modules: KnowledgeModuleNode[];
  weakest?: KnowledgePointNode;
}

export class KnowledgeGraphService {
  async dashboard(): Promise<KnowledgeGraphDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const [curriculum, tracks, wrongEntries] = await Promise.all([
      runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      runtime.masteryRepository.listTracks(cycle.examCycle.id, 100),
      runtime.getWrongBookEntries.execute({ examCycleId: cycle.examCycle.id, limit: 100 }).then((page) => page.entries)
    ]);
    if (!curriculum) throw new Error('当前考试大纲不可用。');

    const nodesById = new Map(curriculum.capabilityNodes.map((node) => [node.id, node]));
    const tracksByCapability = new Map(tracks.map((track) => [track.capabilityNodeId, track]));
    const wrongByCapability = new Map<string, number>();
    wrongEntries.forEach((entry) => {
      const capabilityId = entry.attempt.capabilityNodeId;
      wrongByCapability.set(capabilityId, (wrongByCapability.get(capabilityId) || 0) + 1);
    });
    const moduleNames = new Map(curriculum.capabilityNodes
      .filter((node) => node.nodeType === 'module')
      .map((node) => [node.module, node.name]));
    const pointNodes = curriculum.capabilityNodes.filter((node) => (
      node.status === 'active'
      && (node.nodeType === 'knowledge_point' || node.nodeType === 'sub_point')
    ));
    const moduleCodes = [...new Set(pointNodes.map((node) => node.module))];
    const modules = moduleCodes.map((code) => {
      const points = pointNodes
        .filter((node) => node.module === code)
        .map((node) => toPoint(node, tracksByCapability.get(node.id), nodesById, moduleNames, wrongByCapability))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      const total = points.reduce((sum, point) => sum + point.total, 0);
      const correct = points.reduce((sum, point) => sum + point.correct, 0);
      return {
        code,
        name: moduleNames.get(code) || code,
        total,
        correct,
        accuracy: total ? Math.round(correct / total * 100) : 0,
        mastered: points.filter((point) => point.status === '已掌握').length,
        weak: points.filter((point) => point.status === '薄弱').length,
        points
      } satisfies KnowledgeModuleNode;
    }).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    const allPoints = modules.flatMap((module) => module.points);
    const measured = allPoints.filter((point) => point.total > 0);
    const weakest = measured.slice().sort((left, right) => (
      left.proficiency - right.proficiency
      || left.confidence - right.confidence
      || right.wrongCount - left.wrongCount
    ))[0];

    return {
      totalPoints: allPoints.length,
      weakPoints: allPoints.filter((point) => point.status === '薄弱').length,
      masteredPoints: allPoints.filter((point) => point.status === '已掌握').length,
      modules,
      weakest
    };
  }
}

function toPoint(
  node: CapabilityNode,
  track: MasteryTrack | undefined,
  nodesById: ReadonlyMap<string, CapabilityNode>,
  moduleNames: ReadonlyMap<string, string>,
  wrongByCapability: ReadonlyMap<string, number>
): KnowledgePointNode {
  const total = track ? Math.max(0, Math.round(track.effectiveSample)) : 0;
  const accuracy = track ? Math.round(track.accuracy * 100) : 0;
  return {
    id: node.id,
    moduleCode: node.module,
    module: moduleNames.get(node.module) || node.module,
    group: node.parentId ? nodesById.get(node.parentId)?.name || '能力大纲' : '能力大纲',
    name: node.name,
    total,
    correct: Math.round(total * accuracy / 100),
    accuracy,
    proficiency: track ? Math.round(track.stability * 100) : 0,
    confidence: track?.confidence ?? 0,
    status: statusFor(track?.state),
    wrongCount: wrongByCapability.get(node.id) || 0
  };
}

function statusFor(state: MasteryState | undefined): KnowledgePointNode['status'] {
  if (!state || state === 'unassessed') return '未学';
  if (state === 'regressed') return '薄弱';
  if (state === 'mastered' || state === 'maintaining') return '已掌握';
  return '学习中';
}

export const knowledgeGraphService = new KnowledgeGraphService();
