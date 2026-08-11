import type { JsonObject } from '@/kernel/public';
import type { TrueQuestionReferencePack } from '../contracts/QuestionReferencePackRepository';
import type { GenerationAggregate } from '../contracts/GenerationRepository';
import type { PracticeGenerationShard } from './PracticeCoreGenerationPolicy';
import {
  GenerationVariationKind,
  buildGenerationVariationContext
} from './GenerationVariationPolicy';

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
    generationVariation: objectiveVariation(aggregate, shard?.index ?? 0),
    studentContext: aggregate.spec.contextSnapshot,
    trueQuestionReference: referencePack ? referencePayload(referencePack) : null
  };
}

/**
 * Parallel shards only need the current teaching boundary and one calibrated
 * example. Sending the complete student history and every representative true
 * question to every shard multiplies input tokens without improving the item.
 */
export function generationShardPromptPayload(
  aggregate: GenerationAggregate,
  referencePack: TrueQuestionReferencePack | undefined,
  shard: PracticeGenerationShard,
  totalCount: number
): JsonObject {
  return {
    capabilityNodeId: aggregate.spec.capabilityNodeId,
    assessmentRole: aggregate.spec.assessmentRole,
    requestedCount: shard.count,
    batch: {
      totalCount,
      shardIndex: shard.index,
      offset: shard.offset,
      count: shard.count
    },
    difficulty: aggregate.spec.difficulty,
    constraints: aggregate.spec.constraints,
    generationVariation: objectiveVariation(aggregate, shard.index),
    studentContext: compactStudentContext(aggregate.spec.contextSnapshot),
    trueQuestionReference: referencePack
      ? compactReferencePayload(referencePack, shard.index, 1)
      : null
  };
}

export function generationLecturePromptPayload(
  aggregate: GenerationAggregate,
  referencePack: TrueQuestionReferencePack | undefined,
  totalCount: number
): JsonObject {
  return {
    capabilityNodeId: aggregate.spec.capabilityNodeId,
    assessmentRole: aggregate.spec.assessmentRole,
    requestedCount: totalCount,
    difficulty: aggregate.spec.difficulty,
    constraints: aggregate.spec.constraints,
    generationVariation: objectiveVariation(aggregate, 0),
    studentContext: compactStudentContext(aggregate.spec.contextSnapshot),
    trueQuestionReference: referencePack
      ? compactReferencePayload(referencePack, 0, 2)
      : null
  };
}

function objectiveVariation(aggregate: GenerationAggregate, shardIndex: number): JsonObject {
  return buildGenerationVariationContext({
    kind: GenerationVariationKind.ObjectiveQuestions,
    seed: `${aggregate.workflow.id}:${aggregate.spec.capabilityNodeId}`,
    attempt: aggregate.workflow.attemptCount + shardIndex
  });
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

function compactReferencePayload(
  referencePack: TrueQuestionReferencePack,
  offset: number,
  limit: number
): JsonObject {
  const examples = referencePack.representativeQuestions;
  const selected = examples.length
    ? Array.from({ length: Math.min(limit, examples.length) }, (_, index) => (
        examples[(offset + index) % examples.length]!
      ))
    : [];
  return {
    referencePackId: referencePack.id,
    policyVersion: referencePack.policyVersion,
    module: referencePack.module,
    examScope: referencePack.examScope,
    questionTypeDistribution: referencePack.questionTypeDistribution,
    difficultyDistribution: referencePack.difficultyDistribution,
    structuralDistribution: referencePack.structuralDistribution,
    distractorPatterns: [...referencePack.distractorPatterns],
    representativeQuestions: selected.map((question) => ({
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

function compactStudentContext(context: JsonObject): JsonObject {
  return compactObject({
    schemaVersion: context.schemaVersion,
    examCycle: compactRecord(context.examCycle, [
      'examType', 'examName', 'examDate', 'phase', 'timeZone'
    ]),
    target: compactRecord(context.target, [
      'subject', 'targetScore', 'currentScore', 'scoreGap', 'evidenceLevel', 'evidenceConfidence'
    ]),
    capability: context.capability,
    teachingPreferences: context.teachingPreferences,
    learningEvidence: compactLearningEvidence(context.learningEvidence)
  });
}

function compactLearningEvidence(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return compactObject({
    hasMasteryProjection: value.hasMasteryProjection,
    mastery: value.mastery,
    recentErrors: Array.isArray(value.recentErrors) ? value.recentErrors.slice(0, 3) : value.recentErrors,
    recentSessions: Array.isArray(value.recentSessions) ? value.recentSessions.slice(0, 3) : value.recentSessions
  });
}

function compactRecord(value: unknown, keys: readonly string[]): JsonObject | undefined {
  if (!isRecord(value)) return undefined;
  return compactObject(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

function compactObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ))) as JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
