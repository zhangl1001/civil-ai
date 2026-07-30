import type { ModelToolCall } from '@/capabilities/ai-runtime/public';
import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { AgentRunId, QuestionImportDraftId } from '@/kernel/public';
import type {
  AgentToolAuthorization,
  AgentToolAuthorizationResult,
  AgentToolDefinition,
  AgentToolExecutionContext
} from '@/modules/agent/public';

const ALLOWED: AgentToolAuthorizationResult = {
  authorized: true,
  reasonCode: 'agent.tool_resource_authorized'
};
const FORBIDDEN: AgentToolAuthorizationResult = {
  authorized: false,
  reasonCode: 'agent.tool_resource_forbidden',
  message: '当前会话无法访问该资源，请先重新查询当前备考档案中的可用内容。'
};

/** Resolves model-supplied resource IDs against the current local candidate boundary. */
export class ChatAgentToolAuthorization implements AgentToolAuthorization {
  constructor(
    private readonly runtime: TutorDatabaseRuntime,
    private readonly ownerSessionId: string
  ) {}

  async authorize(
    definition: AgentToolDefinition,
    call: ModelToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolAuthorizationResult> {
    if (context.sessionId !== this.ownerSessionId) return FORBIDDEN;
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return definition.risk === 'read' ? ALLOWED : FORBIDDEN;
    const examCycleId = cycle.examCycle.id;

    if (isQuestionImportMutation(definition.name)) {
      const draft = await this.runtime.questionImportDraftRepository.find(
        String(call.arguments.draftId || '') as QuestionImportDraftId
      );
      return draft?.draft.examCycleId === examCycleId
        && draft.draft.ownerSessionId === this.ownerSessionId
        ? ALLOWED
        : FORBIDDEN;
    }

    if (definition.name === 'practice.read_question_set') {
      const bundle = await this.runtime.contentRepository.findQuestionSet(
        String(call.arguments.questionSetId || '') as Parameters<
          TutorDatabaseRuntime['contentRepository']['findQuestionSet']
        >[0]
      );
      return bundle?.questionSet.examCycleId === examCycleId ? ALLOWED : FORBIDDEN;
    }

    if (definition.name === 'learning.review_session') {
      const review = await this.runtime.getObjectiveSessionReview.execute(
        String(call.arguments.sessionId || '') as Parameters<
          TutorDatabaseRuntime['getObjectiveSessionReview']['execute']
        >[0]
      );
      return review?.session.examCycleId === examCycleId ? ALLOWED : FORBIDDEN;
    }

    if (definition.name === 'task.read_status' && call.arguments.taskId) {
      const task = await this.runtime.getAgentRunViews.findById(
        String(call.arguments.taskId) as AgentRunId
      );
      return task?.examCycleId === examCycleId ? ALLOWED : FORBIDDEN;
    }

    return ALLOWED;
  }
}

function isQuestionImportMutation(toolName: string): boolean {
  return toolName === 'question_bank.repair'
    || toolName === 'question_bank.confirm'
    || toolName === 'question_bank.publish';
}
