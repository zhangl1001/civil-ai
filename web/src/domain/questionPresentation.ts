import {
  QUESTION_CONTENT_KINDS,
  QUESTION_RENDER_TEMPLATES,
  type QuestionContentKind,
  type QuestionRenderTemplate
} from '@/domain/question';

export interface QuestionPresentationSource {
  module?: string;
  knowledgePoint?: string;
  stem?: unknown;
  options?: string[];
  contentKind?: QuestionContentKind;
  renderTemplate?: QuestionRenderTemplate;
  material?: unknown;
  groupId?: string;
  subQuestionCount?: number;
}

export function normalizeQuestionTextBlock(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeQuestionTextBlock(item))
      .filter(Boolean)
      .join('\n\n');
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const svg = normalizeQuestionTextBlock(record.svg);
    if (svg) return svg;

    const headers = Array.isArray(record.headers)
      ? record.headers
      : Array.isArray(record.columns)
        ? record.columns
        : [];
    const rows = Array.isArray(record.rows)
      ? record.rows
      : Array.isArray(record.data)
        ? record.data
        : [];
    if (headers.length && rows.length) {
      const title = normalizeQuestionTextBlock(record.title);
      const headerCells = headers.map((item) => markdownTableCell(item));
      const bodyRows = rows.map((row) => {
        const cells = Array.isArray(row)
          ? row
          : row && typeof row === 'object'
            ? headers.map((header) => (row as Record<string, unknown>)[String(header)])
            : [row];
        return `| ${cells.map((item) => markdownTableCell(item)).join(' | ')} |`;
      });
      return [
        title ? `**${title}**` : '',
        `| ${headerCells.join(' | ')} |`,
        `| ${headerCells.map(() => '---').join(' | ')} |`,
        ...bodyRows
      ].filter(Boolean).join('\n');
    }

    const preferredKeys = ['markdown', 'content', 'text', 'description', 'paragraphs', 'chart', 'table'];
    const blocks = preferredKeys
      .map((key) => normalizeQuestionTextBlock(record[key]))
      .filter(Boolean);
    if (blocks.length) return blocks.join('\n\n');
  }
  return '';
}

function markdownTableCell(value: unknown): string {
  return normalizeQuestionTextBlock(value).replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
}

export function hasSharedMaterialStructure(question: QuestionPresentationSource): boolean {
  return Boolean(
    normalizeQuestionTextBlock(question.material)
    && question.groupId?.trim()
    && question.subQuestionCount
    && question.subQuestionCount > 1
  );
}

export function resolveQuestionContentKind(question: QuestionPresentationSource): QuestionContentKind {
  return hasSharedMaterialStructure(question)
    ? QUESTION_CONTENT_KINDS.SHARED_MATERIAL
    : QUESTION_CONTENT_KINDS.SINGLE;
}

export function resolveQuestionRenderTemplate(question: QuestionPresentationSource): QuestionRenderTemplate {
  if (hasSharedMaterialStructure(question) && question.module?.includes('资料分析')) {
    return QUESTION_RENDER_TEMPLATES.DATA_ANALYSIS;
  }
  if (hasSharedMaterialStructure(question)) return QUESTION_RENDER_TEMPLATES.SHARED_MATERIAL;
  if (question.renderTemplate === QUESTION_RENDER_TEMPLATES.GRAPHIC) return QUESTION_RENDER_TEMPLATES.GRAPHIC;

  const stem = normalizeQuestionTextBlock(question.stem);
  const optionText = Array.isArray(question.options) ? question.options.map((item) => normalizeQuestionTextBlock(item)).join('\n') : '';
  const text = `${question.module || ''} ${question.knowledgePoint || ''} ${stem}`;
  const hasGraphicAsset = /<svg[\s>]|<img[\s>]|!\[[^\]]*]\([^)]+\)/i.test(`${stem}\n${optionText}`);
  if (question.module?.includes('判断推理') && hasGraphicAsset && /图形|图推|空间|位置|样式|属性|数量/.test(text)) {
    return QUESTION_RENDER_TEMPLATES.GRAPHIC;
  }
  return QUESTION_RENDER_TEMPLATES.STANDARD;
}
