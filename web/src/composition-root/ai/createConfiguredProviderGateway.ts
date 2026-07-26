import { AnthropicGateway, OpenAICompatibleGateway, type ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { AIConfig } from '@/domain/ai';
import { aiConfigService } from '@/services/AIConfigService';
import { PlatformHttpTransport } from './PlatformHttpTransport';

export class ProviderConfigurationError extends Error {
  readonly code = 'provider.not_configured';
}

/** Composition-only bridge from user secure settings to the provider contract. */
export async function createConfiguredProviderGateway(configOverride?: AIConfig): Promise<ProviderGateway> {
  const config = configOverride ?? await aiConfigService.load();
  if (!config.apiKey.trim() || !config.model.trim()) {
    throw new ProviderConfigurationError('请先在“我的”中完成 AI 模型配置。');
  }
  const baseUrl = config.baseUrl?.trim() || '';
  const model = config.model.trim();
  const provider = config.provider;
  if (provider === 'anthropic') {
    return new AnthropicGateway({
      apiKey: config.apiKey.trim(),
      model,
      baseUrl: baseUrl || 'https://api.anthropic.com/v1'
    }, new PlatformHttpTransport());
  }
  return new OpenAICompatibleGateway({
    apiKey: config.apiKey.trim(),
    model,
    baseUrl: baseUrl || 'https://api.openai.com/v1'
  }, new PlatformHttpTransport());
}
