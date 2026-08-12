import { canonicalJson, type JsonObject } from '@/kernel/public';
import type { ContentDocument } from '../contracts/ContentDocument';
import type { SingleChoiceQuestionContent } from '../contracts/QuestionContent';
import { contentBlockText, contentDocumentText } from '../domain/ContentDocumentText';
import { QuestionPresentationCode } from '../domain/ContentCodes';
import {
  GeneratedContentBlockCode,
  GeneratedContentValidationTier
} from '../domain/GeneratedContentBlockPolicy';
import type { GeneratedLectureQuestionSet } from './GeneratedContentParser';
import {
  isGraphicalGenerationCapability,
  practiceQuestionAcceptanceRatio
} from './PracticeCoreGenerationPolicy';

export interface ContentQualityIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly priority: ContentQualityPriority;
  readonly block: GeneratedContentBlockCode;
  readonly validationTier: GeneratedContentValidationTier;
}

export const ContentQualityPriority = {
  Blocking: 'blocking',
  PendingEnrichment: 'pending_enrichment',
  Advisory: 'advisory'
} as const;

export type ContentQualityPriority = typeof ContentQualityPriority[keyof typeof ContentQualityPriority];

export const ContentReadiness = {
  Ready: 'ready',
  ReadyWithPendingEnrichment: 'ready_with_pending_enrichment',
  Invalid: 'invalid'
} as const;

export type ContentReadiness = typeof ContentReadiness[keyof typeof ContentReadiness];

export interface ContentQualityReport {
  readonly valid: boolean;
  readonly readiness: ContentReadiness;
  readonly issues: readonly ContentQualityIssue[];
  readonly blockingIssues: readonly ContentQualityIssue[];
  readonly pendingIssues: readonly ContentQualityIssue[];
  readonly advisories: readonly ContentQualityIssue[];
  /** @deprecated Use pendingIssues and advisories when the distinction matters. */
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
  'quality.question_context_missing',
  'quality.expected_graphic_missing',
  'quality.material_group_content_missing',
  'quality.material_group_inconsistent'
]);
const pendingIssueCodes = new Set<string>([
  'quality.explanation_section_missing',
  'quality.option_analysis_incomplete'
]);

