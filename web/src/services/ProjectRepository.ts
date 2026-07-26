import type { Project } from '@/domain/project';

type CurrentProjectResolver = () => Promise<Project | undefined>;

/**
 * Temporary facade for classic page services that only need the current project ID.
 * The source of truth is the Candidate module; this facade never creates or stores projects.
 */
export class ProjectRepository {
  private resolver?: CurrentProjectResolver;

  bindCurrentProject(resolver: CurrentProjectResolver): void {
    this.resolver = resolver;
  }

  async getActiveProject(): Promise<Project> {
    if (!this.resolver) throw new Error('当前备考工程尚未初始化');
    const project = await this.resolver();
    if (!project) throw new Error('请先建立备考档案');
    return project;
  }
}

export const projectRepository = new ProjectRepository();
