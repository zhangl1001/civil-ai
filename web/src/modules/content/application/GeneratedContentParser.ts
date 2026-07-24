import type { JsonObject } from '@/kernel/public';
import type { ContentDocument } from '../contracts/ContentDocument';
import type { SingleChoiceQuestionContent } from '../contracts/QuestionContent';
import { ContentSchemaValidator, type ContentValidationIssue } from './ContentSchemaValidator';

export interface GeneratedLectureQuestionSet {
  readonly raw: JsonObject;
  readonly lecture: ContentDocument;
  readonly questions: readonly SingleChoiceQuestionContent[];
}

export class GeneratedContentParseError extends Error {
  constructor(
    readonly code: string,
    readonly issues: readonly ContentValidationIssue[]
  ) {
    super(code);
    this.name = 'GeneratedContentParseError';
  }
}

export class GeneratedContentParser {
  constructor(private readonly validator = new ContentSchemaValidator()) {}

  parseText(text: string): GeneratedLectureQuestionSet {
    const source = unwrapJsonFence(text.trim());
    let input: unknown;
    try {
      input = JSON.parse(source) as unknown;
    } catch {
      throw new GeneratedContentParseError('generation.json_invalid', [{
        code: 'generation.json_invalid',
        path: '$',
        message: 'Provider output must be one valid JSON object'
      }]);
    }
    return this.parseObject(input);
  }

  parseObject(input: unknown): GeneratedLectureQuestionSet {
    const root = asRecord(input);
    const extraKeys = Object.keys(root).filter((key) => key !== 'lecture' && key !== 'questions');
    if (extraKeys.length) {
      throw new GeneratedContentParseError('generation.root_fields_invalid', extraKeys.map((key) => ({
        code: 'generation.root_field_unknown',
        path: `$.${key}`,
        message: 'Generated root only permits lecture and questions'
      })));
    }
    const lectureResult = this.validator.parseDocument(root.lecture);
    if (!lectureResult.ok) throw new GeneratedContentParseError('generation.lecture_schema_invalid', lectureResult.error.issues);
    if (!Array.isArray(root.questions)) {
      throw new GeneratedContentParseError('generation.questions_invalid', [{
        code: 'generation.questions_invalid', path: '$.questions', message: 'Questions must be an array'
      }]);
    }
    const questions: SingleChoiceQuestionContent[] = [];
    const issues: ContentValidationIssue[] = [];
    root.questions.forEach((question, index) => {
      const result = this.validator.parseSingleChoiceQuestion(question);
      if (result.ok) questions.push(result.value);
      else issues.push(...result.error.issues.map((issue) => ({ ...issue, path: `$.questions[${index}]${issue.path.slice(1)}` })));
    });
    if (issues.length) throw new GeneratedContentParseError('generation.question_schema_invalid', issues);
    return { raw: root as JsonObject, lecture: lectureResult.value, questions };
  }
}

function unwrapJsonFence(source: string): string {
  if (!source.startsWith('```')) return source;
  const match = source.match(/^```(?:json)?\s*\n([\s\S]*)\n```$/i);
  if (!match) {
    throw new GeneratedContentParseError('generation.json_fence_invalid', [{
      code: 'generation.json_fence_invalid', path: '$', message: 'JSON code fence must wrap the entire response'
    }]);
  }
  return match[1].trim();
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GeneratedContentParseError('generation.root_invalid', [{
      code: 'generation.root_invalid', path: '$', message: 'Generated result must be an object'
    }]);
  }
  return input as Record<string, unknown>;
}
