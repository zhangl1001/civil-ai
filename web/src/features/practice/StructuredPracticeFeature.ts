import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { AssessmentRole, CapabilityNodeId, JsonObject, WorkflowId } from '@/kernel/public';
import type { ObjectiveAnswerInput } from '@/modules/evidence/public';

export interface StructuredPracticeRequest {
  readonly idempotencyKey: string;
  readonly requestedCount: number;
  readonly difficultyMin: number;
  readonly difficultyMax: number;
  readonly assessmentRole?: AssessmentRole;
  readonly goal?: string;
  readonly constraints?: JsonObject;
  readonly capabilityNodeId?: CapabilityNodeId;
  readonly capabilityCode?: string;
}

/** Page-facing adapter for the first clean-break practice slice. */
export class StructuredPracticeFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  request(command: StructuredPracticeRequest) {
    return this.runtime.requestStructuredPractice.execute(command);
  }

  async run(workflowId: WorkflowId, gateway: ProviderGateway, signal?: AbortSignal) {
    return this.runtime.runStructuredObjectiveGenerationWorkflow.execute(workflowId, gateway, signal);
  }

  status(workflowId: WorkflowId) {
    return this.runtime.getGenerationStatus.execute(workflowId);
  }

  async submit(command: {
    readonly idempotencyKey: string;
    readonly learningThreadId: string;
    readonly questionSetId: string;
    readonly startedAt: number;
    readonly elapsedMs: number;
    readonly answers: readonly ObjectiveAnswerInput[];
    readonly diagnosisContexts?: Readonly<Record<string, JsonObject>>;
  }) {
    return this.runtime.completeObjectivePractice.execute({
      idempotencyKey: command.idempotencyKey,
      learningThreadId: command.learningThreadId as Parameters<TutorDatabaseRuntime['completeObjectivePractice']['execute']>[0]['learningThreadId'],
      questionSetId: command.questionSetId as Parameters<TutorDatabaseRuntime['completeObjectivePractice']['execute']>[0]['questionSetId'],
      startedAt: command.startedAt as Parameters<TutorDatabaseRuntime['completeObjectivePractice']['execute']>[0]['startedAt'],
      elapsedMs: command.elapsedMs,
      answers: command.answers
    }, command.diagnosisContexts);
  }
}
