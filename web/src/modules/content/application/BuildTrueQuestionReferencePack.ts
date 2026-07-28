import type { UnitOfWork } from '@/capabilities/database/public';
import {
  sha256Json,
  type CapabilityNodeId,
  type Clock,
  type ExamCycleId,
  type IdGenerator,
  type JsonObject,
  type JsonValue
} from '@/kernel/public';
import type { ContentRepository, QuestionRecord } from '../contracts/ContentRepository';
import type {
  QuestionReferencePackRepository,
  TrueQuestionReferenceExample,
  TrueQuestionReferencePack
} from '../contracts/QuestionReferencePackRepository';
import { contentDocumentText } from '../domain/ContentDocumentText';
import { QuestionOriginType } from '../domain/QuestionSourceCodes';

export const TRUE_QUESTION_REFERENCE_POLICY_VERSION = 'true-question-reference.v2';

const MAX_SOURCE_SETS = 12;
const MAX_SAMPLED_QUESTIONS = 40;
const MAX_REPRESENTATIVE_QUESTIONS = 3;
const MAX_MATERIAL_CHARACTERS = 1000;
const MAX_PROMPT_CHARACTERS = 800;
const MAX_OPTION_CHARACTERS = 280;

export interface BuildTrueQuestionReferencePackCommand {
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
}

export class BuildTrueQuestionReferencePack {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly contentRepository: ContentRepository,
    private readonly referencePackRepository: QuestionReferencePackRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(
    command: BuildTrueQuestionReferencePackCommand
  ): Promise<TrueQuestionReferencePack | undefined> {
    const entries = await this.contentRepository.queryQuestionSetLibrary({
      examCycleId: command.examCycleId,
      capabilityNodeIds: [command.capabilityNodeId],
      originTypes: [
        QuestionOriginType.Official,
        QuestionOriginType.Imported,
        QuestionOriginType.UserCreated
      ],
      limit: MAX_SOURCE_SETS
    });
    if (!entries.length) return undefined;

    const bundles = (await Promise.all(entries.map((entry) => (
      this.contentRepository.findQuestionSet(entry.id)
    )))).filter((bundle) => bundle !== undefined);
    const questions = bundles
      .flatMap((bundle) => bundle.questions)
      .filter(isReferenceQuestion)
      .slice(0, MAX_SAMPLED_QUESTIONS);
    if (!questions.length) return undefined;

    const sourceIds = [...new Set(questions.flatMap((question) => (
      question.sourceId ? [question.sourceId] : []
    )))];
    const packSeed = {
      examCycleId: command.examCycleId,
      capabilityNodeId: command.capabilityNodeId,
      policyVersion: TRUE_QUESTION_REFERENCE_POLICY_VERSION,
      questionHashes: questions.map((question) => question.contentHash)
    };
    const contentHash = await sha256Json(toJson(packSeed));
    const existing = await this.referencePackRepository.findByContentHash(contentHash);
    if (existing) return existing;

    const module = entries[0]?.module ?? 'practice';
    const pack: TrueQuestionReferencePack = {
      id: this.ids.next('QuestionReferencePackId'),
      examCycleId: command.examCycleId,
      capabilityNodeId: command.capabilityNodeId,
      module,
      examScope: referenceExamScope(entries, questions.length),
      sourceQuestionCount: entries.reduce((sum, entry) => sum + entry.questionCount, 0),
      sourceSetCount: entries.length,
      sourceIds,
      questionTypeDistribution: questionTypeDistribution(questions),
      difficultyDistribution: difficultyDistribution(questions),
      structuralDistribution: structuralDistribution(questions),
      distractorPatterns: distractorPatterns(questions),
      representativeQuestions: representativeQuestions(questions),
      comparisonQuestions: questions.map(toComparisonExample),
      policyVersion: TRUE_QUESTION_REFERENCE_POLICY_VERSION,
      contentHash,
      createdAt: this.clock.now()
    };
    try {
      await this.unitOfWork.run((context) => this.referencePackRepository.save(pack, context));
      return pack;
    } catch (error) {
      const concurrent = await this.referencePackRepository.findByContentHash(contentHash);
      if (concurrent) return concurrent;
      throw error;
    }
  }
}

function isReferenceQuestion(question: QuestionRecord): boolean {
  return question.isOfficial === true
    || question.originType === QuestionOriginType.Official
    || question.originType === QuestionOriginType.Imported
    || question.originType === QuestionOriginType.UserCreated;
}

