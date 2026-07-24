import type { AIConfig } from '@/domain/ai';
import { aiConfigService } from '@/services/AIConfigService';
import { AnthropicProvider, OpenAICompatibleProvider, type AICompletionMessage, type AIProvider } from './AIProvider';

export class AIEngine {
  async testConnection(): Promise<string> {
    const config = await aiConfigService.load();
    if (!config.apiKey) {
      throw new Error('未配置 AI API Key，请先保存配置。');
    }
    const provider = this.provider(config);
    const content = await provider.complete({
      messages: [
        { role: 'system', content: '你是连接测试助手。只回复“连接正常”。' },
        { role: 'user', content: '请测试当前配置是否可用。' }
      ],
      temperature: 0
    });
    if (!content) throw new Error('AI 返回为空');
    return content;
  }

  async complete(messages: AICompletionMessage[], signal?: AbortSignal, options: { temperature?: number } = {}): Promise<string> {
    const config = await aiConfigService.load();
    if (!config.apiKey) {
      throw new Error('未配置 AI API Key，请先到“我的 > AI 配置”保存。');
    }
    const provider = this.provider(config);
    const content = await provider.complete({ messages, temperature: options.temperature }, signal);
    if (!content) throw new Error('AI 返回为空');
    return content;
  }

  async stream(
    messages: AICompletionMessage[],
    onDelta: (delta: string) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<string> {
    const config = await aiConfigService.load();
    if (!config.apiKey) {
      throw new Error('未配置 AI API Key，请先到“我的 > AI 配置”保存。');
    }
    const provider = this.provider(config);
    if (config.streamingEnabled !== false && provider.stream) {
      const content = await provider.stream({ messages }, onDelta, signal);
      if (!content) throw new Error('AI 返回为空');
      return content;
    }
    const content = await provider.complete({ messages }, signal);
    if (!content) throw new Error('AI 返回为空');
    await onDelta(content);
    return content;
  }

  private provider(config: AIConfig): AIProvider {
    if (config.provider === 'anthropic') return new AnthropicProvider(config);
    return new OpenAICompatibleProvider(config);
  }
}

export const aiEngine = new AIEngine();
