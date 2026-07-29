import { Marked, Renderer, type Tokens } from 'marked';
import markedKatex from 'marked-katex-extension';
import { HtmlPolicy } from '../security/HtmlPolicy';
import { LinkKind, resolveLink } from '../security/UrlPolicy';

export interface RenderedMarkdown {
  readonly html: string;
  readonly warnings: readonly MarkdownRenderWarning[];
  readonly contentHash: string;
  readonly rendererVersion: string;
}

export interface MarkdownRenderWarning {
  readonly code: 'markdown.parse_failed';
  readonly message: string;
}

export const MARKDOWN_RENDERER_VERSION = 'markdown-v3-katex';

export class MarkdownEngine {
  private readonly marked: Marked;
  private readonly fallbackMarked: Marked;

  constructor(private readonly htmlPolicy = new HtmlPolicy()) {
    const renderer = new Renderer();
    const renderTable = renderer.table.bind(renderer);
    renderer.table = (token: Tokens.Table): string => (
      `<div class="markdown-table-scroll">${renderTable(token)}</div>`
    );
    renderer.link = function link(token: Tokens.Link): string {
      const label = this.parser.parseInline(token.tokens);
      const resolved = resolveLink(token.href);
      if (resolved.kind === LinkKind.Blocked) return label;
      const title = token.title ? ` title="${escapeAttribute(token.title)}"` : '';
      const external = resolved.kind === LinkKind.External
        ? ' target="_blank" rel="noopener noreferrer"'
        : '';
      return `<a href="${escapeAttribute(resolved.href)}"${title}${external}>${label}</a>`;
    };
    renderer.html = (token: Tokens.HTML): string => escapeHtml(token.text);
    this.marked = new Marked({
      async: false,
      breaks: true,
      gfm: true,
      renderer
    });
    this.marked.use(mathExtension());
    this.fallbackMarked = new Marked({ async: false, breaks: true, gfm: true });
    this.fallbackMarked.use(mathExtension());
  }

  render(source: string): RenderedMarkdown {
    const warnings: MarkdownRenderWarning[] = [];
    const normalized = normalizeMarkdownSource(source);
    let rendered: string;
    try {
      rendered = this.marked.parse(normalized, { async: false });
    } catch (error) {
      warnings.push({
        code: 'markdown.parse_failed',
        message: error instanceof Error ? error.message : 'Markdown parsing failed'
      });
      try {
        rendered = this.fallbackMarked.parse(normalized, { async: false });
      } catch {
        rendered = `<p>${escapeHtml(normalized).replace(/\n/g, '<br>')}</p>`;
      }
    }
    return {
      html: this.htmlPolicy.sanitize(rendered),
      warnings,
      contentHash: hashMarkdown(source),
      rendererVersion: MARKDOWN_RENDERER_VERSION
    };
  }
}

/**
 * Normalizes the presentation problems most often produced by model output:
 * transport escapes, document-level Markdown fences, incomplete pipe tables
 * and decorative emoji that compete with the reading hierarchy. Ordinary
 * fenced code blocks remain untouched.
 */
