import { failure, success, type Result } from '@/kernel/public';
import type {
  CalloutBlock,
  ContentBlock,
  ContentDocument,
  DataTableBlock,
  DataTableCell,
  DataTableColumn,
  FormulaBlock,
  ImageBlock,
  TextBlock,
  SvgDiagramBlock
} from '../contracts/ContentDocument';
import type { SingleChoiceOption, SingleChoiceQuestionContent } from '../contracts/QuestionContent';
import { CalloutKind, ContentAlignment, ContentBlockType, QuestionTemplateCode } from '../domain/ContentCodes';
import { resolveQuestionPresentation } from '../domain/QuestionPresentation';
import { ImageSourceKind, resolveImageSource } from '@/capabilities/content-rendering/public';

export interface ContentValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ContentValidationFailure {
  readonly code: 'content.schema_invalid';
  readonly issues: readonly ContentValidationIssue[];
}

const MAX_BLOCK_DEPTH = 4;
const blockTypes = new Set<string>(Object.values(ContentBlockType));
const calloutKinds = new Set<string>(Object.values(CalloutKind));
const alignments = new Set<string>(Object.values(ContentAlignment));

export class ContentSchemaValidator {
  parseDocument(input: unknown): Result<ContentDocument, ContentValidationFailure> {
    const issues: ContentValidationIssue[] = [];
    const document = parseDocument(input, '$', issues, 0);
    return document && issues.length === 0 ? success(document) : failure({ code: 'content.schema_invalid', issues });
  }

  parseSingleChoiceQuestion(input: unknown): Result<SingleChoiceQuestionContent, ContentValidationFailure> {
    const issues: ContentValidationIssue[] = [];
    const record = asRecord(input, '$', issues);
    if (!record) return failure({ code: 'content.schema_invalid', issues });
    const templateCode = readString(record.templateCode, '$.templateCode', issues);
    if (templateCode !== QuestionTemplateCode.SingleChoice) {
      issue(issues, 'question.template_unsupported', '$.templateCode', 'Only single_choice is supported by this schema version');
    }
    const schemaVersion = readString(record.schemaVersion, '$.schemaVersion', issues);
    const capabilityCode = readString(record.capabilityCode, '$.capabilityCode', issues);
    const prompt = parseDocument(record.prompt, '$.prompt', issues, 0);
    // Explanation is an enrichment block. A malformed or missing explanation
    // must not discard an otherwise answerable question.
    const explanationIssues: ContentValidationIssue[] = [];
    const explanation = record.explanation === undefined || record.explanation === null
      ? emptyDocument('question:explanation:empty')
      : parseDocument(record.explanation, '$.explanation', explanationIssues, 0)
        ?? emptyDocument('question:explanation:invalid');
    const material = record.material === undefined || record.material === null
      ? undefined
      : parseDocument(record.material, '$.material', issues, 0);
    const materialGroupId = readOptionalString(record.materialGroupId, '$.materialGroupId', issues);
    const options = parseOptions(record.options, issues);
    const correctOptionId = readString(record.correctOptionId, '$.correctOptionId', issues);
    if (options && correctOptionId && !options.some((option) => option.id === correctOptionId)) {
      issue(issues, 'question.answer_missing', '$.correctOptionId', 'Correct option must reference one option id');
    }
    if (issues.length || !schemaVersion || !capabilityCode || !prompt || !explanation || !options || !correctOptionId) {
      return failure({ code: 'content.schema_invalid', issues });
    }
    const normalized = {
      templateCode: QuestionTemplateCode.SingleChoice,
      schemaVersion,
      capabilityCode,
      materialGroupId,
      material,
      prompt,
      options,
      correctOptionId,
      explanation
    };
    return success({
      ...normalized,
      presentationCode: resolveQuestionPresentation(normalized)
    });
  }
}

function parseDocument(
  input: unknown,
  path: string,
  issues: ContentValidationIssue[],
  depth: number
): ContentDocument | undefined {
  if (depth > MAX_BLOCK_DEPTH) {
    issue(issues, 'content.depth_exceeded', path, `Content nesting cannot exceed ${MAX_BLOCK_DEPTH}`);
    return undefined;
  }
  const record = asRecord(input, path, issues);
  if (!record) return undefined;
  const schemaVersion = readString(record.schemaVersion, `${path}.schemaVersion`, issues);
  if (!Array.isArray(record.blocks)) {
    issue(issues, 'content.blocks_invalid', `${path}.blocks`, 'Blocks must be an array');
    return undefined;
  }
  const blocks = record.blocks.map((block, index) => parseBlock(block, `${path}.blocks[${index}]`, issues, depth));
  validateSiblingBlockIds(blocks, `${path}.blocks`, issues);
  if (!schemaVersion || blocks.some((block) => !block)) return undefined;
  return { schemaVersion, blocks: blocks as ContentBlock[] };
}

