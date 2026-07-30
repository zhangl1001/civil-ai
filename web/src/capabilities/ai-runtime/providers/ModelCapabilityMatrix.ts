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

  learnFromInvalidRequest(error: unknown): boolean {
    if (this.temperatureSupported && isUnsupportedTemperature(error)) {
      this.temperatureSupported = false;
      return true;
    }
    if (this.thinkingSupported && isUnsupportedThinking(error)) {
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
    && /thinking|reasoning(?:_effort)?|extended thinking/i.test(error.message);
}
