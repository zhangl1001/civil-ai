import type { JsonObject } from '@/kernel/public';
import {
  buildGenerationVariationContext,
  isNearDuplicateGeneratedContent,
  type GenerationVariationKindCode,
  type RecentGeneratedContent
} from '@/modules/content/public';
import type { AITextMessage, AITextRequestOptions } from '../ai/ConfiguredAIClient';

export interface FreshGeneratedContentContext {
  compilePrompt(
    promptCode: string,
    payload: Record<string, unknown>
  ): { readonly system: string; readonly user: string; readonly responseSchema: JsonObject };
  complete(
    messages: readonly AITextMessage[],
    options?: AITextRequestOptions
  ): Promise<string>;
  log(message: string): Promise<void>;
}

export interface GeneratedLearningAssetReference {
  readonly title: string;
  readonly payload: Record<string, unknown>;
}

export function learningAssetReferences(
  assets: readonly GeneratedLearningAssetReference[],
  limit = 12
): RecentGeneratedContent[] {
  return assets.slice(0, limit).flatMap((asset) => {
    const directContent = typeof asset.payload.content === 'string' ? asset.payload.content : '';
    const content = directContent || stringifyPayloadContent(asset.payload);
    return content ? [{ title: asset.title, content }] : [];
  });
}

export async function completeFreshGeneratedContent(input: {
  readonly context: FreshGeneratedContentContext;
  readonly promptCode: string;
  readonly payload: Record<string, unknown>;
  readonly variationKind: GenerationVariationKindCode;
  readonly seed: string;
  readonly recentItems: readonly RecentGeneratedContent[];
  readonly options?: AITextRequestOptions;
  readonly structured?: boolean;
}): Promise<string> {
  let lastResult = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = input.context.compilePrompt(input.promptCode, {
      ...input.payload,
      generationVariation: buildGenerationVariationContext({
        kind: input.variationKind,
        seed: input.seed,
        attempt,
        recentItems: input.recentItems
      })
    });
    lastResult = await input.context.complete([
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], {
      ...input.options,
      ...(input.structured ? { responseSchema: prompt.responseSchema } : {})
    });
    if (!isNearDuplicateGeneratedContent(lastResult, input.recentItems)) return lastResult;
    await input.context.log('生成结果与近期内容高度相似，切换教学视角后重试一次');
  }
  return lastResult;
}

function stringifyPayloadContent(payload: Record<string, unknown>): string {
  const meaningful = payload.question ?? payload.lecture ?? payload;
  try {
    return JSON.stringify(meaningful);
  } catch {
    return '';
  }
}
