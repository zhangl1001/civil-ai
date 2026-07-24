import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { DigestSection, DigestTab } from '@/domain/digest';
import type { LearningEvent } from '@/domain/learning';
import { generationTaskService } from './GenerationTaskService';
import { digestRepository } from './DigestRepository';
import { fileRepository } from './FileRepository';
import { projectRepository } from './ProjectRepository';
import type { EnqueueResult } from '@/tasks/taskTypes';

export interface DigestDashboard {
  date: string;
  tab: DigestTab;
  content: string;
  sections: DigestSection[];
  history: Array<{ date: string; tab: DigestTab; path: string; updatedAt: number }>;
}

const TITLE_BY_TAB: Record<DigestTab, string> = {
  news: '每日热点',
  tips: '每日知识点'
};

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function pathFor(tab: DigestTab, date: string): string {
  return digestRepository.compatibilityPath(tab, date);
}

function normalizeTab(value?: string | null): DigestTab {
  return value === 'tips' ? 'tips' : 'news';
}

export class DigestService {
  readActiveTab(): DigestTab {
    return normalizeTab(localStorage.getItem('digest-active-tab'));
  }

  writeActiveTab(tab: DigestTab): void {
    localStorage.setItem('digest-active-tab', tab);
  }

  async dashboard(tab = this.readActiveTab(), date = today()): Promise<DigestDashboard> {
    const project = await projectRepository.getActiveProject();
    let items = await digestRepository.listForDate(project.id, tab, date);
    if (!items.length) {
      items = await digestRepository.importCompatibilityDate(project.id, tab, date);
    }
    const history = await digestRepository.history(project.id, tab, 20);
    const sections: DigestSection[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      category: item.category,
      tags: item.tags
    }));
    return {
      date,
      tab,
      content: sections.map((section) => `## ${section.title}\n${section.body}`).join('\n\n'),
      sections,
      history
    };
  }

  async saveGenerated(tab: DigestTab, date: string, content: string): Promise<void> {
    const project = await projectRepository.getActiveProject();
    await fileRepository.writeText(project.id, pathFor(tab, date), content);
    await digestRepository.saveFromMarkdown(project.id, tab, date, content);
    const now = Date.now();
    await database.put<LearningEvent>(STORES.learningEvents, {
      id: `${project.id}:digest:${tab}:${date}`,
      projectId: project.id,
      type: 'digest',
      module: TITLE_BY_TAB[tab],
      date,
      total: 1,
      correct: 1,
      accuracy: 100,
      sourceRef: pathFor(tab, date),
      createdAt: now
    });
  }

  async enqueueGenerate(tab: DigestTab, date = today()): Promise<EnqueueResult> {
    this.writeActiveTab(tab);
    return generationTaskService.enqueue({
      intent: 'daily',
      title: TITLE_BY_TAB[tab],
      detail: tab === 'news' ? '生成今日时政热点积累' : '生成今日公考知识点积累',
      module: TITLE_BY_TAB[tab],
      sourceId: `${tab}:${date}`,
      payload: {
        digestTab: tab,
        digestDate: date
      }
    });
  }

  async deleteDate(tab: DigestTab, date = today()): Promise<void> {
    const project = await projectRepository.getActiveProject();
    await digestRepository.deleteDate(project.id, tab, date);
  }
}

export const digestService = new DigestService();
