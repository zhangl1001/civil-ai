import type { TutorDatabaseRuntime } from '@/composition-root/public';
import {
  LearningAssetKind,
  LearningAssetStatus
} from '@/modules/content/public';
import { TaskTargetType, type AgentRunView } from '@/modules/agent/public';
import { AIPracticeLibraryService, type PracticeLibraryScope } from './AIPracticeLibraryService';

export type AgentWorkspaceResourceType = 'question_sets' | 'digests' | 'lectures';
export type AgentWorkspaceScope = 'today' | 'recent' | 'all';
export type AgentTaskScope = AgentWorkspaceScope | 'active';

export interface AgentWorkspaceDiscoveryQuery {
  readonly resourceType: AgentWorkspaceResourceType;
  readonly scope: AgentWorkspaceScope;
  readonly keyword?: string;
  readonly limit?: number;
}

export interface AgentTaskStatusQuery {
  readonly taskId?: string;
  readonly scope?: AgentTaskScope;
  readonly intent?: string;
  readonly limit?: number;
}

/**
 * Read-only resource discovery for the local tutor workspace. It is the
 * SQLite equivalent of a file-oriented Glob: list lightweight identities
 * first, then let a narrower tool read one selected resource.
 */
export class AgentWorkspaceQueryService {
  private readonly practiceLibrary = new AIPracticeLibraryService();

  async discover(runtime: TutorDatabaseRuntime, query: AgentWorkspaceDiscoveryQuery): Promise<Record<string, unknown>> {
    const cycle = await requireCycle(runtime);
    const scope = normalizeWorkspaceScope(query.scope);
    const limit = boundedLimit(query.limit);
    const keyword = cleanText(query.keyword);
    if (query.resourceType === 'question_sets') {
      const snapshot = await this.practiceLibrary.read(runtime, {
        scope: scope as PracticeLibraryScope,
        entryMode: 'all',
        capabilityKeyword: keyword,
        limit
      });
      return {
        resourceType: query.resourceType,
        scope,
        total: snapshot.readySetCount,
        availableOutsideScope: snapshot.availableOutsideScope,
        truncated: snapshot.isLibraryScanTruncated || snapshot.readySetCount > snapshot.sets.length,
        items: snapshot.sets
      };
    }

    const kind = query.resourceType === 'digests'
      ? LearningAssetKind.DigestDaily
      : LearningAssetKind.StudyLecture;
    const assets = await runtime.learningAssetStore.list({
      examCycleId: cycle.examCycle.id,
      kinds: [kind],
      status: LearningAssetStatus.Ready,
      limit: 100
    });
    const threshold = scopeThreshold(scope);
    const seen = new Set<string>();
    const items = assets
      .filter((asset) => asset.updatedAt >= threshold)
      .filter((asset) => !keyword || searchableAssetText(asset).includes(keyword))
      .flatMap((asset) => {
        if (seen.has(asset.businessKey)) return [];
        seen.add(asset.businessKey);
        return [{
          resourceId: asset.id,
          businessKey: asset.businessKey,
          title: asset.title,
          ...(query.resourceType === 'digests'
            ? {
                date: stringField(asset.payload.date),
                tab: stringField(asset.payload.tab),
                sectionCount: markdownSectionCount(stringField(asset.payload.content))
              }
            : {
                module: stringField(asset.payload.module),
                topic: stringField(asset.payload.topic)
              }),
          updatedAt: asset.updatedAt
        }];
      });
    return {
      resourceType: query.resourceType,
      scope,
      total: items.length,
      truncated: assets.length === 100 || items.length > limit,
      items: items.slice(0, limit)
    };
  }

