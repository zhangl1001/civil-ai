import { AnthropicGateway, OpenAICompatibleGateway, type ProviderGateway } from '@/capabilities/ai-runtime/public';
import { aiConfigService } from '@/services/AIConfigService';

/** Composition-only bridge from user secure settings to the provider contract. */
export async function createConfiguredProviderGateway(): Promise<ProviderGateway> {
  const config = await aiConfigService.load();
  if (!config.apiKey.trim() || !config.model.trim()) throw new Error('请先在“我的”中完成 AI 模型配置。');
  const baseUrl = config.baseUrl?.trim() || '';
  const model = config.model.trim();
  const provider = config.provider;
  const isAnthropic = provider === 'anthropic'
    || /anthropic\.com/i.test(baseUrl)
    || /^claude(?:-|$)/i.test(model);
  if (isAnthropic) {
    return new AnthropicGateway({
      apiKey: config.apiKey.trim(),
      model,
      baseUrl: baseUrl || 'https://api.anthropic.com/v1'
    });
  }
  return new OpenAICompatibleGateway({
    apiKey: config.apiKey.trim(),
    model,
    baseUrl: baseUrl || 'https://api.openai.com/v1',
    supportsJsonSchema: provider === 'openai'
  });
}
