import { parseStructuredJson } from '@/capabilities/ai-runtime/public';
import type { QuestionId } from '@/kernel/public';
import type { CommittedQuestionSetBundle } from '../contracts/ContentRepository';
import type { ContentDocument } from '../contracts/ContentDocument';
import { ContentDocumentType } from '../domain/ContentCodes';
import {
  contentBlockText,
  contentDocumentText
} from '../domain/ContentDocumentText';
import {
  authoringExplanationDocument,
  authoringLectureDocument
} from './GeneratedContentParser';

export interface QuestionSetEnrichmentNeeds {
  readonly lecture: boolean;
  readonly explanationQuestionIds: readonly QuestionId[];
}

export interface ParsedQuestionSetEnrichment {
  readonly lecture?: ContentDocument;
  readonly explanations: ReadonlyMap<QuestionId, ContentDocument>;
}

export class QuestionSetEnrichmentParseError extends Error {
  readonly code = 'content.enrichment_invalid';

  constructor(message: string) {
    super(message);
    this.name = 'QuestionSetEnrichmentParseError';
  }
}

export function findQuestionSetEnrichmentNeeds(
  bundle: CommittedQuestionSetBundle
): QuestionSetEnrichmentNeeds {
  const lectureDocument = bundle.documents.find(
    (document) => document.documentType === ContentDocumentType.Lecture
  );
  return {
    lecture: !lectureDocument || !hasRenderableContent(lectureDocument.content),
    explanationQuestionIds: bundle.questions
      .filter((question) => !hasCompleteExplanation(
        question.content.explanation,
        question.content.options.map((option) => option.id)
      ))
      .map((question) => question.id)
  };
}

export function hasQuestionSetEnrichmentNeeds(needs: QuestionSetEnrichmentNeeds): boolean {
  return needs.lecture || needs.explanationQuestionIds.length > 0;
}

export function parseQuestionSetEnrichment(
  text: string,
  bundle: CommittedQuestionSetBundle
): ParsedQuestionSetEnrichment {
  const parsed = parseStructuredJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QuestionSetEnrichmentParseError('补全结果必须是 JSON 对象');
  }
  const root = parsed as Record<string, unknown>;
  const lecture = root.lecture === undefined
    ? undefined
    : authoringLectureDocument(root.lecture);
  const byId = new Map(bundle.questions.map((question) => [String(question.id), question]));
  const bySequence = new Map(bundle.questions.map((question) => [question.sequence, question]));
  const explanations = new Map<QuestionId, ContentDocument>();
  if (Array.isArray(root.explanations)) {
    root.explanations.forEach((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const value = item as Record<string, unknown>;
      const question = typeof value.questionId === 'string'
        ? byId.get(value.questionId)
        : typeof value.sequence === 'number' && Number.isInteger(value.sequence)
          ? bySequence.get(value.sequence)
          : undefined;
      if (!question) return;
      const explanation = authoringExplanationDocument(
        value.explanation,
        String(question.id),
        question.content.correctOptionId,
        question.content.options.map((option) => option.id)
      );
      if (hasRenderableContent(explanation)) explanations.set(question.id, explanation);
    });
  }
  if ((!lecture || !hasRenderableContent(lecture)) && explanations.size === 0) {
    throw new QuestionSetEnrichmentParseError('补全结果没有可落库的讲义或解析');
  }
  return {
    lecture: lecture && hasRenderableContent(lecture) ? lecture : undefined,
    explanations
  };
}

export function hasRenderableContent(document: ContentDocument): boolean {
  return document.blocks.length > 0 && contentDocumentText(document).replace(/\s+/g, '').length > 0;
}

export function hasCompleteExplanation(
  document: ContentDocument,
  optionIds: readonly string[]
): boolean {
  if (!hasRenderableContent(document)) return false;
  const optionAnalysis = document.blocks.find(
    (block) => block.type === 'callout' && block.kind === 'hint'
  );
  if (!optionAnalysis) return false;
  const text = contentBlockText(optionAnalysis);
  return optionIds.every((optionId) => (
    new RegExp(`(?:^|\\s|\\*)${escapeRegExp(optionId)}(?:\\s|·|[.．、:：]|\\*)`).test(text)
  ));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
