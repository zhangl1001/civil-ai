import { parseStructuredJson } from '@/capabilities/ai-runtime/public';
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

  parseText(text: string, expectedCapabilityCode?: string): GeneratedLectureQuestionSet {
    let input: unknown;
    try {
      input = parseStructuredJson(text);
    } catch {
      throw new GeneratedContentParseError('generation.json_invalid', [{
        code: 'generation.json_invalid',
        path: '$',
        message: 'Provider output must be one valid JSON object'
      }]);
    }
    return this.parseObject(input, expectedCapabilityCode);
  }

  parseObject(input: unknown, expectedCapabilityCode?: string): GeneratedLectureQuestionSet {
    const root = normalizeAuthoringRoot(asRecord(input), expectedCapabilityCode);
    const extraKeys = Object.keys(root).filter((key) => key !== 'lecture' && key !== 'questions');
    if (extraKeys.length) {
      throw new GeneratedContentParseError('generation.root_fields_invalid', extraKeys.map((key) => ({
        code: 'generation.root_field_unknown',
        path: `$.${key}`,
        message: 'Generated root only permits lecture and questions'
      })));
    }
    const lectureInput = decodeEmbeddedJson(root.lecture);
    const lectureResult = this.validator.parseDocument(lectureInput);
    if (!lectureResult.ok) {
      throw new GeneratedContentParseError(
        'generation.lecture_schema_invalid',
        lectureResult.error.issues.map((issue) => ({
          ...issue,
          path: `$.lecture${issue.path.slice(1)}`
        }))
      );
    }
    if (!Array.isArray(root.questions)) {
      throw new GeneratedContentParseError('generation.questions_invalid', [{
        code: 'generation.questions_invalid', path: '$.questions', message: 'Questions must be an array'
      }]);
    }
    const questionInputs = root.questions.map(decodeEmbeddedJson);
    const questions: SingleChoiceQuestionContent[] = [];
    const issues: ContentValidationIssue[] = [];
    questionInputs.forEach((question, index) => {
      const result = this.validator.parseSingleChoiceQuestion(question);
      if (result.ok) questions.push(result.value);
      else issues.push(...result.error.issues.map((issue) => ({ ...issue, path: `$.questions[${index}]${issue.path.slice(1)}` })));
    });
    if (issues.length) throw new GeneratedContentParseError('generation.question_schema_invalid', issues);
    return {
      raw: { ...root, lecture: lectureInput, questions: questionInputs } as JsonObject,
      lecture: lectureResult.value,
      questions
    };
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GeneratedContentParseError('generation.root_invalid', [{
      code: 'generation.root_invalid', path: '$', message: 'Generated result must be an object'
    }]);
  }
  return input as Record<string, unknown>;
}

function decodeEmbeddedJson(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const source = input.trim();
  if (!source.startsWith('{') && !source.startsWith('[')) return input;
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed : input;
  } catch {
    return input;
  }
}

function normalizeAuthoringRoot(
  root: Record<string, unknown>,
  expectedCapabilityCode?: string
): Record<string, unknown> {
  const lecture = asOptionalRecord(decodeEmbeddedJson(root.lecture));
  if (!lecture || !Array.isArray(lecture.sections)) {
    return injectCapabilityCode(root, expectedCapabilityCode);
  }
  const issues: ContentValidationIssue[] = [];
  const materialGroups = authoringMaterialGroups(root.materialGroups, issues);
  const materialGroupUseCounts = countMaterialGroupUses(root.questions);
  const blocks = lecture.sections.map((section, index) => authoringSection(section, index, issues));
  const decodedQuestions = decodeEmbeddedJson(root.questions);
  const questions = Array.isArray(decodedQuestions)
    ? decodedQuestions.map((question, index) => authoringQuestion(
      decodeEmbeddedJson(question),
      index,
      materialGroups,
      materialGroupUseCounts,
      expectedCapabilityCode,
      issues
    ))
    : decodedQuestions;
  if (issues.length || blocks.some((block) => !block) || !Array.isArray(questions) || questions.some((question) => !question)) {
    throw new GeneratedContentParseError('generation.author_schema_invalid', issues.length ? issues : [{
      code: 'generation.questions_invalid',
      path: '$.questions',
      message: 'Questions must be an array'
    }]);
  }
  return {
    lecture: { schemaVersion: 'content.v1', blocks },
    questions
  };
}

