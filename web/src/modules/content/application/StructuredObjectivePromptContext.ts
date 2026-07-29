import type { JsonObject } from '@/kernel/public';
import type { TrueQuestionReferencePack } from '../contracts/QuestionReferencePackRepository';
import type { GenerationAggregate } from '../contracts/GenerationRepository';
import type { PracticeGenerationShard } from './PracticeCoreGenerationPolicy';

export function generationPromptVariables(
  aggregate: GenerationAggregate,
  requestedCount?: number
) {
  const min = aggregate.spec.difficulty.min;
  const max = aggregate.spec.difficulty.max;
  if (typeof min !== 'number' || typeof max !== 'number') {
    throw new TypeError('Generation difficulty is invalid');
  }
  return {
    QUESTION_COUNT: requestedCount ?? aggregate.spec.requestedCount ?? 0,
    ASSESSMENT_ROLE: aggregate.spec.assessmentRole,
    DIFFICULTY_MIN: min,
    DIFFICULTY_MAX: max
  };
}

export function generationPromptPayload(
  aggregate: GenerationAggregate,
  referencePack?: TrueQuestionReferencePack,
  shard?: PracticeGenerationShard,
  totalCount = aggregate.spec.requestedCount ?? 0
): JsonObject {
  return {
    generationSpecId: aggregate.spec.id,
    examCycleId: aggregate.spec.examCycleId,
    capabilityNodeId: aggregate.spec.capabilityNodeId,
    assessmentRole: aggregate.spec.assessmentRole,
    requestedCount: shard?.count ?? aggregate.spec.requestedCount ?? null,
    batch: shard ? {
      totalCount,
      shardIndex: shard.index,
      offset: shard.offset,
      count: shard.count
    } : null,
    difficulty: aggregate.spec.difficulty,
    constraints: aggregate.spec.constraints,
    studentContext: aggregate.spec.contextSnapshot,
    trueQuestionReference: referencePack ? referencePayload(referencePack) : null
  };
}

function referencePayload(referencePack: TrueQuestionReferencePack): JsonObject {
  return {
    referencePackId: referencePack.id,
    policyVersion: referencePack.policyVersion,
    module: referencePack.module,
    examScope: referencePack.examScope,
    sourceQuestionCount: referencePack.sourceQuestionCount,
    sourceSetCount: referencePack.sourceSetCount,
    questionTypeDistribution: referencePack.questionTypeDistribution,
    difficultyDistribution: referencePack.difficultyDistribution,
    structuralDistribution: referencePack.structuralDistribution,
    distractorPatterns: [...referencePack.distractorPatterns],
    representativeQuestions: referencePack.representativeQuestions.map((question) => ({
      questionId: question.questionId,
      difficulty: question.difficulty,
      material: question.material ?? null,
      prompt: question.prompt,
      options: question.options.map((option) => ({ ...option })),
      correctOptionId: question.correctOptionId,
      structuralSignature: question.structuralSignature
    }))
  };
}