function parseBlock(
  input: unknown,
  path: string,
  issues: ContentValidationIssue[],
  depth: number
): ContentBlock | undefined {
  const record = asRecord(input, path, issues);
  if (!record) return undefined;
  const id = readString(record.id, `${path}.id`, issues);
  const type = readString(record.type, `${path}.type`, issues);
  if (!type || !blockTypes.has(type)) {
    issue(issues, 'content.block_type_invalid', `${path}.type`, 'Unknown content block type');
    return undefined;
  }
  if (!id) return undefined;
  if (type === ContentBlockType.Text) {
    const source = readString(record.source, `${path}.source`, issues, true);
    return source === undefined ? undefined : { id, type, source } satisfies TextBlock;
  }
  if (type === ContentBlockType.DataTable) return parseDataTable(id, record, path, issues);
  if (type === ContentBlockType.SvgDiagram) {
    const markup = readString(record.markup, `${path}.markup`, issues);
    const alt = readString(record.alt, `${path}.alt`, issues);
    const viewBox = readOptionalString(record.viewBox, `${path}.viewBox`, issues);
    if (markup && !hasSvgRoot(markup)) {
      issue(issues, 'content.svg_root_invalid', `${path}.markup`, 'SVG diagram must contain one svg root element');
    }
    if (markup && !hasSvgViewBox(markup)) {
      issue(issues, 'content.svg_viewbox_missing', `${path}.viewBox`, 'SVG diagram requires a valid viewBox for proportional scaling');
    }
    if (!markup || !alt) return undefined;
    return { id, type, markup, alt, viewBox, fit: 'contain' } satisfies SvgDiagramBlock;
  }
  if (type === ContentBlockType.Image) {
    const assetRef = readString(record.assetRef, `${path}.assetRef`, issues);
    const alt = readString(record.alt, `${path}.alt`, issues);
    const caption = readOptionalString(record.caption, `${path}.caption`, issues);
    if (assetRef && !isRenderableImageRef(assetRef)) {
      issue(issues, 'content.image_ref_invalid', `${path}.assetRef`, 'Image reference must use HTTPS, an app path, or a supported inline image data URI');
    }
    return assetRef && alt ? { id, type, assetRef, alt, caption } satisfies ImageBlock : undefined;
  }
  if (type === ContentBlockType.Formula) {
    const source = readString(record.source, `${path}.source`, issues);
    const display = record.display === 'inline' || record.display === 'block' ? record.display : undefined;
    if (!display) issue(issues, 'content.formula_display_invalid', `${path}.display`, 'Formula display must be inline or block');
    return source && display ? { id, type, source, display } satisfies FormulaBlock : undefined;
  }
  const kind = readString(record.kind, `${path}.kind`, issues);
  if (!kind || !calloutKinds.has(kind)) issue(issues, 'content.callout_kind_invalid', `${path}.kind`, 'Unknown callout kind');
  if (!Array.isArray(record.blocks)) issue(issues, 'content.blocks_invalid', `${path}.blocks`, 'Callout blocks must be an array');
  const blocks = Array.isArray(record.blocks)
    ? record.blocks.map((block, index) => parseBlock(block, `${path}.blocks[${index}]`, issues, depth + 1))
    : [];
  validateSiblingBlockIds(blocks, `${path}.blocks`, issues);
  const title = readOptionalString(record.title, `${path}.title`, issues);
  return kind && calloutKinds.has(kind) && blocks.every(Boolean)
    ? { id, type: ContentBlockType.Callout, kind: kind as CalloutBlock['kind'], title, blocks: blocks as ContentBlock[] }
    : undefined;
}

function validateSiblingBlockIds(
  blocks: readonly (ContentBlock | undefined)[],
  path: string,
  issues: ContentValidationIssue[]
): void {
  const seen = new Set<string>();
  blocks.forEach((block, index) => {
    if (!block) return;
    if (seen.has(block.id)) {
      issue(
        issues,
        'content.block_id_duplicate',
        `${path}[${index}].id`,
        'Sibling content block ids must be unique'
      );
    }
    seen.add(block.id);
  });
}

