import type { JsonObject } from '@/kernel/public';

export interface AgentFileChunk {
  readonly content: string;
  readonly resultRef: string;
}

export function createAgentFileChunk(
  path: string,
  content: string,
  argumentsValue: JsonObject
): AgentFileChunk {
  const offset = boundedInteger(argumentsValue.offset, 0, content.length, 0);
  const maxChars = boundedInteger(argumentsValue.maxChars, 2_000, 24_000, 16_000);
  const chunk = content.slice(offset, offset + maxChars);
  const nextOffset = offset + chunk.length < content.length ? offset + chunk.length : null;
  return {
    content: [
      `文件片段：${offset}-${offset + chunk.length} / ${content.length}`,
      nextOffset === null ? '已读取到文件末尾。' : `仍有后续内容；需要时以 offset=${nextOffset} 继续读取。`,
      '',
      chunk
    ].join('\n'),
    resultRef: path
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}
