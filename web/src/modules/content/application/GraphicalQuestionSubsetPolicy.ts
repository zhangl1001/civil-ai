import type { JsonObject } from '@/kernel/public';
import { GeneratedContentParseError } from './GeneratedContentParser';
import {
  isGraphicalGenerationCapability,
  practiceQuestionAcceptanceRatio
} from './PracticeCoreGenerationPolicy';

export function canAcceptGraphicalQuestionSubset(
  actualCount: number,
  expectedCount: number,
  capabilityCode: string
): boolean {
  return isGraphicalGenerationCapability(capabilityCode)
    && expectedCount > 0
    && actualCount > 0
    && actualCount < expectedCount
    && actualCount / expectedCount >= practiceQuestionAcceptanceRatio(capabilityCode);
}

export function recoverGraphicalQuestionSubset(
  root: JsonObject,
  error: GeneratedContentParseError,
  expectedCount: number,
  capabilityCode: string
): JsonObject | undefined {
  if (!isGraphicalGenerationCapability(capabilityCode) || !Array.isArray(root.questions)) {
    return undefined;
  }
  const invalidIndexes = questionIssueIndexes(error);
  if (!invalidIndexes) return undefined;
  const retainedQuestions = root.questions.filter((_, index) => !invalidIndexes.has(index));
  return canAcceptGraphicalQuestionSubset(
    retainedQuestions.length,
    expectedCount,
    capabilityCode
  )
    ? { ...root, questions: retainedQuestions }
    : undefined;
}

function questionIssueIndexes(error: GeneratedContentParseError): ReadonlySet<number> | undefined {
  const indexes = new Set<number>();
  for (const issue of error.issues) {
    const match = issue.path.match(/^\$\.questions\[(\d+)]/);
    if (!match) return undefined;
    indexes.add(Number(match[1]));
  }
  return indexes.size ? indexes : undefined;
}
