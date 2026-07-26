export class StructuredJsonParseError extends Error {
  readonly code = 'ai_runtime.structured_json_invalid';

  constructor(message = 'Model output does not contain valid JSON') {
    super(message);
    this.name = 'StructuredJsonParseError';
  }
}

/**
 * Parses structured model output without requiring providers to support a
 * native response-format option. Plain JSON is preferred, while fenced or
 * briefly prefixed JSON is accepted for provider compatibility.
 */
export function parseStructuredJson<T = unknown>(text: string): T {
  const source = text.replace(/^\uFEFF/, '').trim();
  if (!source) throw new StructuredJsonParseError('Model output is empty');

  const direct = tryParse<T>(source);
  if (direct.ok) return direct.value;

  for (const candidate of fencedCandidates(source)) {
    const parsed = tryParse<T>(candidate);
    if (parsed.ok) return parsed.value;
  }

  for (let index = 0; index < source.length; index += 1) {
    const open = source[index];
    if (open !== '{' && open !== '[') continue;
    const candidate = balancedJsonAt(source, index, open, open === '{' ? '}' : ']');
    if (!candidate) continue;
    const parsed = tryParse<T>(candidate);
    if (parsed.ok) return parsed.value;
  }

  throw new StructuredJsonParseError();
}

function fencedCandidates(source: string): readonly string[] {
  const candidates: string[] = [];
  const pattern = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function balancedJsonAt(
  source: string,
  start: number,
  open: '{' | '[',
  close: '}' | ']'
): string | undefined {
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (inString && char === '\\') {
      escaping = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
    if (depth < 0) return undefined;
  }
  return undefined;
}

function tryParse<T>(source: string):
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(source) as T };
  } catch {
    return { ok: false };
  }
}