  async readTaskStatus(runtime: TutorDatabaseRuntime, query: AgentTaskStatusQuery): Promise<Record<string, unknown>> {
    const cycle = await requireCycle(runtime);
    const taskId = identifier(query.taskId);
    if (taskId) {
      const task = await runtime.getAgentRunViews.findById(taskId as AgentRunView['id']);
      if (!task || task.examCycleId !== cycle.examCycle.id || !isBusinessTask(task)) {
        return {
          found: false,
          taskId,
          nextQuery: {
            scope: 'active',
            reason: '精确任务不存在或不属于当前备考周期，请先查询当前活动任务。'
          }
        };
      }
      return { found: true, task: taskSummary(task) };
    }

    const scope = normalizeTaskScope(query.scope);
    const limit = boundedLimit(query.limit);
    const intent = cleanText(query.intent);
    const threshold = scopeThreshold(scope === 'active' ? 'all' : scope);
    const tasks = (await runtime.getAgentRunViews.execute({ limit: 50 }))
      .filter((task) => task.examCycleId === cycle.examCycle.id && isBusinessTask(task))
      .filter((task) => scope !== 'active' || task.isActive)
      .filter((task) => scope === 'active' || task.updatedAt >= threshold)
      .filter((task) => !intent || task.intent === intent)
      .slice(0, limit);
    return {
      found: tasks.length > 0,
      scope,
      intent: intent || null,
      count: tasks.length,
      tasks: tasks.map(taskSummary),
      ...(tasks.length
        ? {}
        : {
            nextQuery: scope === 'active'
              ? {
                  scope: 'today',
                  intent: intent || undefined,
                  reason: '当前没有活动任务，可检查今天已受理或刚完成的任务。'
                }
              : scope === 'today'
                ? {
                    scope: 'recent',
                    intent: intent || undefined,
                    reason: '今天没有匹配任务，可扩大到最近任务。'
                  }
                : undefined
          })
    };
  }
}

function taskSummary(task: AgentRunView): Record<string, unknown> {
  return {
    taskId: task.id,
    intent: task.intent ?? null,
    status: task.status,
    statusText: task.statusText,
    title: task.title,
    detail: task.detail,
    step: task.step ?? null,
    isActive: task.isActive,
    result: {
      questionSetId: task.questionSetId ?? null,
      targetResourceType: task.targetResourceType ?? null,
      targetResourceId: task.targetResourceId ?? null
    },
    updatedAt: task.updatedAt
  };
}

function isBusinessTask(task: AgentRunView): boolean {
  return task.targetResourceType === TaskTargetType.BusinessOperation
    || task.targetResourceType === TaskTargetType.StructuredPractice;
}

async function requireCycle(runtime: TutorDatabaseRuntime) {
  const cycle = await runtime.candidateRepository.findCurrentCycle();
  if (!cycle) throw new Error('请先建立备考档案。');
  return cycle;
}

function normalizeWorkspaceScope(value: unknown): AgentWorkspaceScope {
  return value === 'today' || value === 'recent' || value === 'all' ? value : 'recent';
}

function normalizeTaskScope(value: unknown): AgentTaskScope {
  return value === 'today' || value === 'recent' || value === 'all' || value === 'active'
    ? value
    : 'active';
}

function boundedLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? Math.round(value) : 6;
  return Math.max(1, Math.min(12, Number.isFinite(numeric) ? numeric : 6));
}

function scopeThreshold(scope: AgentWorkspaceScope): number {
  if (scope === 'all') return 0;
  const start = startOfLocalDay(Date.now());
  return scope === 'today' ? start : start - 6 * 86_400_000;
}

function startOfLocalDay(value: number): number {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function searchableAssetText(asset: {
  readonly title: string;
  readonly businessKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}): string {
  return [
    asset.title,
    asset.businessKey,
    stringField(asset.payload.date),
    stringField(asset.payload.tab),
    stringField(asset.payload.module),
    stringField(asset.payload.topic)
  ].join(' ').toLocaleLowerCase();
}

function markdownSectionCount(value: string): number {
  return value.match(/^##\s+\S.+$/gm)?.length ?? (value.trim() ? 1 : 0);
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function identifier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const agentWorkspaceQueryService = new AgentWorkspaceQueryService();
