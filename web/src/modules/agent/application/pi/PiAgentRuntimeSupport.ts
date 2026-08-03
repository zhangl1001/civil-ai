import type { ModelToolCall } from '@/capabilities/ai-runtime/public';
import type { JsonObject } from '@/kernel/public';
import type { AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import type { Message as PiMessage } from '@earendil-works/pi-ai';
import type { AgentToolExecutionResult } from '../../contracts/AgentRuntimePorts';
import { limitToolResult } from '../AgentLoopSupport';

export interface PiToolDetails {
  readonly call: ModelToolCall;
  readonly status: 'succeeded' | 'no_progress' | 'failed' | 'confirmation_required';
  readonly isError: boolean;
  readonly retryable: boolean;
  readonly failureCode?: string;
  readonly resultRef?: string;
  readonly terminate?: boolean;
}

export function isPiMessage(message: PiAgentMessage): message is PiMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}

export function latestAssistant(messages: readonly PiAgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') return message;
  }
  return undefined;
}

export function toPiUserMessage(content: string): PiMessage {
  return { role: 'user', content, timestamp: Date.now() };
}

export function toModelToolCall(id: string, name: string, value: unknown): ModelToolCall {
  return {
    id,
    name,
    arguments: isJsonObject(value) ? value : { _parseError: 'Tool arguments must be an object' }
  };
}

export function resultMadeProgress(result: AgentToolExecutionResult): boolean {
  return result.madeProgress ?? Boolean(
    result.content.trim()
    || result.resultRef
    || result.activateToolNames?.length
    || result.activateSkills?.length
  );
}

export function toolObservation(
  result: AgentToolExecutionResult,
  madeProgress: boolean,
  maxChars: number
): string {
  const status = result.isError ? 'failed' : madeProgress ? 'succeeded' : 'no_progress';
  if (status === 'succeeded') return limitToolResult(result.content, maxChars);
  return limitToolResult([
    '【Agent 工具观察】',
    `status: ${status}`,
    `retryable: ${result.isError ? result.retryable !== false : true}`,
    result.failureCode ? `failure_code: ${result.failureCode}` : '',
    '请根据结果调整参数、范围、工具或步骤，不要机械重复。',
    result.content
  ].filter(Boolean).join('\n'), maxChars);
}

export function piFailure(
  call: ModelToolCall,
  content: string,
  failureCode: string,
  retryable: boolean,
  terminate = false
) {
  return {
    content: [{ type: 'text' as const, text: content }],
    details: {
      call,
      status: 'failed' as const,
      isError: true,
      retryable,
      failureCode,
      terminate
    } satisfies PiToolDetails,
    terminate
  };
}

export function piConfirmation(call: ModelToolCall, content: string) {
  return {
    content: [{ type: 'text' as const, text: content }],
    details: {
      call,
      status: 'confirmation_required' as const,
      isError: false,
      retryable: false,
      terminate: true
    } satisfies PiToolDetails,
    terminate: true
  };
}

export class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.active >= this.capacity) await this.wait(signal);
    signal?.throwIfAborted();
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }

  private wait(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const resume = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        const index = this.waiters.indexOf(resume);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      this.waiters.push(resume);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

