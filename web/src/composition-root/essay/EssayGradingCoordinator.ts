import type { TutorDatabaseRuntime } from '../database/TutorDatabaseRuntime';
import type { AgentRunView } from '@/modules/agent/public';

/**
 * Composition-root adapter that lets the essay detail page follow its own grading run.
 * The view depends on this port only; it never reaches into the agent runtime.
 */
export class EssayGradingCoordinator {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async findActive(questionSetId: string): Promise<AgentRunView | undefined> {
    if (!questionSetId) return undefined;
    const tasks = await this.runtime.getAgentRunViews.execute({ limit: 50 });
    return tasks.find((task) => isEssayGradingTask(task, questionSetId) && task.isActive);
  }

  async find(runId: string): Promise<AgentRunView | undefined> {
    return this.runtime.getAgentRunViews.findById(runId as AgentRunView['id']);
  }
}

function isEssayGradingTask(task: AgentRunView, questionSetId: string): boolean {
  return task.intent === 'essayGrade' && task.actionParams.questionSetId === questionSetId;
}
