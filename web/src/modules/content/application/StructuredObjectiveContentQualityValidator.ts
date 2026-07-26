import { canonicalJson, type JsonObject } from '@/kernel/public';
import type { ContentDocument } from '../contracts/ContentDocument';
import type { SingleChoiceQuestionContent } from '../contracts/QuestionContent';
import { contentBlockText, contentDocumentText } from '../domain/ContentDocumentText';
import type { GeneratedLectureQuestionSet } from './GeneratedContentParser';

export interface ContentQualityIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ContentQualityReport {
  readonly valid: boolean;
  readonly issues: readonly ContentQualityIssue[];
  readonly blockingIssues: readonly ContentQualityIssue[];
  readonly warnings: readonly ContentQualityIssue[];
  readonly metrics: JsonObject;
}

// Schema parsing already rejects malformed documents, option ids and answer
// references. Quality review must only block defects that make the committed
// question set unusable; pedagogical quality signals remain observable warnings.
const blockingIssueCodes = new Set<string>([
  'quality.lecture_empty',
  'quality.question_count_mismatch',
  'quality.option_count_invalid',
  'quality.option_empty',
  'quality.option_duplicate',
  'quality.material_group_content_missing',
  'quality.material_group_inconsistent'
]);
const PARTIAL_ACCEPTANCE_RATIO = 0.8;

export class StructuredObjectiveContentQualityValidator {
  validate(output: GeneratedLectureQuestionSet, expectedCount: number, expectedCapabilityCode?: string): ContentQualityReport {
    const issues: ContentQualityIssue[] = [];
    const lectureText = contentDocumentText(output.lecture);
    if (output.lecture.blocks.length === 0 || compactLength(lectureText) === 0) {
      issue(issues, 'quality.lecture_empty', '$.lecture', 'Generated lecture must contain renderable teaching content');
    }
    if (output.questions.length !== expectedCount) {
      const code = isAcceptablePartialCount(output.questions.length, expectedCount)
        ? 'quality.question_count_partial'
        : 'quality.question_count_mismatch';
      issue(issues, code, '$.questions', `Expected ${expectedCount} questions, got ${output.questions.length}`);
    }
    const fingerprints = new Set<string>();
    output.questions.forEach((question, index) => validateQuestion(
      question,
      index,
      issues,
      fingerprints,
      expectedCapabilityCode
    ));
    validateMaterialGroups(output.questions, issues);
    const blockingIssues = issues.filter((item) => isBlockingIssue(item.code));
    const warnings = issues.filter((item) => !isBlockingIssue(item.code));
    return {
      valid: blockingIssues.length === 0,
      issues,
      blockingIssues,
      warnings,
      metrics: {
        questionCount: output.questions.length,
        lectureCharacters: compactLength(lectureText),
        issueCount: issues.length,
        blockingIssueCount: blockingIssues.length,
        warningCount: warnings.length
      }
    };
  }
}

function isBlockingIssue(code: string): boolean {
  return blockingIssueCodes.has(code);
}

function isAcceptablePartialCount(actualCount: number, expectedCount: number): boolean {
  return expectedCount > 0
    && actualCount > 0
    && actualCount < expectedCount
    && actualCount / expectedCount > PARTIAL_ACCEPTANCE_RATIO;
}

function validateMaterialGroups(
  questions: readonly SingleChoiceQuestionContent[],
  issues: ContentQualityIssue[]
): void {
  const groups = new Map<string, SingleChoiceQuestionContent[]>();
  questions.forEach((question) => {
    if (!question.materialGroupId) return;
    const current = groups.get(question.materialGroupId) ?? [];
    current.push(question);
    groups.set(question.materialGroupId, current);
  });
  groups.forEach((items, groupId) => {
    if (items.length < 2) {
      issue(issues, 'quality.material_group_too_small', '$.questions', `Material group ${groupId} must contain at least two questions`);
    }
    const materials = new Set(items.map((item) => item.material ? JSON.stringify(item.material) : ''));
    if (materials.has('')) {
      issue(issues, 'quality.material_group_content_missing', '$.questions', `Material group ${groupId} is missing its shared material`);
    }
    if (materials.size !== 1) {
      issue(issues, 'quality.material_group_inconsistent', '$.questions', `Material group ${groupId} must resolve to one identical material`);
    }
  });
}

function validateQuestion(
  question: SingleChoiceQuestionContent,
  index: number,
  issues: ContentQualityIssue[],
  fingerprints: Set<string>,
  expectedCapabilityCode?: string
): void {
  const path = `$.questions[${index}]`;
  // capabilityCode is deterministic GenerationSpec metadata injected by the parser.
  // It is not a model-quality concern and must never cause a second provider call.
  if (expectedCapabilityCode && question.capabilityCode !== expectedCapabilityCode) {
    throw new Error(`Deterministic capability normalization failed at ${path}`);
  }
  const prompt = contentDocumentText(question.prompt);
  const material = question.material ? contentDocumentText(question.material) : '';
  if (question.options.length !== 4) issue(issues, 'quality.option_count_invalid', `${path}.options`, 'Civil service single-choice questions require four options');
  if (!/(下列|以下|根据|选择|哪项|问|判断|推出|符合|削弱|加强|支持|解释|评价|？|\?)/.test(prompt)) {
    issue(issues, 'quality.question_task_missing', `${path}.prompt`, 'Question prompt does not express a clear answering task');
  }
  if (/(正确答案|答案为|应选[ABCD])/i.test(`${material}${prompt}`)) {
    issue(issues, 'quality.answer_leak', path, 'Question material or prompt leaks the answer');
  }
  validateExplanationStructure(question.explanation, `${path}.explanation`, issues);
  const optionTexts = question.options.map((option) => contentDocumentText(option.content).replace(/\s+/g, ''));
  if (optionTexts.some((text) => text.length < 1)) issue(issues, 'quality.option_empty', `${path}.options`, 'Options must not be empty');
  if (new Set(optionTexts).size !== optionTexts.length) issue(issues, 'quality.option_duplicate', `${path}.options`, 'Options must be unique');
  const fingerprint = canonicalJson({
    prompt: prompt.replace(/\s+/g, ''),
    options: optionTexts
  });
  if (fingerprints.has(fingerprint)) issue(issues, 'quality.question_duplicate', path, 'Question duplicates another generated question');
  fingerprints.add(fingerprint);
}

function validateExplanationStructure(
  explanation: ContentDocument,
  path: string,
  issues: ContentQualityIssue[]
): void {
  const callouts = explanation.blocks.filter((block) => block.type === 'callout');
  const requiredKinds = ['conclusion', 'method', 'hint'] as const;
  requiredKinds.forEach((kind) => {
    if (!callouts.some((block) => block.kind === kind)) {
      issue(
        issues,
        'quality.explanation_section_missing',
        path,
        `Explanation requires a ${kind} section`
      );
    }
  });
  const optionSection = callouts.find((block) => block.kind === 'hint');
  const optionText = optionSection ? contentBlockText(optionSection) : '';
  if (!['A', 'B', 'C', 'D'].every((optionId) => new RegExp(`(?:^|\\s|\\*)${optionId}(?:\\s|·|[.．、:：]|\\*)`).test(optionText))) {
    issue(
      issues,
      'quality.option_analysis_incomplete',
      path,
      'Explanation must analyze options A, B, C and D'
    );
  }
}

function compactLength(value: string): number {
  return value.replace(/\s+/g, '').length;
}

function issue(issues: ContentQualityIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}
