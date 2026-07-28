import { sha256Json, type Clock, type IdGenerator, type JsonObject } from '@/kernel/public';
import type {
  QuestionImportCandidateRecord,
  QuestionImportIssue
} from '../contracts/QuestionImportDraftRepository';
import {
  QuestionImportCandidateStatus,
  QuestionImportIssueCode
} from '../domain/QuestionImportCodes';
import { GeneratedContentParseError, GeneratedContentParser } from './GeneratedContentParser';

export interface ScanQuestionCandidateInput {
  readonly raw: JsonObject;
  readonly sequence: number;
  readonly difficulty?: number;
  readonly candidateId?: QuestionImportCandidateRecord['id'];
  readonly createdAt?: QuestionImportCandidateRecord['createdAt'];
  readonly preserveMaterialGroupId?: boolean;
  readonly preflightIssues?: readonly QuestionImportIssue[];
}

export class QuestionImportCandidateScanner {
  private readonly parser = new GeneratedContentParser();

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async scan(
    draftId: QuestionImportCandidateRecord['draftId'],
    capabilityCode: string,
    input: ScanQuestionCandidateInput
  ): Promise<QuestionImportCandidateRecord> {
    const now = this.clock.now();
    const difficulty = normalizeDifficulty(input.difficulty);
    if (input.preflightIssues?.length) {
      return {
        id: input.candidateId ?? this.ids.next('QuestionImportCandidateId'),
        draftId,
        sequence: input.sequence,
        raw: input.raw,
        difficulty,
        status: QuestionImportCandidateStatus.NeedsConfirmation,
        issues: input.preflightIssues,
        createdAt: input.createdAt ?? now,
        updatedAt: now
      };
    }
    try {
      const materialGroupId = typeof input.raw.materialGroupId === 'string'
        ? input.raw.materialGroupId.trim()
        : undefined;
      const parsed = this.parser.parseObject({
        lecture: {
          sections: [{
            id: 'import-contract',
            kind: 'summary',
            title: '导入结构',
            markdown: '仅用于校验题目结构。'
          }]
        },
        materialGroups: [],
        questions: [{
          ...input.raw,
          materialGroupId: null
        }]
      }, capabilityCode);
      const parsedContent = parsed.questions[0];
      if (!parsedContent) throw new Error('Question import candidate did not produce content');
      const content = materialGroupId && input.preserveMaterialGroupId
        ? { ...parsedContent, materialGroupId }
        : parsedContent;
      return {
        id: input.candidateId ?? this.ids.next('QuestionImportCandidateId'),
        draftId,
        sequence: input.sequence,
        raw: input.raw,
        content,
        contentHash: await sha256Json(JSON.parse(JSON.stringify(content))),
        difficulty,
        status: QuestionImportCandidateStatus.Ready,
        issues: [],
        createdAt: input.createdAt ?? now,
        updatedAt: now
      };
    } catch (error) {
      return {
        id: input.candidateId ?? this.ids.next('QuestionImportCandidateId'),
        draftId,
        sequence: input.sequence,
        raw: input.raw,
        difficulty,
        status: QuestionImportCandidateStatus.NeedsConfirmation,
        issues: importIssues(error),
        createdAt: input.createdAt ?? now,
        updatedAt: now
      };
    }
  }
}

function normalizeDifficulty(value: number | undefined): number {
  if (value === undefined) return 0.5;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Question import difficulty must be between 0 and 1');
  }
  return Math.round(value * 100) / 100;
}

function importIssues(error: unknown): readonly QuestionImportIssue[] {
  if (error instanceof GeneratedContentParseError) {
    return error.issues.map((issue) => ({
      code: classifyIssue(issue.code),
      path: issue.path.replace(/^\$\.questions\[0\]/, '$'),
      message: issue.message
    }));
  }
  return [{
    code: QuestionImportIssueCode.InvalidStructure,
    path: '$',
    message: error instanceof Error ? error.message : 'Question structure is invalid'
  }];
}

function classifyIssue(code: string): QuestionImportIssue['code'] {
  if (/answer_missing/.test(code)) return QuestionImportIssueCode.MissingAnswer;
  if (/answer_mismatch/.test(code)) return QuestionImportIssueCode.AnswerConflict;
  if (/option/.test(code)) return QuestionImportIssueCode.InvalidOptions;
  return QuestionImportIssueCode.InvalidStructure;
}
