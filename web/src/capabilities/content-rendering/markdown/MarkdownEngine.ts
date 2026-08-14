import { Marked, Renderer, type Tokens } from 'marked';
import markedKatex from 'marked-katex-extension';
import { HtmlPolicy } from '../security/HtmlPolicy';
import {
  ImageSourceKind,
  LinkKind,
  resolveImageSource,
  resolveLink
} from '../security/UrlPolicy';

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

export const MARKDOWN_RENDERER_VERSION = 'markdown-v4-katex-safe-resources';

export class MarkdownEngine {
  private readonly marked: Marked;
  private readonly fallbackMarked: Marked;

  constructor(private readonly htmlPolicy = new HtmlPolicy()) {
    this.marked = createMarkedRenderer();
    this.marked.use(mathExtension());
    this.fallbackMarked = createMarkedRenderer();
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
      html: restoreSafeImageSources(this.htmlPolicy.sanitize(rendered)),
      warnings,
      contentHash: hashMarkdown(source),
      rendererVersion: MARKDOWN_RENDERER_VERSION
    };
  }
}

function createMarkedRenderer(): Marked {
  const renderer = new Renderer();
  const renderTable = renderer.table;
  renderer.table = function table(token: Tokens.Table): string {
    // Marked injects its parser onto the renderer used for the active parse.
    // Calling a function bound while the renderer is being constructed loses
    // that runtime parser and makes every Markdown table throw. Keep `this`
    // from the active render and only decorate the resulting table markup.
    return `<div class="markdown-table-scroll">${renderTable.call(this, token)}</div>`;
  };
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
  renderer.image = (token: Tokens.Image): string => {
    const resolved = resolveImageSource(token.href);
    const alt = escapeAttribute(token.text);
    const title = token.title ? ` title="${escapeAttribute(token.title)}"` : '';
    if (resolved.kind === ImageSourceKind.Local || resolved.kind === ImageSourceKind.Inline) {
      return `<img data-app-image-src="${escapeAttribute(resolved.src)}" alt="${alt}" loading="lazy" decoding="async"${title}>`;
    }
    if (resolved.kind === ImageSourceKind.Remote) {
      const label = escapeHtml(token.text || '查看外部图片');
      return `<a href="${escapeAttribute(resolved.src)}" target="_blank" rel="noopener noreferrer"${title}>${label}</a>`;
    }
    return token.text ? `<span>${escapeHtml(token.text)}</span>` : '';
  };
  renderer.html = (token: Tokens.HTML): string => escapeHtml(token.text);
  return new Marked({
    async: false,
    breaks: true,
    gfm: true,
    renderer
  });
}

function restoreSafeImageSources(html: string): string {
  return html.replace(/\sdata-app-image-src="([^"]+)"/g, ' src="$1"');
}

/**
 * Normalizes the presentation problems most often produced by model output:
 * transport escapes, document-level Markdown fences, incomplete pipe tables
 * and decorative emoji that compete with the reading hierarchy. Ordinary
 * fenced code blocks remain untouched.
 */
export function normalizeMarkdownSource(source: string): string {
  const document = promoteEnumeratedSectionHeadings(normalizeMathSyntax(
    stripInvisibleCharacters(
      unwrapMarkdownDocumentFence(
        decodeMarkdownTransportEscapes(unwrapSerializedMarkdown(source).replace(/\r\n?/g, '\n'))
      )
    )
  ));
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

const ZERO_WIDTH_CHARACTERS = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
const NON_ASCII_SPACE_CLASS = '\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000';
const NON_ASCII_SPACES = new RegExp(`[${NON_ASCII_SPACE_CLASS}]`, 'g');
const HAS_NON_ASCII_SPACE = new RegExp(`[${NON_ASCII_SPACE_CLASS}]`);
const LEADING_WHITESPACE = new RegExp(`^[ \\t${NON_ASCII_SPACE_CLASS}]*`);

/**
 * Removes invisible characters that silently switch Markdown off.
 *
 * CommonMark accepts only ASCII space and tab as leading whitespace, so a
 * single non-breaking or ideographic space in front of a line stops `##`, `>`,
 * `-` and every other block construct from being recognised — the document
 * collapses into one paragraph and renders exactly as if it had never been
 * parsed. Chinese model output carries these constantly and the damage is
 * invisible on inspection, which makes it worth normalizing before parsing
 * rather than chasing per-document.
 *
 * A leading run that contained one of them is dropped rather than converted:
 * full-width indentation is decorative here, and turning it into four ASCII
 * spaces would swap one silent failure for another by forming a code block.
 * Fenced code keeps its bytes, where invisible characters may be the subject.
 */
function stripInvisibleCharacters(source: string): string {
  let inFence = false;
  return source.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const cleaned = line.replace(ZERO_WIDTH_CHARACTERS, '');
    const leading = LEADING_WHITESPACE.exec(cleaned)?.[0] ?? '';
    const body = cleaned.slice(leading.length).replace(NON_ASCII_SPACES, ' ');
    const indent = HAS_NON_ASCII_SPACE.test(leading) ? '' : leading;
    return `${indent}${body}`;
  }).join('\n');
}

