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

export const MARKDOWN_RENDERER_VERSION = 'markdown-v1';

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
      rendered = this.marked.parse(source, { async: false });
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
