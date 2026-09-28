import {
  ProviderErrorKind,
  ProviderGatewayError
} from '../contracts/ProviderGateway';

export interface ModelRequestCapabilityOverrides {
  readonly temperature?: boolean;
  readonly thinking?: boolean;
}

/**
 * Keeps model-specific request differences inside Provider adapters and learns
 * conservative fallbacks when a compatible endpoint rejects optional fields.
 */
export class ModelCapabilityMatrix {
  private temperatureSupported: boolean;
  private thinkingSupported: boolean;

  constructor(overrides: ModelRequestCapabilityOverrides = {}, model = '') {
    // Known up front, so no request is spent on a 400 to learn it.
    this.temperatureSupported = overrides.temperature ?? !rejectsSamplingParameters(model);
    this.thinkingSupported = overrides.thinking !== false;
  }

  samplingParameters(temperature: number): Readonly<Record<string, unknown>> {
    return this.temperatureSupported ? { temperature } : {};
  }

  thinkingParameters(
    thinking?: Readonly<Record<string, unknown>>
  ): Readonly<Record<string, unknown>> {
    return thinking && this.thinkingSupported ? { thinking } : {};
  }

  /**
   * Learns only from a rejection of a field the request actually carried;
   * otherwise the retry would repeat the same request.
   */
  learnFromInvalidRequest(error: unknown, sent: { readonly thinking?: boolean } = {}): boolean {
    if (this.temperatureSupported && isUnsupportedTemperature(error)) {
      this.temperatureSupported = false;
      return true;
    }
    if (this.thinkingSupported && sent.thinking && isUnsupportedThinking(error)) {
      this.thinkingSupported = false;
      return true;
    }
    return false;
  }
}

/**
 * Claude Opus 4.7/4.8 and every 5.x Claude (Opus, Sonnet, Haiku, Fable,
 * Opus 5.5) removed temperature/top_p/top_k; sending one is a 400. Matching
 * on the model name also covers gateway spellings such as
 * `us.anthropic.claude-sonnet-5-v1:0` and OpenAI-compatible proxies.
 */
export function rejectsSamplingParameters(model: string): boolean {
  return /claude-(?:(?:opus|sonnet|haiku|fable)-5|opus-4-[78])(?![0-9])/i.test(model);
}

/** Claude Opus 5.5 and Fable 5.x always think; `thinking: {type: 'disabled'}` is a 400. */
export function rejectsDisabledThinking(model: string): boolean {
  return /claude-(?:opus-5-5|fable-5)(?![0-9])/i.test(model);
}

function isUnsupportedTemperature(error: unknown): boolean {
  return error instanceof ProviderGatewayError
    && error.kind === ProviderErrorKind.InvalidRequest
    && /temperature|sampling parameter|sampling parameters/i.test(error.message);
}

function isUnsupportedThinking(error: unknown): boolean {
  return error instanceof ProviderGatewayError
    && error.kind === ProviderErrorKind.InvalidRequest
    && /thinking|reasoning(?:_effort)?|extended thinking/i.test(error.message)
    // "content[].thinking must be passed back" and "must start with a thinking
    // block" prove thinking is supported and active; dropping the disable flag
    // would make every later tool turn fail the same way.
    && !/passed back|must be (?:passed|returned|included)|content\[\]\.thinking|thinking block/i.test(error.message);
}