function referenceExamScope(
  entries: Awaited<ReturnType<ContentRepository['queryQuestionSetLibrary']>>,
  sampledQuestionCount: number
): JsonObject {
  return {
    sourceTypes: [...new Set(entries.flatMap((entry) => (
      entry.originType ? [entry.originType] : []
    )))],
    examTypes: [...new Set(entries.flatMap((entry) => (
      entry.sourceMetadata?.examType ? [entry.sourceMetadata.examType] : []
    )))],
    examYears: [...new Set(entries.flatMap((entry) => (
      entry.sourceMetadata?.examYear ? [entry.sourceMetadata.examYear] : []
    )))].sort((left, right) => right - left),
    provinces: [...new Set(entries.flatMap((entry) => (
      entry.sourceMetadata?.province ? [entry.sourceMetadata.province] : []
    )))],
    sampledQuestionCount
  };
}

function questionTypeDistribution(questions: readonly QuestionRecord[]): JsonObject {
  let sharedMaterial = 0;
  let standalone = 0;
  questions.forEach((question) => {
    if (question.content.materialGroupId) sharedMaterial += 1;
    else standalone += 1;
  });
  return {
    singleChoice: questions.length,
    sharedMaterial,
    standalone
  };
}

function difficultyDistribution(questions: readonly QuestionRecord[]): JsonObject {
  let foundation = 0;
  let standard = 0;
  let challenging = 0;
  questions.forEach((question) => {
    if (question.difficulty < 0.4) foundation += 1;
    else if (question.difficulty <= 0.7) standard += 1;
    else challenging += 1;
  });
  return {
    foundation,
    standard,
    challenging,
    average: round(questions.reduce((sum, question) => sum + question.difficulty, 0) / questions.length)
  };
}

function structuralDistribution(questions: readonly QuestionRecord[]): JsonObject {
  const promptLengths = questions.map((question) => contentDocumentText(question.content.prompt).length);
  const optionLengths = questions.flatMap((question) => (
    question.content.options.map((option) => contentDocumentText(option.content).length)
  ));
  return {
    promptLength: summarizeNumbers(promptLengths),
    optionLength: summarizeNumbers(optionLengths),
    materialQuestionCount: questions.filter((question) => question.content.material).length,
    sharedMaterialQuestionCount: questions.filter((question) => question.content.materialGroupId).length
  };
}

function distractorPatterns(questions: readonly QuestionRecord[]): readonly string[] {
  const patterns = new Set<string>();
  questions.forEach((question) => {
    const options = question.content.options.map((option) => contentDocumentText(option.content));
    const lengths = options.map((option) => option.length);
    if (Math.max(...lengths) - Math.min(...lengths) <= 8) patterns.add('选项长度接近');
    if (options.some((option) => /不可能|必然|完全|所有|任何/.test(option))) {
      patterns.add('绝对化措辞干扰');
    }
    if (options.filter((option) => /\d/.test(option)).length >= 2) patterns.add('数值邻近干扰');
    if (options.some((option) => /因果|因此|导致|由于/.test(option))) patterns.add('因果关系干扰');
  });
  return [...patterns].slice(0, 6);
}

function representativeQuestions(
  questions: readonly QuestionRecord[]
): readonly TrueQuestionReferenceExample[] {
  const indexes = representativeIndexes(questions.length);
  return indexes.map((index) => toReferenceExample(questions[index]!));
}

function representativeIndexes(length: number): number[] {
  if (length <= MAX_REPRESENTATIVE_QUESTIONS) return Array.from({ length }, (_, index) => index);
  return [0, Math.floor((length - 1) / 2), length - 1];
}

function toReferenceExample(question: QuestionRecord): TrueQuestionReferenceExample {
  const prompt = truncate(contentDocumentText(question.content.prompt), MAX_PROMPT_CHARACTERS);
  const material = question.content.material
    ? truncate(contentDocumentText(question.content.material), MAX_MATERIAL_CHARACTERS)
    : undefined;
  const options = question.content.options.map((option) => ({
    id: option.id,
    text: truncate(contentDocumentText(option.content), MAX_OPTION_CHARACTERS)
  }));
  return {
    questionId: question.id,
    questionSetId: question.questionSetId,
    sourceId: question.sourceId,
    sourceSequence: question.sourceSequence,
    difficulty: question.difficulty,
    material,
    prompt,
    options,
    correctOptionId: question.content.correctOptionId,
    structuralSignature: {
      hasMaterial: Boolean(material),
      usesSharedMaterial: Boolean(question.content.materialGroupId),
      promptLength: prompt.length,
      optionCount: options.length,
      averageOptionLength: round(
        options.reduce((sum, option) => sum + option.text.length, 0) / Math.max(1, options.length)
      )
    }
  };
}

function toComparisonExample(question: QuestionRecord) {
  return {
    questionId: question.id,
    prompt: truncate(contentDocumentText(question.content.prompt), MAX_PROMPT_CHARACTERS),
    options: question.content.options.map((option) => ({
      id: option.id,
      text: truncate(contentDocumentText(option.content), MAX_OPTION_CHARACTERS)
    }))
  };
}

function summarizeNumbers(values: readonly number[]): JsonObject {
  if (!values.length) return { min: 0, max: 0, average: 0 };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length)
  };
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