function parseDataTable(
  id: string,
  record: Record<string, unknown>,
  path: string,
  issues: ContentValidationIssue[]
): DataTableBlock | undefined {
  if (!Array.isArray(record.columns) || record.columns.length === 0) {
    issue(issues, 'content.table_columns_invalid', `${path}.columns`, 'Table must have columns');
    return undefined;
  }
  const columns = record.columns.map((column, index) => parseColumn(column, `${path}.columns[${index}]`, issues));
  if (!Array.isArray(record.rows) || record.rows.length === 0) {
    issue(issues, 'content.table_rows_invalid', `${path}.rows`, 'Table must contain at least one row');
    return undefined;
  }
  const keys = new Set(columns.filter(Boolean).map((column) => column!.key));
  if (keys.size !== columns.length) issue(issues, 'content.table_column_duplicate', `${path}.columns`, 'Table column keys must be unique');
  const rows = record.rows.map((row, index) => parseRow(row, keys, `${path}.rows[${index}]`, issues));
  if (columns.some((column) => !column) || rows.some((row) => !row)) return undefined;
  return {
    id,
    type: ContentBlockType.DataTable,
    caption: readOptionalString(record.caption, `${path}.caption`, issues),
    unit: readOptionalString(record.unit, `${path}.unit`, issues),
    columns: columns as DataTableColumn[],
    rows: rows as Array<Readonly<Record<string, DataTableCell>>>,
    sourceNote: readOptionalString(record.sourceNote, `${path}.sourceNote`, issues)
  };
}

function parseColumn(input: unknown, path: string, issues: ContentValidationIssue[]): DataTableColumn | undefined {
  const record = asRecord(input, path, issues);
  if (!record) return undefined;
  const key = readString(record.key, `${path}.key`, issues);
  const label = readString(record.label, `${path}.label`, issues);
  const alignment = readString(record.alignment, `${path}.alignment`, issues);
  const valueType = record.valueType === 'text' || record.valueType === 'number' || record.valueType === 'percent'
    ? record.valueType
    : undefined;
  if (!alignment || !alignments.has(alignment)) issue(issues, 'content.table_alignment_invalid', `${path}.alignment`, 'Unknown alignment');
  if (!valueType) issue(issues, 'content.table_value_type_invalid', `${path}.valueType`, 'Unknown table value type');
  return key && label && alignment && alignments.has(alignment) && valueType
    ? { key, label, alignment: alignment as DataTableColumn['alignment'], valueType }
    : undefined;
}

function parseRow(
  input: unknown,
  keys: ReadonlySet<string>,
  path: string,
  issues: ContentValidationIssue[]
): Readonly<Record<string, DataTableCell>> | undefined {
  const record = asRecord(input, path, issues);
  if (!record) return undefined;
  const row: Record<string, DataTableCell> = {};
  for (const key of keys) {
    const value = record[key];
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
      issue(issues, 'content.table_cell_invalid', `${path}.${key}`, 'Table cell must be text, number or null');
      continue;
    }
    row[key] = value;
  }
  return row;
}

function parseOptions(input: unknown, issues: ContentValidationIssue[]): readonly SingleChoiceOption[] | undefined {
  if (!Array.isArray(input) || input.length < 2 || input.length > 8) {
    issue(issues, 'question.options_invalid', '$.options', 'Single choice question requires between two and eight options');
    return undefined;
  }
  const options = input.map((option, index) => {
    const path = `$.options[${index}]`;
    const record = asRecord(option, path, issues);
    if (!record) return undefined;
    const id = readString(record.id, `${path}.id`, issues);
    const content = parseDocument(record.content, `${path}.content`, issues, 0);
    return id && content ? { id, content } : undefined;
  });
  const ids = options.filter(Boolean).map((option) => option!.id);
  if (new Set(ids).size !== ids.length) issue(issues, 'question.option_id_duplicate', '$.options', 'Option ids must be unique');
  return options.every(Boolean) ? options as SingleChoiceOption[] : undefined;
}

function emptyDocument(id: string): ContentDocument {
  return { schemaVersion: 'content.v1', blocks: [{ id, type: 'text', source: '' }] };
}

function asRecord(input: unknown, path: string, issues: ContentValidationIssue[]): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    issue(issues, 'content.object_expected', path, 'Expected an object');
    return undefined;
  }
  return input as Record<string, unknown>;
}

function readString(
  input: unknown,
  path: string,
  issues: ContentValidationIssue[],
  allowEmpty = false
): string | undefined {
  if (typeof input !== 'string' || (!allowEmpty && input.trim().length === 0)) {
    issue(issues, 'content.string_expected', path, 'Expected a string');
    return undefined;
  }
  return input;
}

function readOptionalString(input: unknown, path: string, issues: ContentValidationIssue[]): string | undefined {
  if (input === undefined || input === null) return undefined;
  return readString(input, path, issues);
}

function issue(issues: ContentValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function hasSvgRoot(markup: string): boolean {
  return /^\s*<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i.test(markup);
}

function hasSvgViewBox(markup: string): boolean {
  const candidate = markup.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!candidate) return false;
  const values = candidate.trim().split(/[\s,]+/).map(Number);
  return values.length === 4
    && values.every(Number.isFinite)
    && values[2]! > 0
    && values[3]! > 0;
}

function isRenderableImageRef(value: string): boolean {
  return resolveImageSource(value).kind !== ImageSourceKind.Blocked;
}
