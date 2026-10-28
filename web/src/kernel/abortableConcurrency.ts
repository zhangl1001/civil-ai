/** A sibling failed; unfinished work may be retried with its parent operation. */
export class SiblingTaskFailedError extends Error {
  readonly code = 'execution.sibling_failed';

  constructor(cause: unknown) {
    super('A sibling task failed.', { cause });
    this.name = 'SiblingTaskFailedError';
  }
}

export async function mapWithAbortableConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  parentSignal: AbortSignal,
  work: (item: Input, index: number, signal: AbortSignal) => Promise<Output>
): Promise<readonly Output[]> {
  if (!items.length) return [];
  const results = new Array<Output>(items.length);
  const siblingController = new AbortController();
  const signal = AbortSignal.any([parentSignal, siblingController.signal]);
  let cursor = 0;
  let firstError: unknown;
  const workers = Array.from(
    { length: Math.min(Math.max(1, Math.floor(concurrency)), items.length) },
    async () => {
      while (cursor < items.length && !signal.aborted) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await work(items[index]!, index, signal);
        } catch (error) {
          firstError ??= error;
          siblingController.abort(new SiblingTaskFailedError(error));
          throw error;
        }
      }
    }
  );
  await Promise.allSettled(workers);
  if (parentSignal.aborted) throw abortReason(parentSignal);
  if (firstError !== undefined) throw firstError;
  return results;
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
