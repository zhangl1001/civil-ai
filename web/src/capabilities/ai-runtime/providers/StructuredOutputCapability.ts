export type StructuredOutputMode = 'tool' | 'prompt';

/** Remembers a gateway instance's observed structured-output capability. */
export class StructuredOutputCapability {
  private static readonly observedModes = new Map<string, StructuredOutputMode>();
  private static readonly activeProbes = new Map<string, Promise<void>>();
  private preferredMode: StructuredOutputMode;

  constructor(private readonly cacheKey?: string) {
    this.preferredMode = cacheKey
      ? StructuredOutputCapability.observedModes.get(cacheKey) ?? 'tool'
      : 'tool';
  }

  current(): StructuredOutputMode {
    return this.cacheKey
      ? StructuredOutputCapability.observedModes.get(this.cacheKey) ?? this.preferredMode
      : this.preferredMode;
  }

  markToolModeUnsupported(): void {
    this.preferredMode = 'prompt';
    this.remember('prompt');
  }

  /**
   * Only one request probes an unknown endpoint/model pair. Concurrent shards wait
   * for that result, then all use the learned mode instead of each doing its own
   * tool-to-prompt fallback request.
   */
  async execute<T>(options: {
    readonly invoke: (mode: StructuredOutputMode) => Promise<T>;
    readonly acceptsToolResult: (result: T) => boolean;
    readonly isToolModeUnsupported: (error: unknown) => boolean;
  }): Promise<T> {
    const observed = this.observedMode();
    if (observed || !this.cacheKey) return this.executeWithMode(observed ?? this.current(), options);

    const activeProbe = StructuredOutputCapability.activeProbes.get(this.cacheKey);
    if (activeProbe) {
      await activeProbe;
      return options.invoke(this.current());
    }

    let settleProbe!: () => void;
    const probe = new Promise<void>((resolve) => { settleProbe = resolve; });
    StructuredOutputCapability.activeProbes.set(this.cacheKey, probe);
    try {
      return await this.executeWithMode('tool', options, settleProbe);
    } finally {
      settleProbe();
      if (StructuredOutputCapability.activeProbes.get(this.cacheKey) === probe) {
        StructuredOutputCapability.activeProbes.delete(this.cacheKey);
      }
    }
  }

  private async executeWithMode<T>(
    mode: StructuredOutputMode,
    options: {
      readonly invoke: (mode: StructuredOutputMode) => Promise<T>;
      readonly acceptsToolResult: (result: T) => boolean;
      readonly isToolModeUnsupported: (error: unknown) => boolean;
    },
    onModeResolved?: () => void
  ): Promise<T> {
    try {
      const result = await options.invoke(mode);
      if (mode !== 'tool' || options.acceptsToolResult(result)) {
        if (mode === 'tool') this.remember('tool');
        onModeResolved?.();
        return result;
      }
    } catch (error) {
      if (mode !== 'tool' || !options.isToolModeUnsupported(error)) throw error;
    }
    this.markToolModeUnsupported();
    onModeResolved?.();
    return options.invoke('prompt');
  }

  private observedMode(): StructuredOutputMode | undefined {
    return this.cacheKey
      ? StructuredOutputCapability.observedModes.get(this.cacheKey)
      : undefined;
  }

  private remember(mode: StructuredOutputMode): void {
    this.preferredMode = mode;
    if (this.cacheKey) StructuredOutputCapability.observedModes.set(this.cacheKey, mode);
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
