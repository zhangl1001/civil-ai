import type { TutorDatabaseRuntime } from '../database/TutorDatabaseRuntime';
import type { AgentRunView } from '@/modules/agent/public';
import { essayFlowService, type EssayContext } from '@/services/EssayFlowService';

/**
 * Composition-root adapter for the essay generation workflow.
 * The practice feature receives a port; it does not depend on legacy services.
 */
export class EssayGenerationCoordinator {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async start(context: EssayContext, questionCount: number): Promise<AgentRunView> {
    const result = await essayFlowService.enqueueQuestionGeneration(context, { questionCount });
    return result.task;
  }

  async findActive(mode?: EssayContext['entryMode']): Promise<AgentRunView | undefined> {
    const tasks = await this.runtime.getAgentRunViews.execute({ limit: 50 });
    return tasks.find((task) => (
      isEssayGenerationTask(task)
      && task.isActive
      && (!mode || (task.actionParams.entryMode || task.actionParams.mode) === mode)
    ));
  }

  async find(taskId: string): Promise<AgentRunView | undefined> {
    const task = await this.runtime.getAgentRunViews.findById(taskId as AgentRunView['id']);
    return task && isEssayGenerationTask(task) ? task : undefined;
  }

  async cancel(taskId: string): Promise<AgentRunView | undefined> {
    await this.runtime.cancelAgentRun.execute({
      agentRunId: taskId as Parameters<typeof this.runtime.cancelAgentRun.execute>[0]['agentRunId'],
      reason: 'user_cancelled_essay_generation'
    });
    return this.find(taskId);
  }
}

function isEssayGenerationTask(task: AgentRunView): boolean {
  return task.intent === 'mock' && task.actionRoute === '/vue/essay';
}

export type { EssayContext };
