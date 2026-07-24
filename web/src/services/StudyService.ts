import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AbilityProfile } from '@/domain/learning';
import type { Question } from '@/domain/question';
import type { WrongItem } from '@/domain/wrongbook';
import { generationTaskService } from './GenerationTaskService';
import { DEFAULT_KNOWLEDGE_TREE } from './KnowledgeDefaults';
import { projectRepository } from './ProjectRepository';

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

function inferPoint(stem?: string): string | undefined {
  if (!stem) return undefined;
  const clean = stem.replace(/\s+/g, '');
  return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean;
}

export class StudyService {
  async dashboard(): Promise<StudyDashboard> {
    const project = await projectRepository.getActiveProject();
    const [profiles, wrongItems] = await Promise.all([
      database.queryByIndex<AbilityProfile>(STORES.abilityProfiles, 'projectId', project.id),
      database.queryByIndex<WrongItem>(STORES.wrongItems, 'projectId', project.id)
    ]);
    const questions = await this.questionMap(wrongItems.map((item) => item.questionId));
    const wrongMap = new Map<string, number>();
    wrongItems.filter((item) => item.status !== 'mastered').forEach((item) => {
      const question = questions.get(item.questionId);
      const module = item.module || question?.module || '专项练习';
      const point = question?.knowledgePoint || inferPoint(question?.stem) || module;
      const key = `${module}:${point}`;
      wrongMap.set(key, (wrongMap.get(key) || 0) + Math.max(1, item.wrongCount || 1));
    });
    const profileMap = new Map(profiles.map((profile) => [profile.module, profile]));
    const modules = Object.entries(DEFAULT_KNOWLEDGE_TREE).map(([moduleName, groups]) => {
      const moduleProfile = profileMap.get(moduleName);
      const groupRows = Object.entries(groups).map(([groupName, points]) => ({
        name: groupName,
        points: points.map((name) => {
          const wrongCount = wrongMap.get(`${moduleName}:${name}`) || 0;
          const base = moduleProfile?.accuracy ?? 0;
          const proficiency = Math.max(0, Math.min(100, base ? base - wrongCount * 10 : 100 - wrongCount * 18));
          const priority = (base ? Math.max(0, 80 - proficiency) : 35) + wrongCount * 12;
          return {
            module: moduleName,
            group: groupName,
            name,
            wrongCount,
            proficiency,
            priority,
            reason: wrongCount ? `错 ${wrongCount} 次` : base ? `模块正确率 ${base}%` : '大纲未学'
          } satisfies StudyPoint;
        })
      }));
      return {
        name: moduleName,
        total: Object.values(groups).reduce((sum, points) => sum + points.length, 0),
        groups: groupRows
      };
    });
    const weakPoints = modules
      .flatMap((module) => module.groups.flatMap((group) => group.points))
      .sort((a, b) => b.priority - a.priority || a.proficiency - b.proficiency)
      .slice(0, 6);
    return { modules, weakPoints };
  }

  async startLearning(point: Pick<StudyPoint, 'module' | 'name'> | { module?: string; name: string }) {
    const module = point.module || this.findModule(point.name) || '公考';
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

  private async questionMap(questionIds: string[]): Promise<Map<string, Question>> {
    const pairs = await Promise.all(Array.from(new Set(questionIds)).map(async (id) => [id, await database.get<Question>(STORES.questions, id)] as const));
    return new Map(pairs.filter((pair): pair is readonly [string, Question] => Boolean(pair[1])));
  }

  private findModule(pointName: string): string | undefined {
    for (const [module, groups] of Object.entries(DEFAULT_KNOWLEDGE_TREE)) {
      if (Object.values(groups).some((points) => points.includes(pointName))) return module;
    }
    return undefined;
  }
}

export const studyService = new StudyService();
