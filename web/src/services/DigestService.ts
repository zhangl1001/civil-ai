import { initializeTutorRuntime } from '@/composition-root/public';
import { normalizeMarkdownSource } from '@/capabilities/content-rendering/public';
import type { DigestSection, DigestTab } from '@/domain/digest';
import { LearningAssetKind, LearningAssetStatus } from '@/modules/content/public';
import { LearningProgressStatus, LearningResourceType } from '@/modules/learning-progress/public';
import { decidePreparationStrategy, prescribeDailyLearningLoad } from '@/modules/planning/public';
import { generationTaskService } from './GenerationTaskService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';
import type { InstantMs } from '@/kernel/public';

export interface DigestDashboard {
  date: string;
  tab: DigestTab;
  content: string;
  sections: DigestSection[];
  taskScopeKey: string;
  isCompleted: boolean;
  history: Array<{ date: string; tab: DigestTab; path: string; updatedAt: number }>;
}

export interface DigestLearningSummary {
  contentCount: number;
  isCompleted: boolean;
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
  const normalizedContent = normalizeMarkdownSource(content);
  const lines = normalizedContent.split(/\r?\n/);
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
  if (!sections.length && normalizedContent.trim()) sections.push({ title: '今日内容', body: [normalizedContent] });
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

  async learningSummary(date = today()): Promise<DigestLearningSummary> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return { contentCount: 0, isCompleted: false };
    const tabs: readonly DigestTab[] = ['news', 'tips'];
    const entries = await Promise.all(tabs.map(async (tab) => {
      const [asset, progress] = await Promise.all([
        runtime.learningAssetStore.findLatest(
          cycle.examCycle.id,
          LearningAssetKind.DigestDaily,
          businessKey(tab, date)
        ),
        runtime.learningProgressRepository.find(
          cycle.examCycle.id,
          LearningResourceType.Digest,
          digestResourceKey(tab, date)
        )
      ]);
      const content = typeof asset?.payload.content === 'string'
        ? normalizeMarkdownSource(asset.payload.content)
        : '';
      return {
        contentCount: parseSections(content, asset?.id || businessKey(tab, date)).length,
        isCompleted: progress?.status === LearningProgressStatus.Completed
      };
    }));
    const available = entries.filter((entry) => entry.contentCount > 0);
    return {
      contentCount: available.reduce((sum, entry) => sum + entry.contentCount, 0),
      isCompleted: available.length > 0 && available.every((entry) => entry.isCompleted)
    };
  }

  async dashboard(tab = this.readActiveTab(), date = today()): Promise<DigestDashboard> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return { date, tab, content: '', sections: [], taskScopeKey: '', isCompleted: false, history: [] };
    const [current, progress] = await Promise.all([
      runtime.learningAssetStore.findLatest(
        cycle.examCycle.id,
        LearningAssetKind.DigestDaily,
        businessKey(tab, date)
      ),
      runtime.learningProgressRepository.find(
        cycle.examCycle.id,
        LearningResourceType.Digest,
        digestResourceKey(tab, date)
      )
    ]);
    const content = typeof current?.payload.content === 'string'
      ? normalizeMarkdownSource(current.payload.content)
      : '';
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
      isCompleted: progress?.status === LearningProgressStatus.Completed,
      history
    };
  }

  async markStarted(tab: DigestTab, date: string): Promise<void> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return;
    await runtime.trackLearningProgress.start({
      examCycleId: cycle.examCycle.id,
      resourceType: LearningResourceType.Digest,
      resourceKey: digestResourceKey(tab, date)
    });
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
      payload: { tab, date, content: normalizeMarkdownSource(content) }
    });
  }

  async enqueueGenerate(
    tab: DigestTab,
    date = today(),
    idempotencyKey?: string,
    planContext?: { readonly dailyPlanItemId: string; readonly capabilityNodeId?: string }
  ): Promise<AgentTaskEnqueueResult> {
    this.writeActiveTab(tab);
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const availableMinutes = availableMinutesForDate(
      date,
      cycle.studyConstraints.weekdayMinutes,
      cycle.studyConstraints.weekendMinutes
    );
    const [tracks, reviews, curriculum] = await Promise.all([
      runtime.masteryRepository.listPriorityTracks(cycle.examCycle.id, 8),
      runtime.masteryRepository.listDueReviews(cycle.examCycle.id, Date.now() as InstantMs, 8),
      runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId)
    ]);
    const learningLoad = prescribeDailyLearningLoad({
      availableMinutes,
      strategy: decidePreparationStrategy({
        remainingDays: daysUntil(cycle.examCycle.examDate),
        dueReviewCount: reviews.length
      }),
      dueReviewCount: reviews.length,
      prioritySignals: tracks.map((track) => ({
        state: track.state,
        accuracy: track.accuracy,
        confidence: track.confidence
      }))
    });
    const trackByCapability = new Map(tracks.map((track) => [track.capabilityNodeId, track]));
    const focusIds = Array.from(new Set([
      ...(planContext?.capabilityNodeId ? [planContext.capabilityNodeId] : []),
      ...tracks.map((track) => track.capabilityNodeId)
    ])).slice(0, 4);
    const learningFocus = focusIds.flatMap((capabilityNodeId) => {
      const node = curriculum?.capabilityNodes.find((candidate) => candidate.id === capabilityNodeId);
      if (!node) return [];
      const track = trackByCapability.get(node.id);
      return [{
        capabilityNodeId: node.id,
        code: node.code,
        name: node.name,
        module: node.module,
        ...(track ? {
          masteryState: track.state,
          accuracy: track.accuracy,
          confidence: track.confidence
        } : {})
      }];
    });
    return generationTaskService.enqueue({
      idempotencyKey,
      intent: 'daily',
      title: TITLE_BY_TAB[tab],
      detail: tab === 'news' ? '生成今日时政热点积累' : '生成今日公考知识点积累',
      module: TITLE_BY_TAB[tab],
      sourceId: planContext?.dailyPlanItemId || `${tab}:${date}`,
      payload: {
        digestTab: tab,
        digestDate: date,
        learningLoad,
        learningFocus,
        ...(planContext ? {
          dailyPlanItemId: planContext.dailyPlanItemId,
          capabilityNodeId: planContext.capabilityNodeId ?? null
        } : {})
      }
    });
  }

  async completeDigest(input: {
    readonly dailyPlanItemId?: string;
    readonly tab: DigestTab;
    readonly date: string;
    readonly actualMinutes?: number;
  }) {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    await runtime.trackLearningProgress.complete({
      examCycleId: cycle.examCycle.id,
      resourceType: LearningResourceType.Digest,
      resourceKey: digestResourceKey(input.tab, input.date),
      dailyPlanItemId: input.dailyPlanItemId
    });
    if (!input.dailyPlanItemId) return;
    await runtime.completeDailyPlanItem.execute({
      dailyPlanItemId: input.dailyPlanItemId,
      actualMinutes: input.actualMinutes,
      resultSummary: { tab: input.tab, date: input.date, contentConsumed: true },
      sourceId: `daily-digest:${input.tab}:${input.date}:completed`
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

function digestResourceKey(tab: DigestTab, date: string): string {
  return `${tab}:${date}`;
}

function availableMinutesForDate(date: string, weekdayMinutes: number, weekendMinutes: number): number {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return Math.max(5, weekday === 0 || weekday === 6 ? weekendMinutes : weekdayMinutes);
}

function daysUntil(examDate: string): number | undefined {
  const target = Date.parse(`${examDate}T12:00:00`);
  if (!Number.isFinite(target)) return undefined;
  return Math.max(0, Math.ceil((target - Date.now()) / 86_400_000));
}
