import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { Project, ProjectStatus } from '@/domain/project';
import type { CreateProjectInput } from '@/domain/plan';
import { fileRepository } from './FileRepository';
import { createExamPlan } from './PlanService';
import { settingsService } from './SettingsService';

const ACTIVE_PROJECT_KEY = 'activeProjectId';
const LEGACY_ACTIVE_PROJECT_KEY = 'zhangl-active-project';
const DEFAULT_PROJECT_NAME = '公考练习';

function makeProjectId(name: string): string {
  return `project:${name}`;
}

export class ProjectRepository {
  async listProjects(): Promise<Project[]> {
    const projects = await database.list<Project>(STORES.projects);
    return projects.map(normalizeProject).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async writeDefaultFiles(projectId: string, input?: CreateProjectInput): Promise<void> {
    if (!input) return;
    const existingFiles = await fileRepository.list(projectId);
    const existingPaths = new Set(existingFiles.map((file) => file.path));

    if (!existingPaths.has('备考计划.json')) {
      await fileRepository.writeText(projectId, '备考计划.json', JSON.stringify(createExamPlan(input), null, 2));
    }
  }

  async createProject(input: string | CreateProjectInput = DEFAULT_PROJECT_NAME, status?: ProjectStatus): Promise<Project> {
    const data: CreateProjectInput = typeof input === 'string' ? { name: input } : input;
    const name = data.name?.trim() || DEFAULT_PROJECT_NAME;
    const now = Date.now();
    const project: Project = {
      id: makeProjectId(name),
      name,
      status: status || (typeof input === 'string' ? 'onboarding' : 'active'),
      createdAt: now,
      updatedAt: now
    };
    await database.put<Project>(STORES.projects, project);
    await this.writeDefaultFiles(project.id, { ...data, name });
    return project;
  }

  async getActiveProject(): Promise<Project> {
    const activeId = await settingsService.get<string | null>(ACTIVE_PROJECT_KEY, null);
    if (activeId) {
      const active = await database.get<Project>(STORES.projects, activeId);
      if (active) return normalizeProject(active);
    }

    const legacyName = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY) : null;
    if (legacyName) {
      const legacyProject = await database.get<Project>(STORES.projects, makeProjectId(legacyName));
      if (legacyProject) {
        await settingsService.set(ACTIVE_PROJECT_KEY, legacyProject.id);
        return normalizeProject(legacyProject);
      }
    }

    const existing = await this.listProjects();
    const project = existing[0] || await this.createProject();
    await settingsService.set(ACTIVE_PROJECT_KEY, project.id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LEGACY_ACTIVE_PROJECT_KEY, project.name);
    }
    return project;
  }

  async setActiveProject(projectId: string): Promise<void> {
    const project = await database.get<Project>(STORES.projects, projectId);
    if (!project) throw new Error('工程不存在');
    await settingsService.set(ACTIVE_PROJECT_KEY, project.id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LEGACY_ACTIVE_PROJECT_KEY, project.name);
    }
  }

  async ensureProjectFiles(projectId: string): Promise<void> {
    await this.writeDefaultFiles(projectId);
  }

  async activateProject(projectId: string, activeProfileId?: string): Promise<Project> {
    const current = await database.get<Project>(STORES.projects, projectId);
    if (!current) throw new Error('工程不存在');
    const next: Project = {
      ...normalizeProject(current),
      status: 'active',
      activeProfileId: activeProfileId || current.activeProfileId,
      updatedAt: Date.now()
    };
    await database.put<Project>(STORES.projects, next);
    return next;
  }

  async updateProject(projectId: string, patch: Partial<Pick<Project, 'name' | 'status' | 'activeProfileId'>>): Promise<Project> {
    const current = await database.get<Project>(STORES.projects, projectId);
    if (!current) throw new Error('工程不存在');
    const name = patch.name?.trim() || current.name;
    const next: Project = {
      ...normalizeProject(current),
      ...patch,
      name,
      updatedAt: Date.now()
    };
    await database.put<Project>(STORES.projects, next);
    if (patch.name && typeof localStorage !== 'undefined') {
      localStorage.setItem(LEGACY_ACTIVE_PROJECT_KEY, name);
    }
    return next;
  }
}

export const projectRepository = new ProjectRepository();

function normalizeProject(project: Project): Project {
  return {
    ...project,
    status: project.status || 'active'
  };
}
