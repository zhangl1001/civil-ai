import type { CommittedQuestionSetBundle } from '../contracts/ContentRepository';
import {
  GenerationWorkflowStatus,
  GenerationWorkflowStep,
  QuestionSetPracticeStatus,
  QuestionSetStatus
} from './ContentCodes';

export function assertCommittedQuestionSetBundle(bundle: CommittedQuestionSetBundle): void {
  const questionSet = bundle.questionSet;
  if (questionSet.status !== QuestionSetStatus.Ready) throw new Error('Committed question set must be ready');
  if (questionSet.practiceStatus !== QuestionSetPracticeStatus.NotStarted) {
    throw new Error('A newly committed question set must not have practice progress');
  }
  if (questionSet.questionCount !== bundle.questions.length || bundle.questions.length === 0) {
    throw new Error('Question set count must match a non-empty question collection');
  }
  if (bundle.generationSpec.id !== questionSet.generationSpecId) throw new Error('Question set generation spec mismatch');
  if (bundle.generationWorkflow.generationSpecId !== bundle.generationSpec.id) throw new Error('Generation workflow spec mismatch');
  if (
    bundle.generationWorkflow.status !== GenerationWorkflowStatus.Committed
    || bundle.generationWorkflow.currentStep !== GenerationWorkflowStep.Complete
  ) {
    throw new Error('Committed question set requires a completed generation workflow');
  }
  if (bundle.generationWorkflow.examCycleId !== questionSet.examCycleId) throw new Error('Generation workflow exam cycle mismatch');
  const sequences = new Set<number>();
  for (const question of bundle.questions) {
    if (question.questionSetId !== questionSet.id || question.examCycleId !== questionSet.examCycleId) {
      throw new Error('Question must belong to the committed question set and exam cycle');
    }
    if (sequences.has(question.sequence)) throw new Error('Question sequence must be unique within a question set');
    sequences.add(question.sequence);
  }
}

export function assertQuestionSetQueryLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Question set query limit must be an integer between 1 and 100');
  }
}
