import {
  ProviderErrorKind,
  ProviderGatewayError
} from '../contracts/ProviderGateway';

export interface ModelRequestCapabilityOverrides {
  readonly temperature?: boolean;
}

/**
 * Keeps model-specific request differences inside Provider adapters and learns
 * conservative fallbacks when a compatible endpoint rejects optional fields.
 */
export class ModelCapabilityMatrix {
  private temperatureSupported: boolean;

  constructor(overrides: ModelRequestCapabilityOverrides = {}) {
    this.temperatureSupported = overrides.temperature !== false;
  }

  samplingParameters(temperature: number): Readonly<Record<string, unknown>> {
    return this.temperatureSupported ? { temperature } : {};
  }

  learnFromInvalidRequest(error: unknown): boolean {
    if (!this.temperatureSupported || !isUnsupportedTemperature(error)) return false;
    this.temperatureSupported = false;
    return true;
  }
}

function isUnsupportedTemperature(error: unknown): boolean {
  return error instanceof ProviderGatewayError
    && error.kind === ProviderErrorKind.InvalidRequest
    && /temperature|sampling parameter|sampling parameters|thinking mode/i.test(error.message);
}
