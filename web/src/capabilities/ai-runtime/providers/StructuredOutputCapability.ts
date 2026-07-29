export type StructuredOutputMode = 'tool' | 'prompt';

/** Remembers a gateway instance's observed structured-output capability. */
export class StructuredOutputCapability {
  private preferredMode: StructuredOutputMode = 'tool';

  current(): StructuredOutputMode {
    return this.preferredMode;
  }

  markToolModeUnsupported(): void {
    this.preferredMode = 'prompt';
  }
}

/**
 * Tool-compatible providers do not always enforce the declared input schema.
 * A missing required root field is sufficient evidence to retry in prompt mode;
 * deeper business validation remains the caller's responsibility.
 */
export function hasRequiredStructuredRoot(text: string, schema: object): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(schema)) return true;
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];
    if (!required.length) return true;
    if (!isRecord(parsed)) return false;
    return required.every((field) => Object.prototype.hasOwnProperty.call(parsed, field));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
