import type { JsonObject } from '@/kernel/public';
import type {
  TrueQuestionReferenceExample,
  TrueQuestionReferencePack
} from '../contracts/QuestionReferencePackRepository';
import { contentDocumentText } from '../domain/ContentDocumentText';
import type { GeneratedLectureQuestionSet } from './GeneratedContentParser';

export interface TrueQuestionDifferenceResult {
  readonly referenceQuestionIds: readonly (string | undefined)[];
  readonly nearDuplicateIndexes: readonly number[];
  readonly metrics: JsonObject;
}

export class TrueQuestionStructuralDifferenceValidator {
  evaluate(
    output: GeneratedLectureQuestionSet,
    referencePack?: TrueQuestionReferencePack
  ): TrueQuestionDifferenceResult {
    if (!referencePack) {
      return {
        referenceQuestionIds: output.questions.map(() => undefined),
        nearDuplicateIndexes: [],
        metrics: {
          referencePackApplied: false,
          referencedQuestionCount: 0,
          acceptedVariantCount: 0,
          rejectedReferenceCount: 0,
          nearDuplicateCount: 0
        }
      };
    }
    const references = new Map<string, TrueQuestionReferenceExample>(
      referencePack.representativeQuestions.map((question) => [question.questionId, question])
    );
    const comparisons = referencePack.comparisonQuestions ?? referencePack.representativeQuestions;
    let rejectedReferenceCount = 0;
    let nearDuplicateCount = 0;
    const differenceScores: number[] = [];
    const nearDuplicateIndexes: number[] = [];
    const referenceQuestionIds = output.questions.map((question, index) => {
      const referenceQuestionId = output.referenceQuestionIds[index];
      const reference = referenceQuestionId ? references.get(referenceQuestionId) : undefined;
      if (referenceQuestionId && !reference) {
        rejectedReferenceCount += 1;
      }
      const generatedPrompt = contentDocumentText(question.prompt);
      const generatedOptions = question.options.map((option) => contentDocumentText(option.content));
      const differenceScore = comparisons.reduce((minimum, candidate) => {
        const promptSimilarity = ngramSimilarity(generatedPrompt, candidate.prompt);
        const optionSimilarity = ngramSimilarity(
          generatedOptions.join('\n'),
          candidate.options.map((option) => option.text).join('\n')
        );
        return Math.min(minimum, round(1 - (promptSimilarity * 0.7 + optionSimilarity * 0.3)));
      }, 1);
      differenceScores.push(differenceScore);
      if (differenceScore < 0.12) {
        nearDuplicateCount += 1;
        nearDuplicateIndexes.push(index);
        return undefined;
      }
      return reference ? referenceQuestionId : undefined;
    });
    return {
      referenceQuestionIds,
      nearDuplicateIndexes,
      metrics: {
        referencePackApplied: true,
        referencePackId: referencePack.id,
        referencedQuestionCount: output.referenceQuestionIds.filter(Boolean).length,
        acceptedVariantCount: referenceQuestionIds.filter(Boolean).length,
        rejectedReferenceCount,
        nearDuplicateCount,
        minimumDifferenceScore: differenceScores.length ? Math.min(...differenceScores) : null,
        averageDifferenceScore: differenceScores.length
          ? round(differenceScores.reduce((sum, value) => sum + value, 0) / differenceScores.length)
          : null
      }
    };
  }
}

function ngramSimilarity(left: string, right: string): number {
  const leftGrams = ngrams(normalize(left));
  const rightGrams = ngrams(normalize(right));
  if (!leftGrams.size || !rightGrams.size) return 0;
  let intersection = 0;
  leftGrams.forEach((value) => {
    if (rightGrams.has(value)) intersection += 1;
  });
  return intersection / (leftGrams.size + rightGrams.size - intersection);
}

function ngrams(value: string): ReadonlySet<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