function authoringSection(
  input: unknown,
  index: number,
  issues: ContentValidationIssue[]
): Record<string, unknown> | undefined {
  const path = `$.lecture.sections[${index}]`;
  const section = asOptionalRecord(input);
  if (!section) {
    issues.push({ code: 'generation.section_invalid', path, message: 'Lecture section must be an object' });
    return undefined;
  }
  const id = requiredAuthorText(section.id, `${path}.id`, issues);
  const kind = requiredAuthorText(section.kind, `${path}.kind`, issues);
  const title = requiredAuthorText(section.title, `${path}.title`, issues);
  const markdown = requiredAuthorText(section.markdown, `${path}.markdown`, issues);
  if (!id || !kind || !title || !markdown) return undefined;
  const source = `## ${title}\n\n${markdown}`;
  if (kind === 'method' || kind === 'trap' || kind === 'summary' || kind === 'example' || kind === 'boundary') {
    return {
      id,
      type: 'callout',
      kind: kind === 'summary' ? 'conclusion' : kind === 'example' || kind === 'boundary' ? 'hint' : kind,
      title,
      blocks: [{ id: `${id}:content`, type: 'text', source: markdown }]
    };
  }
  return { id, type: 'text', source };
}

function authoringQuestion(
  input: unknown,
  index: number,
  materialGroups: ReadonlyMap<string, string>,
  materialGroupUseCounts: ReadonlyMap<string, number>,
  expectedCapabilityCode: string | undefined,
  issues: ContentValidationIssue[]
): Record<string, unknown> | undefined {
  const question = asOptionalRecord(input);
  if (question?.templateCode === 'single_choice') {
    return expectedCapabilityCode
      ? { ...question, capabilityCode: expectedCapabilityCode }
      : question;
  }
  const path = `$.questions[${index}]`;
  if (!question) {
    issues.push({ code: 'generation.question_invalid', path, message: 'Question must be an object' });
    return undefined;
  }
  const id = requiredAuthorText(question.id, `${path}.id`, issues);
  const capabilityCode = expectedCapabilityCode
    ?? requiredAuthorText(question.capabilityCode, `${path}.capabilityCode`, issues);
  const prompt = requiredAuthorText(question.prompt, `${path}.prompt`, issues);
  const correctOptionId = requiredAuthorText(question.correctOptionId, `${path}.correctOptionId`, issues);
  if (!Array.isArray(question.options)) {
    issues.push({ code: 'generation.options_invalid', path: `${path}.options`, message: 'Options must be an array' });
    return undefined;
  }
  const options = question.options.map((inputOption, optionIndex) => {
    const optionPath = `${path}.options[${optionIndex}]`;
    const option = asOptionalRecord(inputOption);
    if (!option) {
      issues.push({ code: 'generation.option_invalid', path: optionPath, message: 'Option must be an object' });
      return undefined;
    }
    const optionId = requiredAuthorText(option.id, `${optionPath}.id`, issues);
    const text = requiredAuthorText(option.text, `${optionPath}.text`, issues);
    return optionId && text
      ? { id: optionId, content: authorDocument(`${id || `question-${index}`}:option:${optionId}`, text) }
      : undefined;
  });
  const optionIds = options.flatMap((option) => option ? [option.id] : []);
  const explanation = id && correctOptionId
    ? authoringExplanation(question.explanation, id, correctOptionId, optionIds, `${path}.explanation`, issues)
    : undefined;
  if (!id || !capabilityCode || !prompt || !explanation || !correctOptionId || options.some((option) => !option)) return undefined;
  const requestedMaterialGroupId = optionalAuthorText(question.materialGroupId, `${path}.materialGroupId`, issues);
  const groupedMaterial = requestedMaterialGroupId ? materialGroups.get(requestedMaterialGroupId) : undefined;
  if (requestedMaterialGroupId && !groupedMaterial) {
    issues.push({
      code: 'generation.material_group_missing',
      path: `${path}.materialGroupId`,
      message: `Question references unknown material group ${requestedMaterialGroupId}`
    });
  }
  // A one-question "shared" group is semantically just independent material.
  // Normalize it locally instead of spending a second model request to move the same text.
  const materialGroupId = requestedMaterialGroupId
    && (materialGroupUseCounts.get(requestedMaterialGroupId) ?? 0) >= 2
    ? requestedMaterialGroupId
    : undefined;
  const materialSource = groupedMaterial ?? question.material;
  const material = materialSource === null || materialSource === undefined || materialSource === ''
    ? null
    : typeof materialSource === 'string'
      ? authorDocument(`${materialGroupId || id}:material`, materialSource)
      : materialSource;
  return {
    templateCode: 'single_choice',
    schemaVersion: 'question.single_choice.v2',
    capabilityCode,
    ...(materialGroupId ? { materialGroupId } : {}),
    material,
    prompt: authorDocument(`${id}:prompt`, prompt),
    options,
    correctOptionId,
    explanation
  };
}

