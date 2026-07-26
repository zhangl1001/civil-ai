import type { JsonObject } from '@/kernel/public';
import type { ObjectiveSessionSubmissionResult, SubmitObjectiveSessionCommand } from './SubmitObjectiveSession';
import type { ObjectiveSubmissionPostProcessor } from './ObjectiveSubmissionPostProcessor';
import { SubmitObjectiveSession } from './SubmitObjectiveSession';

type CompleteObjectivePracticeCommand = SubmitObjectiveSessionCommand;

export interface CompleteObjectivePracticeResult extends ObjectiveSessionSubmissionResult {
  readonly diagnosisRunIds: readonly string[];
  readonly postProcessingStatus: 'completed' | 'pending';
  readonly pendingSteps: readonly string[];
}

/** Deterministic submission is authoritative; recoverable teaching side effects never make a committed answer look failed. */
export class CompleteObjectivePractice {
  constructor(
    private readonly submit: SubmitObjectiveSession,
    private readonly postProcessor: ObjectiveSubmissionPostProcessor
  ) {}

  async execute(
    command: CompleteObjectivePracticeCommand,
    contexts: Readonly<Record<string, JsonObject>> = {}
  ): Promise<CompleteObjectivePracticeResult> {
    const result = await this.submit.execute(command);
    const postProcessing = await this.postProcessor.execute({
      idempotencyKey: `${command.idempotencyKey}:submitted`,
      sessionId: result.sessionId,
      reviewQueueItemId: command.reviewQueueItemId,
      dailyPlanItemId: command.dailyPlanItemId,
      elapsedMs: command.elapsedMs
    }, contexts);

    return {
      ...result,
      diagnosisRunIds: postProcessing.diagnosisRunIds,
      postProcessingStatus: postProcessing.pendingSteps.length ? 'pending' : 'completed',
      pendingSteps: postProcessing.pendingSteps
    };
  }
}
