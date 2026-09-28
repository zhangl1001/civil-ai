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

  constructor(overrides: ModelRequestCapabilityOverrides = {}) {
    this.temperatureSupported = overrides.temperature !== false;
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
