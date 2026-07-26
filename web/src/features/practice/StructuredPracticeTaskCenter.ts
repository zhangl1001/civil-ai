import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { agentWorkerCoordinator } from '@/composition-root/public';
import type { AssessmentRole, CapabilityNodeId } from '@/kernel/public';
import {
  AgentRunType,
  TaskTargetType,
  type AgentRunView
} from '@/modules/agent/public';
import type { QuestionSetEntryModeCode } from '@/modules/content/public';
import {
  MessageBusinessLine,
  MessageCategory,
  MessageEventCode,
  MessageSeverity,
  MessageSourceType
} from '@/modules/message-center/public';

const startsByScope = new Map<string, Promise<AgentRunView>>();

export interface StructuredPracticeTaskCommand {
  readonly idempotencyKey: string;
  readonly scopeKey: string;
  readonly title: string;
  readonly detail: string;
  readonly entryMode: QuestionSetEntryModeCode;
  readonly source: 'daily_plan' | 'custom' | 'review' | 'diagnosis';
  readonly capabilityNodeId: CapabilityNodeId;
  readonly capabilityCode: string;
  readonly capabilityName: string;
  readonly module: string;
  readonly assessmentRole: AssessmentRole;
  readonly requestedCount: number;
  readonly durationMinutes?: number;
  readonly difficultyMin: number;
  readonly difficultyMax: number;
  readonly goal: string;
  readonly dailyPlanId?: string;
  readonly dailyPlanItemId?: string;
  readonly reviewQueueItemId?: string;
  readonly chatSessionId?: string;
}

/** The only page-facing entry for structured practice generation tasks. */
export class StructuredPracticeTaskCenter {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  start(command: StructuredPracticeTaskCommand): Promise<AgentRunView> {
    const pending = startsByScope.get(command.scopeKey);
    if (pending) return pending;
    const start = this.startOnce(command).finally(() => {
      if (startsByScope.get(command.scopeKey) === start) startsByScope.delete(command.scopeKey);
    });
    startsByScope.set(command.scopeKey, start);
    return start;
  }

  private async startOnce(command: StructuredPracticeTaskCommand): Promise<AgentRunView> {
    const active = await this.findActive(command.scopeKey);
    if (active) {
      agentWorkerCoordinator.start(this.runtime);
      return active;
    }
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const aggregate = await this.runtime.createAgentRun.execute({
      idempotencyKey: command.idempotencyKey,
      runType: AgentRunType.ContentGeneration,
      examCycleId: cycle.examCycle.id,
      targetResourceType: TaskTargetType.StructuredPractice,
      targetResourceId: command.scopeKey,
      inputSnapshot: {
        title: command.title,
        detail: command.detail,
        businessLine: MessageBusinessLine.Practice,
        category: MessageCategory.Task,
        scopeKey: command.scopeKey,
        entryMode: command.entryMode,
        source: command.source,
        capabilityNodeId: command.capabilityNodeId,
        capabilityCode: command.capabilityCode,
        capabilityName: command.capabilityName,
        module: command.module,
        assessmentRole: command.assessmentRole,
        requestedCount: command.requestedCount,
        durationMinutes: command.durationMinutes ?? null,
        difficultyMin: command.difficultyMin,
        difficultyMax: command.difficultyMax,
        goal: command.goal,
        dailyPlanId: command.dailyPlanId ?? null,
        dailyPlanItemId: command.dailyPlanItemId ?? null,
        reviewQueueItemId: command.reviewQueueItemId ?? null,
        chatSessionId: command.chatSessionId ?? null,
        actionRoute: '/vue/practice',
        completionActionRoute: '/vue/practice/objective-session',
        actionParams: {
          entryMode: command.entryMode,
          scopeKey: command.scopeKey
        }
      }
    });
    await this.runtime.messageCenter.publish({
      businessLine: MessageBusinessLine.Practice,
      category: MessageCategory.Task,
      eventCode: MessageEventCode.TaskQueued,
      severity: MessageSeverity.Info,
      title: command.title,
      content: command.detail,
      sourceType: MessageSourceType.AgentRun,
      sourceId: aggregate.run.id,
      actionRoute: '/vue/practice',
      actionParams: { mode: command.entryMode, scopeKey: command.scopeKey },
      dedupKey: `agent-run:${aggregate.run.id}:queued`
    }).catch(() => undefined);
    agentWorkerCoordinator.start(this.runtime);
    return this.requireView(aggregate.run.id);
  }

  async findActive(scopeKey: string): Promise<AgentRunView | undefined> {
    return this.runtime.getAgentRunViews.findActiveByTarget(TaskTargetType.StructuredPractice, scopeKey);
  }

  async findLatest(scopeKey: string): Promise<AgentRunView | undefined> {
    return this.runtime.getAgentRunViews.findLatestByTarget(TaskTargetType.StructuredPractice, scopeKey);
  }

  async cancel(run: AgentRunView): Promise<void> {
    if (!run.canCancel) return;
    await this.runtime.cancelAgentRun.execute({
      agentRunId: run.id,
      reason: 'user_cancelled_structured_practice'
    });
  }

  resume(): void {
    agentWorkerCoordinator.start(this.runtime);
  }

  private async requireView(id: AgentRunView['id']): Promise<AgentRunView> {
    const view = await this.runtime.getAgentRunViews.findById(id);
    if (!view) throw new Error('任务创建后无法读取');
    return view;
  }
}

export function actionQuery(run: AgentRunView): Record<string, string> {
  return Object.fromEntries(
    Object.entries(run.actionParams)
      .filter((entry): entry is [string, string | number | boolean] => (
        typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean'
      ))
      .map(([key, value]) => [key, String(value)])
  );
}
