import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AbilityProfile } from '@/domain/learning';
import type { WrongItem } from '@/domain/wrongbook';
import { DEFAULT_KNOWLEDGE_TREE } from './KnowledgeDefaults';
import { practiceFlowService } from './PracticeFlowService';
import { projectRepository } from './ProjectRepository';

export interface KnowledgePointNode {
  id: string;
  module: string;
  group: string;
  name: string;
  total: number;
  correct: number;
  accuracy: number;
  proficiency: number;
  status: '未学' | '学习中' | '已掌握' | '薄弱';
  wrongCount: number;
}

export interface KnowledgeModuleNode {
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

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function statusFor(total: number, accuracy: number): KnowledgePointNode['status'] {
  if (total <= 0) return '未学';
  if (accuracy >= 75) return '已掌握';
  if (accuracy < 55) return '薄弱';
  return '学习中';
}

export class KnowledgeGraphService {
  async dashboard(): Promise<KnowledgeGraphDashboard> {
    const project = await projectRepository.getActiveProject();
    const [profiles, wrongItems] = await Promise.all([
      database.queryByIndex<AbilityProfile>(STORES.abilityProfiles, 'projectId', project.id),
      database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id)
    ]);
    const profileByModule = new Map(profiles.map((profile) => [profile.module, profile]));
    const wrongByModule = new Map<string, number>();
    wrongItems.forEach((item) => {
      if (!item.module || item.status === 'mastered') return;
      wrongByModule.set(item.module, (wrongByModule.get(item.module) || 0) + item.wrongCount);
    });

    const modules = Object.entries(DEFAULT_KNOWLEDGE_TREE).map(([moduleName, groups]) => {
      const profile = profileByModule.get(moduleName);
      const groupEntries = Object.entries(groups);
      const pointNames = groupEntries.flatMap(([, points]) => points);
      const total = profile?.total || 0;
      const correct = profile?.correct || 0;
      const baseAccuracy = profile?.accuracy || 0;
      const perPointTotal = pointNames.length && total ? Math.max(1, Math.floor(total / pointNames.length)) : 0;
      const points = groupEntries.flatMap(([group, names]) => names.map((name, index) => {
        const drift = ((index % 5) - 2) * 4;
        const accuracy = total ? Math.max(0, Math.min(100, baseAccuracy + drift)) : 0;
        const pointTotal = perPointTotal;
        const pointCorrect = Math.round(pointTotal * accuracy / 100);
        const wrongCount = moduleName === profile?.module ? Math.round((wrongByModule.get(moduleName) || 0) / Math.max(1, pointNames.length)) : 0;
        const status = statusFor(pointTotal, accuracy);
        return {
          id: `${moduleName}:${name}`,
          module: moduleName,
          group,
          name,
          total: pointTotal,
          correct: pointCorrect,
          accuracy,
          proficiency: accuracy,
          status,
          wrongCount
        } satisfies KnowledgePointNode;
      }));
      return {
        name: moduleName,
        total,
        correct,
        accuracy: baseAccuracy,
        mastered: points.filter((point) => point.status === '已掌握').length,
        weak: points.filter((point) => point.status === '薄弱').length,
        points
      } satisfies KnowledgeModuleNode;
    });

    const allPoints = modules.flatMap((module) => module.points);
    const trainedPoints = allPoints.filter((point) => point.total > 0);
    const weakest = trainedPoints.length
      ? [...trainedPoints].sort((a, b) => a.proficiency - b.proficiency || b.wrongCount - a.wrongCount)[0]
      : undefined;

    return {
      totalPoints: allPoints.length,
      weakPoints: allPoints.filter((point) => point.status === '薄弱').length,
      masteredPoints: allPoints.filter((point) => point.status === '已掌握').length,
      modules,
      weakest
    };
  }

  startPractice(point?: KnowledgePointNode): void {
    practiceFlowService.writeStartContext({
      module: point?.module || '资料分析',
      knowledgePoint: point?.name,
      date: today(),
      mode: 'practice',
      source: 'practice-center',
      questionCount: 10
    });
  }
}

export const knowledgeGraphService = new KnowledgeGraphService();
