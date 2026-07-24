import { canonicalJson, type JsonObject } from '@/kernel/public';
import type { ContentBlock, ContentDocument } from '../contracts/ContentDocument';
import type { SingleChoiceQuestionContent } from '../contracts/QuestionContent';
import type { GeneratedLectureQuestionSet } from './GeneratedContentParser';

export interface ContentQualityIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ContentQualityReport {
  readonly valid: boolean;
  readonly issues: readonly ContentQualityIssue[];
  readonly metrics: JsonObject;
}

export class WeakeningContentQualityValidator {
  validate(output: GeneratedLectureQuestionSet, expectedCount: number): ContentQualityReport {
    const issues: ContentQualityIssue[] = [];
    const lectureText = documentText(output.lecture);
    if (output.questions.length !== expectedCount) {
      issue(issues, 'quality.question_count_mismatch', '$.questions', `Expected ${expectedCount} questions, got ${output.questions.length}`);
    }
    if (output.lecture.blocks.length < 6) {
      issue(issues, 'quality.lecture_sections_insufficient', '$.lecture.blocks', 'Lecture requires at least six structured sections');
    }
    if (compactLength(lectureText) < 420) {
      issue(issues, 'quality.lecture_too_shallow', '$.lecture', 'Lecture must contain substantial teaching content');
    }
    const fingerprints = new Set<string>();
    output.questions.forEach((question, index) => validateQuestion(question, index, issues, fingerprints));
    return {
      valid: issues.length === 0,
      issues,
      metrics: {
        questionCount: output.questions.length,
        lectureCharacters: compactLength(lectureText),
        issueCount: issues.length
      }
    };
  }
}

function validateQuestion(
  question: SingleChoiceQuestionContent,
  index: number,
  issues: ContentQualityIssue[],
  fingerprints: Set<string>
): void {
  const path = `$.questions[${index}]`;
  const prompt = documentText(question.prompt);
  const material = question.material ? documentText(question.material) : '';
  const explanation = documentText(question.explanation);
  if (question.options.length !== 4) issue(issues, 'quality.option_count_invalid', `${path}.options`, 'Civil service single-choice questions require four options');
  if (compactLength(`${material}${prompt}`) < 45) issue(issues, 'quality.prompt_too_short', `${path}.prompt`, 'Question prompt is too short');
  if (!/(下列|以下|根据|请选择|哪项|问|？|\?)/.test(prompt)) {
    issue(issues, 'quality.question_task_missing', `${path}.prompt`, 'Question prompt does not express a clear answering task');
  }
  if (/(正确答案|答案为|应选[ABCD])/i.test(`${material}${prompt}`)) {
    issue(issues, 'quality.answer_leak', path, 'Question material or prompt leaks the answer');
  }
  if (compactLength(explanation) < 90) {
    issue(issues, 'quality.explanation_too_shallow', `${path}.explanation`, 'Explanation must include argument structure and distractor analysis');
  }
  const optionTexts = question.options.map((option) => documentText(option.content).replace(/\s+/g, ''));
  if (optionTexts.some((text) => text.length < 8)) issue(issues, 'quality.option_too_short', `${path}.options`, 'Options must be substantive');
  if (new Set(optionTexts).size !== optionTexts.length) issue(issues, 'quality.option_duplicate', `${path}.options`, 'Options must be unique');
  const fingerprint = canonicalJson({
    prompt: prompt.replace(/\s+/g, ''),
    options: optionTexts
  });
  if (fingerprints.has(fingerprint)) issue(issues, 'quality.question_duplicate', path, 'Question duplicates another generated question');
  fingerprints.add(fingerprint);
}

export function documentText(document: ContentDocument): string {
  return document.blocks.map((block) => blockText(block)).filter(Boolean).join('\n');
}

function blockText(block: ContentBlock): string {
  if (block.type === 'markdown') return block.source;
  if (block.type === 'data_table') {
    return [block.caption ?? '', ...block.rows.flatMap((row) => Object.values(row).map((value) => value === null ? '' : String(value)))].join(' ');
  }
  if (block.type === 'svg_diagram' || block.type === 'image') return block.alt;
  if (block.type === 'formula') return block.source;
  return [block.title ?? '', ...block.blocks.map((child) => blockText(child))].join(' ');
}

function compactLength(value: string): number {
  return value.replace(/\s+/g, '').length;
}

function issue(issues: ContentQualityIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}
