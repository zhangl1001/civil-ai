import { initializeTutorRuntime } from '@/composition-root/public';
import type { DigestSection, DigestTab } from '@/domain/digest';
import { LearningAssetKind, LearningAssetStatus } from '@/modules/content/public';
import { generationTaskService } from './GenerationTaskService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';

export interface DigestDashboard {
  date: string;
  tab: DigestTab;
  content: string;
  sections: DigestSection[];
  taskScopeKey: string;
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

function normalizeTab(value?: string | null): DigestTab {
  return value === 'tips' ? 'tips' : 'news';
}

function businessKey(tab: DigestTab, date: string): string {
  return `digest:${tab}:${date}`;
}

function parseSections(content: string, prefix: string): DigestSection[] {
  const lines = content.split(/\r?\n/);
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | undefined;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  if (!sections.length && content.trim()) sections.push({ title: '今日内容', body: [content] });
  return sections.map((section, index) => ({
    id: `${prefix}:${index}`,
    title: section.title,
    body: section.body.join('\n').trim(),
    category: '综合',
    tags: []
  }));
}

export class DigestService {
  readActiveTab(): DigestTab {
    return normalizeTab(localStorage.getItem('digest-active-tab'));
  }

  writeActiveTab(tab: DigestTab): void {
    localStorage.setItem('digest-active-tab', tab);
  }

  async dashboard(tab = this.readActiveTab(), date = today()): Promise<DigestDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return { date, tab, content: '', sections: [], taskScopeKey: '', history: [] };
    const current = await runtime.learningAssetStore.findLatest(
      cycle.examCycle.id,
      LearningAssetKind.DigestDaily,
      businessKey(tab, date)
    );
    const content = typeof current?.payload.content === 'string' ? current.payload.content : '';
    const assets = await runtime.learningAssetStore.list({
      examCycleId: cycle.examCycle.id,
      kinds: [LearningAssetKind.DigestDaily],
      status: LearningAssetStatus.Ready,
      limit: 200
    });
    const historyByDate = new Map<string, number>();
    assets.forEach((asset) => {
      if (asset.payload.tab !== tab || typeof asset.payload.date !== 'string') return;
      historyByDate.set(asset.payload.date, Math.max(historyByDate.get(asset.payload.date) || 0, asset.updatedAt));
    });
    const history = Array.from(historyByDate.entries())
      .sort((left, right) => right[0].localeCompare(left[0]))
      .slice(0, 20)
      .map(([itemDate, updatedAt]) => ({
        date: itemDate,
        tab,
        path: businessKey(tab, itemDate),
        updatedAt
      }));
    const sections = parseSections(content, current?.id || businessKey(tab, date));
    return {
      date,
      tab,
      content,
      sections,
      taskScopeKey: digestTaskScope(cycle.project.id, tab, date),
      history
    };
  }

  async saveGenerated(tab: DigestTab, date: string, content: string): Promise<void> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    await runtime.learningAssetStore.save({
      examCycleId: cycle.examCycle.id,
      kind: LearningAssetKind.DigestDaily,
      businessKey: businessKey(tab, date),
      title: `${date} ${TITLE_BY_TAB[tab]}`,
      payload: { tab, date, content }
    });
  }

  async enqueueGenerate(tab: DigestTab, date = today()): Promise<AgentTaskEnqueueResult> {
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
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return;
    await runtime.learningAssetStore.retireBusinessKey(
      cycle.examCycle.id,
      LearningAssetKind.DigestDaily,
      businessKey(tab, date)
    );
  }

  async cancelGeneration(taskId: string): Promise<void> {
    const runtime = await initializeTutorRuntime();
    await runtime.cancelAgentRun.execute({
      agentRunId: taskId as Parameters<typeof runtime.cancelAgentRun.execute>[0]['agentRunId'],
      reason: 'user_cancelled_daily_digest'
    });
  }
}

export const digestService = new DigestService();

function digestTaskScope(projectId: string, tab: DigestTab, date: string): string {
  return `daily:${projectId}:${tab}:${date}`;
}
