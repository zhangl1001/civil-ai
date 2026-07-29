import type { UnitOfWork } from '@/capabilities/database/public';
import {
  sha256Json,
  type JsonValue,
  type QuestionSetId
} from '@/kernel/public';
import type {
  ContentRepository,
  QuestionRecord
} from '../contracts/ContentRepository';
import { ContentDocumentType } from '../domain/ContentCodes';
import type { ParsedQuestionSetEnrichment } from './QuestionSetEnrichment';
import {
  findQuestionSetEnrichmentNeeds,
  hasRenderableContent
} from './QuestionSetEnrichment';

export interface ApplyQuestionSetEnrichmentResult {
  readonly applied: boolean;
  readonly lectureUpdated: boolean;
  readonly explanationQuestionIds: readonly string[];
}

export class ApplyQuestionSetEnrichment {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ContentRepository
  ) {}

  async execute(
    questionSetId: QuestionSetId,
    enrichment: ParsedQuestionSetEnrichment
  ): Promise<ApplyQuestionSetEnrichmentResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bundle = await this.repository.findQuestionSet(questionSetId);
      if (!bundle) throw new Error(`Question set does not exist: ${questionSetId}`);
      const needs = findQuestionSetEnrichmentNeeds(bundle);
      const lectureDocument = bundle.documents.find(
        (document) => document.documentType === ContentDocumentType.Lecture
      );
      const lectureRecord = lectureDocument
        ? bundle.lectures.find((lecture) => lecture.contentDocumentId === lectureDocument.id)
        : undefined;
      const lecturePatch = needs.lecture
        && lectureDocument
        && lectureRecord
        && enrichment.lecture
        && hasRenderableContent(enrichment.lecture)
        ? {
            lectureId: lectureRecord.id,
            document: {
              ...lectureDocument,
              content: enrichment.lecture,
              contentHash: await sha256Json(toJson(enrichment.lecture)),
              contentVersion: lectureDocument.contentVersion + 1
            }
          }
        : undefined;
      const neededQuestionIds = new Set(needs.explanationQuestionIds);
      const questionPatches = (await Promise.all(bundle.questions.map(async (question) => {
        const explanation = enrichment.explanations.get(question.id);
        if (!neededQuestionIds.has(question.id) || !explanation || !hasRenderableContent(explanation)) {
          return undefined;
        }
        const content = { ...question.content, explanation };
        return {
          ...question,
          content,
          contentHash: await sha256Json(toJson(content)),
          contentVersion: question.contentVersion + 1
        } satisfies QuestionRecord;
      }))).filter((question): question is QuestionRecord => Boolean(question));

      if (!lecturePatch && questionPatches.length === 0) {
        return { applied: false, lectureUpdated: false, explanationQuestionIds: [] };
      }
      const patchedById = new Map(questionPatches.map((question) => [question.id, question]));
      const nextQuestionHashes = bundle.questions.map(
        (question) => patchedById.get(question.id)?.contentHash ?? question.contentHash
      );
      const nextLectureHash = lecturePatch?.document.contentHash ?? lectureDocument?.contentHash ?? null;
      const nextContentHash = await sha256Json(toJson({
        questionHashes: nextQuestionHashes,
        lectureHash: nextLectureHash
      }));
      const applied = await this.unitOfWork.run((context) => this.repository.applyQuestionSetEnrichment({
        questionSetId,
        expectedContentVersion: bundle.questionSet.contentVersion,
        nextContentHash,
        lecture: lecturePatch,
        questions: questionPatches
      }, context));
      if (applied) {
        return {
          applied: true,
          lectureUpdated: Boolean(lecturePatch),
          explanationQuestionIds: questionPatches.map((question) => String(question.id))
        };
      }
    }
    throw new Error('Question set enrichment conflicted with another content update');
  }
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
