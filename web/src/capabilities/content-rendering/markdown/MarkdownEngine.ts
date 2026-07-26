import { Marked, Renderer, type Tokens } from 'marked';
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

export const MARKDOWN_RENDERER_VERSION = 'markdown-v2';

export class MarkdownEngine {
  private readonly marked: Marked;

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
    this.marked = new Marked({
      async: false,
      breaks: true,
      gfm: true,
      renderer
    });
  }

  render(source: string): RenderedMarkdown {
    const warnings: MarkdownRenderWarning[] = [];
    let rendered: string;
    try {
      rendered = this.marked.parse(normalizeMarkdownSource(source), { async: false });
    } catch (error) {
      warnings.push({
        code: 'markdown.parse_failed',
        message: error instanceof Error ? error.message : 'Markdown parsing failed'
      });
      rendered = `<p>${escapeHtml(source).replace(/\n/g, '<br>')}</p>`;
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
 * Normalizes the two presentation problems most often produced by model output:
 * incomplete pipe tables and decorative emoji that compete with the reading
 * hierarchy. Fenced code blocks remain untouched.
 */
export function normalizeMarkdownSource(source: string): string {
  const document = unwrapMarkdownDocumentFence(source.replace(/\r\n?/g, '\n'));
  const lines = document.split('\n');
  const normalized: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const line = inFence ? rawLine : normalizeFullWidthPipeRow(rawLine);
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
  return normalized.join('\n');
}

function unwrapMarkdownDocumentFence(source: string): string {
  const match = source.match(/^\s*(```|~~~)\s*(?:markdown|md|gfm)\s*\n([\s\S]*?)\n\s*\1\s*$/i);
  return match?.[2] ?? source;
}

function normalizeFullWidthPipeRow(line: string): string {
  const normalized = line.replaceAll('｜', '|');
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
  return value
    .replace(/\p{Extended_Pictographic}/gu, '')
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