function injectCapabilityCode(
  root: Record<string, unknown>,
  expectedCapabilityCode?: string
): Record<string, unknown> {
  if (!expectedCapabilityCode || !Array.isArray(root.questions)) return root;
  return {
    ...root,
    questions: root.questions.map((input) => {
      const question = asOptionalRecord(decodeEmbeddedJson(input));
      return question ? { ...question, capabilityCode: expectedCapabilityCode } : input;
    })
  };
}

function countMaterialGroupUses(input: unknown): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const decoded = decodeEmbeddedJson(input);
  if (!Array.isArray(decoded)) return counts;
  decoded.forEach((item) => {
    const question = asOptionalRecord(decodeEmbeddedJson(item));
    if (typeof question?.materialGroupId !== 'string' || !question.materialGroupId.trim()) return;
    const id = question.materialGroupId.trim();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  return counts;
}

function authoringExplanation(
  input: unknown,
  questionId: string,
  correctOptionId: string,
  optionIds: readonly string[],
  path: string,
  issues: ContentValidationIssue[]
): Record<string, unknown> | undefined {
  const explanation = asOptionalRecord(decodeEmbeddedJson(input));
  if (!explanation) {
    issues.push({ code: 'generation.explanation_invalid', path, message: 'Explanation must be a structured object' });
    return undefined;
  }
  const knowledgePoint = requiredAuthorText(explanation.knowledgePoint, `${path}.knowledgePoint`, issues);
  const conclusion = requiredAuthorText(explanation.conclusion, `${path}.conclusion`, issues);
  const steps = authorTextArray(explanation.steps, `${path}.steps`, issues, 1);
  const pitfalls = authorTextArray(explanation.pitfalls, `${path}.pitfalls`, issues, 0);
  const optionAnalysis = authorOptionAnalysis(explanation.optionAnalysis, optionIds, `${path}.optionAnalysis`, issues);
  if (!knowledgePoint || !conclusion || !steps || !pitfalls || !optionAnalysis) return undefined;
  const correctAnalyses = optionAnalysis.filter((item) => item.verdict === 'correct');
  if (correctAnalyses.length !== 1 || correctAnalyses[0]?.optionId !== correctOptionId) {
    issues.push({
      code: 'generation.explanation_answer_mismatch',
      path: `${path}.optionAnalysis`,
      message: 'Exactly the correct option must have verdict correct'
    });
    return undefined;
  }
  const blocks = [
    calloutBlock(`${questionId}:explanation:conclusion`, 'conclusion', '结论与考点', `**考点：${knowledgePoint}**\n\n${conclusion}`),
    calloutBlock(`${questionId}:explanation:steps`, 'method', '解题思路', steps.map((item, index) => `${index + 1}. ${item}`).join('\n')),
    calloutBlock(
      `${questionId}:explanation:options`,
      'hint',
      '选项辨析',
      optionAnalysis.map((item) => `**${item.optionId} · ${item.verdict === 'correct' ? '正确' : '排除'}**\n\n${item.analysis}`).join('\n\n')
    )
  ];
  if (pitfalls.length) {
    blocks.push(calloutBlock(
      `${questionId}:explanation:pitfalls`,
      'trap',
      '易错提醒',
      pitfalls.map((item) => `- ${item}`).join('\n')
    ));
  }
  return { schemaVersion: 'content.v1', blocks };
}

function authorTextArray(
  input: unknown,
  path: string,
  issues: ContentValidationIssue[],
  minimum: number
): readonly string[] | undefined {
  if (!Array.isArray(input) || input.length < minimum) {
    issues.push({ code: 'generation.explanation_list_invalid', path, message: `Expected at least ${minimum} items` });
    return undefined;
  }
  const values = input.map((item, index) => requiredAuthorText(item, `${path}[${index}]`, issues));
  return values.some((item) => !item) ? undefined : values as string[];
}

function authorOptionAnalysis(
  input: unknown,
  expectedOptionIds: readonly string[],
  path: string,
  issues: ContentValidationIssue[]
): readonly { optionId: string; verdict: string; analysis: string }[] | undefined {
  if (
    expectedOptionIds.length < 2
    || expectedOptionIds.length > 8
    || !Array.isArray(input)
    || input.length !== expectedOptionIds.length
  ) {
    issues.push({
      code: 'generation.option_analysis_invalid',
      path,
      message: 'Option analysis must cover every generated option exactly once'
    });
    return undefined;
  }
  const expected = new Set(expectedOptionIds);
  const values = input.map((item, index) => {
    const record = asOptionalRecord(item);
    const itemPath = `${path}[${index}]`;
    if (!record) {
      issues.push({ code: 'generation.option_analysis_item_invalid', path: itemPath, message: 'Option analysis item must be an object' });
      return undefined;
    }
    const optionId = requiredAuthorText(record.optionId, `${itemPath}.optionId`, issues);
    const verdict = requiredAuthorText(record.verdict, `${itemPath}.verdict`, issues);
    const analysis = requiredAuthorText(record.analysis, `${itemPath}.analysis`, issues);
    if (!optionId || !expected.has(optionId) || !verdict || !['correct', 'incorrect'].includes(verdict) || !analysis) {
      issues.push({ code: 'generation.option_analysis_contract_invalid', path: itemPath, message: 'Option analysis contract is invalid' });
      return undefined;
    }
    return { optionId, verdict, analysis };
  });
  const optionIds = new Set(values.flatMap((item) => item ? [item.optionId] : []));
  if (
    values.some((item) => !item)
    || optionIds.size !== expected.size
    || [...expected].some((optionId) => !optionIds.has(optionId))
  ) {
    issues.push({
      code: 'generation.option_analysis_duplicate',
      path,
      message: 'Option analysis must cover each option once'
    });
    return undefined;
  }
  return values as { optionId: string; verdict: string; analysis: string }[];
}

function calloutBlock(id: string, kind: string, title: string, source: string): Record<string, unknown> {
  return {
    id,
    type: 'callout',
    kind,
    title,
    blocks: [{ id: `${id}:content`, type: 'text', source }]
  };
}

function authoringMaterialGroups(
  input: unknown,
  issues: ContentValidationIssue[]
): ReadonlyMap<string, string> {
  if (input === undefined) return new Map();
  if (!Array.isArray(input)) {
    issues.push({
      code: 'generation.material_groups_invalid',
      path: '$.materialGroups',
      message: 'Material groups must be an array'
    });
    return new Map();
  }
  const groups = new Map<string, string>();
  input.forEach((item, index) => {
    const path = `$.materialGroups[${index}]`;
    const group = asOptionalRecord(decodeEmbeddedJson(item));
    if (!group) {
      issues.push({ code: 'generation.material_group_invalid', path, message: 'Material group must be an object' });
      return;
    }
    const id = requiredAuthorText(group.id, `${path}.id`, issues);
    const markdown = requiredAuthorText(group.markdown, `${path}.markdown`, issues);
    if (!id || !markdown) return;
    if (groups.has(id)) {
      issues.push({ code: 'generation.material_group_duplicate', path: `${path}.id`, message: `Duplicate material group ${id}` });
      return;
    }
    groups.set(id, markdown);
  });
  return groups;
}

function authorDocument(id: string, source: string): Record<string, unknown> {
  return {
    schemaVersion: 'content.v1',
    blocks: [{ id, type: 'text', source }]
  };
}

function requiredAuthorText(
  input: unknown,
  path: string,
  issues: ContentValidationIssue[]
): string | undefined {
  if (typeof input === 'string' && input.trim()) return input.trim();
  issues.push({ code: 'generation.author_text_invalid', path, message: 'Expected a non-empty string' });
  return undefined;
}

function optionalAuthorText(
  input: unknown,
  path: string,
  issues: ContentValidationIssue[]
): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  return requiredAuthorText(input, path, issues);
}

function asOptionalRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}