/** `一、`, `（一）`, `【…】` — section markers Markdown renders as ordinary prose. */
const IDEOGRAPHIC_SECTION = /^\s*([一二三四五六七八九十百]+)\s*[、.．]\s*(\S.*)$/;
const PARENTHESIZED_SECTION = /^\s*[（(]\s*([一二三四五六七八九十百]+)\s*[）)]\s*(\S.*)$/;
const BRACKETED_SECTION = /^\s*【\s*([^】]{1,24})\s*】\s*$/;
const SECTION_TITLE_MAX = 30;
const MIN_PROMOTED_SECTIONS = 2;

/**
 * Rewrites Chinese section numbering into real Markdown headings.
 *
 * Models writing long-form Chinese habitually structure documents with `一、`
 * and `（一）` instead of `##`. Markdown has no meaning for either, so the whole
 * document renders as one flat run of paragraphs and reads as though it were
 * never rendered at all.
 *
 * The rewrite is deliberately narrow. It only runs on documents that carry no
 * Markdown heading of their own — an author who used `#` already expressed the
 * structure, and their numbered lines are content. It only touches markers
 * Markdown itself ignores, so `1.` and `1)` keep being ordered lists rather
 * than turning a shopping list into a table of contents. And it needs at least
 * two of them, so one numbered sentence in a paragraph is left alone.
 */
function promoteEnumeratedSectionHeadings(source: string): string {
  if (/^\s{0,3}#{1,6}\s/m.test(source)) return source;
  const lines = source.split('\n');
  const promoted: Array<{ readonly index: number; readonly text: string }> = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const heading = sectionHeading(line);
    if (heading) promoted.push({ index, text: heading });
  });
  if (promoted.length < MIN_PROMOTED_SECTIONS) return source;
  promoted.forEach(({ index, text }) => {
    lines[index] = text;
  });
  return lines.join('\n');
}

function sectionHeading(line: string): string | undefined {
  const bracketed = BRACKETED_SECTION.exec(line);
  if (bracketed) return `## ${bracketed[1]!.trim()}`;
  const ideographic = IDEOGRAPHIC_SECTION.exec(line);
  if (ideographic && isSectionTitle(ideographic[2]!)) return `## ${ideographic[2]!.trim()}`;
  const parenthesized = PARENTHESIZED_SECTION.exec(line);
  if (parenthesized && isSectionTitle(parenthesized[2]!)) return `### ${parenthesized[2]!.trim()}`;
  return undefined;
}

/** A heading is a short label; a numbered sentence ends like a sentence. */
function isSectionTitle(text: string): boolean {
  const title = text.trim();
  return title.length > 0
    && title.length <= SECTION_TITLE_MAX
    && !/[。！？；;]$/.test(title)
    && !/[。！？]/.test(title);
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
  const withoutJoiners = normalized.replace(/[\uFE0F\u200D\u20E3]/g, '');
  // Runs left behind by a removed emoji are collapsed, but the leading run is
  // structure rather than spacing: Markdown reads it as list nesting depth, so
  // squeezing it flattens nested lists and dissolves indented code blocks.
  const indent = /^[ \t]*/.exec(withoutJoiners)?.[0] ?? '';
  return `${indent}${withoutJoiners.slice(indent.length).replace(/[ \t]{2,}/g, ' ')}`.trimEnd();
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