export class StructuredObjectiveContentQualityValidator {
  validate(output: GeneratedLectureQuestionSet, expectedCount: number, expectedCapabilityCode?: string): ContentQualityReport {
    const issues: ContentQualityIssue[] = [];
    const lectureText = contentDocumentText(output.lecture);
    if (output.lecture.blocks.length === 0 || compactLength(lectureText) === 0) {
      issue(issues, 'quality.lecture_empty', '$.lecture', 'Generated lecture must contain renderable teaching content');
    }
    if (output.questions.length !== expectedCount) {
      const code = isAcceptablePartialCount(
        output.questions.length,
        expectedCount,
        expectedCapabilityCode
      )
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
    const pendingIssues = issues.filter((item) => item.priority === ContentQualityPriority.PendingEnrichment);
    const advisories = issues.filter((item) => item.priority === ContentQualityPriority.Advisory);
    const warnings = [...pendingIssues, ...advisories];
    const readiness = blockingIssues.length
      ? ContentReadiness.Invalid
      : pendingIssues.length
        ? ContentReadiness.ReadyWithPendingEnrichment
        : ContentReadiness.Ready;
    return {
      valid: blockingIssues.length === 0,
      readiness,
      issues,
      blockingIssues,
      pendingIssues,
      advisories,
      warnings,
      metrics: {
        readiness,
        questionCount: output.questions.length,
        lectureCharacters: compactLength(lectureText),
        issueCount: issues.length,
        blockingIssueCount: blockingIssues.length,
        pendingIssueCount: pendingIssues.length,
        advisoryCount: advisories.length,
        warningCount: warnings.length
      }
    };
  }
}

function isBlockingIssue(code: string): boolean {
  return blockingIssueCodes.has(code);
}

function isAcceptablePartialCount(
  actualCount: number,
  expectedCount: number,
  expectedCapabilityCode = ''
): boolean {
  return expectedCount > 0
    && actualCount > 0
    && actualCount < expectedCount
    && actualCount / expectedCount >= practiceQuestionAcceptanceRatio(expectedCapabilityCode);
}

function validateMaterialGroups(
  questions: readonly SingleChoiceQuestionContent[],
  issues: ContentQualityIssue[]
): void {
  const groups = new Map<string, Array<{ question: SingleChoiceQuestionContent; index: number }>>();
  questions.forEach((question, index) => {
    if (!question.materialGroupId) return;
    const current = groups.get(question.materialGroupId) ?? [];
    current.push({ question, index });
    groups.set(question.materialGroupId, current);
  });
  groups.forEach((items, groupId) => {
    if (items.length < 2) {
      items.forEach(({ index }) => issue(
        issues,
        'quality.material_group_too_small',
        `$.questions[${index}].materialGroupId`,
        `Material group ${groupId} should contain at least two questions`
      ));
    }
    const materials = new Set(items.map(({ question }) => question.material ? JSON.stringify(question.material) : ''));
    if (materials.has('')) {
      items.filter(({ question }) => !question.material).forEach(({ index }) => issue(
        issues,
        'quality.material_group_content_missing',
        `$.questions[${index}].material`,
        `Material group ${groupId} is missing its shared material`
      ));
    }
    if (materials.size !== 1) {
      items.forEach(({ index }) => issue(
        issues,
        'quality.material_group_inconsistent',
        `$.questions[${index}].material`,
        `Material group ${groupId} must resolve to one identical material`
      ));
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
  if (!material.trim() && hasUnresolvedContextReference(prompt)) {
    issue(
      issues,
      'quality.question_context_missing',
      `${path}.material`,
      'Question prompt references material or an argument that was not generated'
    );
  }
  if (expectedCapabilityCode && isGraphicCapability(expectedCapabilityCode)
    && question.presentationCode !== QuestionPresentationCode.GraphicChoice) {
    issue(issues, 'quality.expected_graphic_missing', `${path}.prompt`, 'Graphic reasoning content should include a renderable visual');
  }
  if (question.options.length < 2 || question.options.length > 8) issue(issues, 'quality.option_count_invalid', `${path}.options`, 'Single-choice questions require between two and eight options');
  if (!/(下列|以下|根据|选择|哪项|问|判断|推出|符合|削弱|加强|支持|解释|评价|？|\?)/.test(prompt)) {
    issue(issues, 'quality.question_task_missing', `${path}.prompt`, 'Question prompt does not express a clear answering task');
  }
  if (/(正确答案|答案为|应选[ABCD])/i.test(`${material}${prompt}`)) {
    issue(issues, 'quality.answer_leak', path, 'Question material or prompt leaks the answer');
  }
  validateExplanationStructure(question.explanation, `${path}.explanation`, issues, question.options.map((option) => option.id));
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
  issues: ContentQualityIssue[],
  optionIds: readonly string[]
): void {
  const callouts = explanation.blocks.filter((block) => block.type === 'callout');
  if (explanation.blocks.length === 0) {
    issue(issues, 'quality.explanation_section_missing', path, 'Explanation is pending enrichment');
    return;
  }
  const optionSection = callouts.find((block) => block.kind === 'hint');
  const optionText = optionSection ? contentBlockText(optionSection) : '';
  if (optionSection && !optionIds.every((optionId) => new RegExp(`(?:^|\\s|\\*)${escapeRegExp(optionId)}(?:\\s|·|[.．、:：]|\\*)`).test(optionText))) {
    issue(
      issues,
      'quality.option_analysis_incomplete',
      path,
      'Explanation option analysis does not cover every available option'
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactLength(value: string): number {
  return value.replace(/\s+/g, '').length;
}

const isGraphicCapability = isGraphicalGenerationCapability;

function hasUnresolvedContextReference(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, '');
  return /^(?:上述|以上|前述|根据(?:上述|以上|前述|该|这段)?(?:材料|文段|文章|论证|实验|调查)|(?:下列|以下).{0,80}(?:上述|以上|前述|题干|材料中|文中|该论证))/.test(normalized);
}

function issue(issues: ContentQualityIssue[], code: string, path: string, message: string): void {
  const block = issueBlock(code);
  issues.push({
    code,
    path,
    message,
    priority: issuePriority(code),
    block,
    validationTier: blockValidationTier(block)
  });
}

function issuePriority(code: string): ContentQualityPriority {
  if (blockingIssueCodes.has(code)) return ContentQualityPriority.Blocking;
  if (pendingIssueCodes.has(code)) return ContentQualityPriority.PendingEnrichment;
  return ContentQualityPriority.Advisory;
}

function issueBlock(code: string): GeneratedContentBlockCode {
  if (code.startsWith('quality.lecture_')) return GeneratedContentBlockCode.Lecture;
  if (code === 'quality.option_analysis_incomplete' || code.startsWith('quality.explanation_')) {
    return GeneratedContentBlockCode.Explanation;
  }
  if (
    code.startsWith('quality.material_')
    || code === 'quality.data_material_not_structured'
    || code === 'quality.question_context_missing'
  ) {
    return GeneratedContentBlockCode.Material;
  }
  if (code.startsWith('quality.option_')) return GeneratedContentBlockCode.Options;
  if (code === 'quality.question_count_mismatch' || code === 'quality.question_count_partial') {
    return GeneratedContentBlockCode.QuestionSet;
  }
  return GeneratedContentBlockCode.Prompt;
}

function blockValidationTier(block: GeneratedContentBlockCode): GeneratedContentValidationTier {
  if (block === GeneratedContentBlockCode.Explanation) {
    return GeneratedContentValidationTier.PendingEnrichment;
  }
  if (block === GeneratedContentBlockCode.Diagnosis) return GeneratedContentValidationTier.PostPractice;
  return GeneratedContentValidationTier.RequiredToPractice;
}