export function normalizeMarkdownSource(source: string): string {
  const document = normalizeMathSyntax(
    unwrapMarkdownDocumentFence(
      decodeMarkdownTransportEscapes(unwrapSerializedMarkdown(source).replace(/\r\n?/g, '\n'))
    )
  );
  const lines = document.split('\n');
  const normalized: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const line = inFence
      ? rawLine
      : normalizeEscapedMarkdownSyntax(normalizeFullWidthPipeRow(rawLine));
    if (/^\s*(```|~~~)/.test(line)) {
      normalized.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      normalized.push(line);
      continue;
    }

    normalized.push(stripDecorativeEmoji(line));
    const next = lines[index + 1] ?? '';
    const previous = lines[index - 1] ?? '';
    if (
      isPipeRow(line)
      && !isPipeDelimiter(line)
      && !isPipeRow(previous)
      && !isPipeDelimiter(next)
    ) {
      normalized.push(pipeDelimiter(pipeColumnCount(line)));
    }
  }
  return normalizeTolerantPipeTables(normalized).join('\n');
}

function mathExtension() {
  return markedKatex({
    nonStandard: true,
    throwOnError: false,
    strict: 'ignore',
    trust: false
  });
}

function normalizeMathSyntax(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];
  const prose: string[] = [];
  let inFence = false;
  const flushProse = () => {
    if (!prose.length) return;
    output.push(...normalizeMathSegment(prose.join('\n')).split('\n'));
    prose.length = 0;
  };
  lines.forEach((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      flushProse();
      output.push(line);
      inFence = !inFence;
      return;
    }
    if (inFence) output.push(line);
    else prose.push(line);
  });
  flushProse();
  return output.join('\n');
}

function normalizeMathSegment(source: string): string {
  const normalizedDelimiters = source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula: string) => `$$\n${formula.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, formula: string) => `$${formula.trim()}$`);
  return normalizedDelimiters.replace(
    /(\${1,2})([\s\S]*?)\1/g,
    (_, delimiter: string, formula: string) => (
      `${delimiter}${formula.replace(/(^|[^\\])%/g, '$1\\%')}${delimiter}`
    )
  );
}

function normalizeTolerantPipeTables(lines: string[]): string[] {
  const output = [...lines];
  for (let index = 0; index < output.length; index += 1) {
    if (!isPipeDelimiter(output[index] ?? '')) continue;
    let start = index - 1;
    while (start > 0 && isPipeRow(output[start - 1] ?? '')) start -= 1;
    let end = index + 1;
    while (end < output.length && isPipeRow(output[end] ?? '')) end += 1;
    const rows = output.slice(start, end).filter((line) => !isPipeDelimiter(line));
    if (!rows.length) continue;
    const columnCount = Math.max(...rows.map(pipeColumnCount), pipeColumnCount(output[index] ?? ''));
    const table = [pipeRow(rows[0] ?? '', columnCount), pipeDelimiter(columnCount)];
    table.push(...rows.slice(1).map((row) => pipeRow(row, columnCount)));
    output.splice(start, end - start, ...table);
    index = start + table.length - 1;
  }
  return output;
}

function pipeRow(line: string, columnCount: number): string {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = value.split('|').map((cell) => cell.trim());
  while (cells.length < columnCount) cells.push('');
  return `| ${cells.slice(0, columnCount).join(' | ')} |`;
}

function unwrapSerializedMarkdown(source: string): string {
  const value = source.trim();
  if (!value || (!value.startsWith('"') && !value.startsWith('{'))) return source;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string') return parsed;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return source;
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > 3 || keys.some((key) => !['content', 'markdown', 'text'].includes(key))) return source;
    const markdown = ['content', 'markdown', 'text']
      .map((key) => record[key])
      .find((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return markdown ?? source;
  } catch {
    return source;
  }
}

function unwrapMarkdownDocumentFence(source: string): string {
  const match = source.match(/^\s*(```|~~~)([^\n]*)\n([\s\S]*?)\n\s*\1\s*$/i);
  if (!match) return source;
  const language = match[2].trim().toLowerCase();
  const content = match[3];
  const isMarkdownLanguage = language === 'markdown' || language === 'md' || language === 'gfm';
  const looksLikeMarkdown = /(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[|｜][^|\n]+[|｜]/m.test(content);
  return isMarkdownLanguage || looksLikeMarkdown ? content : source;
}

function decodeMarkdownTransportEscapes(source: string): string {
  if (!source.includes('\\n')) return source;
  const decoded = source.replace(/(?:\\r)?\\n/g, '\n');
  const looksLikeMarkdown = /(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[|｜][^|\n]+[|｜]/m.test(decoded);
  const escapedBreakIntroducesMarkdown = /(?:\\r)?\\n\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|[|｜])/.test(source);
  return looksLikeMarkdown && (!source.includes('\n') || escapedBreakIntroducesMarkdown) ? decoded : source;
}

function normalizeEscapedMarkdownSyntax(line: string): string {
  return line
    .replace(/^(\s{0,3})\\(#{1,6})(?=\s)/, '$1$2')
    .replace(/^(\s{0,3})(＃{1,6})(?=\s)/, (_, indentation: string, hashes: string) => (
      `${indentation}${'#'.repeat(hashes.length)}`
    ))
    .replace(/^(\s{0,3})\\([-*+])(?=\s)/, '$1$2')
    .replace(/\\\*\\\*([^\n]+?)\\\*\\\*/g, '**$1**');
}

function normalizeFullWidthPipeRow(line: string): string {
  const normalized = line.replace(/｜/g, '|');
  const value = normalized.trim();
  if (
    normalized === line
    || !value.startsWith('|')
    || !value.endsWith('|')
    || pipeColumnCount(value) < 2
  ) {
    return line;
  }
  return normalized;
}

function isPipeRow(line: string): boolean {
  const value = line.trim();
  return value.startsWith('|') && value.endsWith('|') && pipeColumnCount(value) >= 2;
}

function isPipeDelimiter(line: string): boolean {
  if (!isPipeRow(line)) return false;
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function pipeColumnCount(line: string): number {
  const value = line.trim();
  if (!value.startsWith('|') || !value.endsWith('|')) return 0;
  return value.slice(1, -1).split('|').length;
}

function pipeDelimiter(columnCount: number): string {
  return `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`;
}

function stripDecorativeEmoji(value: string): string {
  let normalized = value;
  try {
    normalized = normalized.replace(new RegExp('\\p{Extended_Pictographic}', 'gu'), '');
  } catch {
    // Older iOS JavaScript runtimes may not recognize this Unicode property.
  }
  return normalized
    .replace(/[\uFE0F\u200D\u20E3]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trimEnd();
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hashMarkdown(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
