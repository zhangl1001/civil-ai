export interface AuthoringVisual {
  readonly svg: string;
  readonly alt: string;
  readonly viewBox?: string;
}

export function decodeEmbeddedJson(input: unknown): unknown {
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

export function asOptionalRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

export function optionalAuthorTextValue(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

export function authoringVisual(input: unknown): AuthoringVisual | undefined {
  const value = asOptionalRecord(decodeEmbeddedJson(input));
  if (
    typeof value?.svg !== 'string'
    || !/^\s*<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i.test(value.svg)
    || typeof value.alt !== 'string'
    || !value.alt.trim()
  ) {
    return undefined;
  }
  return {
    svg: value.svg.trim(),
    alt: value.alt.trim(),
    viewBox: typeof value.viewBox === 'string' && value.viewBox.trim() ? value.viewBox.trim() : undefined
  };
}

export function normalizeAuthoringSvg(markup: string, viewBox?: string): string {
  if (/\bviewBox\s*=\s*["'][^"']+["']/i.test(markup)) return markup;
  const resolvedViewBox = viewBox?.trim() || inferredSvgViewBox(markup) || '0 0 100 100';
  return markup.replace(/<svg(\s|>)/i, `<svg viewBox="${resolvedViewBox}"$1`);
}

function inferredSvgViewBox(markup: string): string | undefined {
  const width = markup.match(/\bwidth\s*=\s*["']([\d.]+)["']/i)?.[1];
  const height = markup.match(/\bheight\s*=\s*["']([\d.]+)["']/i)?.[1];
  return width && height ? `0 0 ${width} ${height}` : undefined;
}
