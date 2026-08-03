import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { HttpTransportRequest } from '@/capabilities/ai-runtime/public';

interface NativeStreamEvent {
  readonly requestId: string;
  readonly type: 'response' | 'data' | 'complete';
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly url?: string;
  readonly base64?: string;
  readonly error?: string | null;
}

export const NativeHttpRequestPurpose = {
  Model: 'model',
  PublicWeb: 'publicWeb'
} as const;

export type NativeHttpRequestPurpose =
  typeof NativeHttpRequestPurpose[keyof typeof NativeHttpRequestPurpose];

interface NativeStreamingHTTPPlugin {
  getStatus(): Promise<{
    readonly available: boolean;
    readonly version: number;
    readonly activeStreamCount: number;
  }>;
  startStream(options: {
    readonly requestId: string;
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly purpose: NativeHttpRequestPurpose;
  }): Promise<{ readonly requestId: string }>;
  cancelStream(options: { readonly requestId: string }): Promise<void>;
  addListener(
    eventName: 'nativeHttpStream',
    listener: (event: NativeStreamEvent) => void
  ): Promise<PluginListenerHandle>;
}

const nativeStreamingHTTP = registerPlugin<NativeStreamingHTTPPlugin>('NativeStreamingHTTP');
let availabilityProbe: Promise<void> | undefined;

export function isNativeStreamingPluginUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /NativeStreamingHTTP.*(?:not implemented|unimplemented|not (?:available|found|registered))|plugin.+(?:not implemented|unimplemented|unavailable|not (?:available|found|registered))/i.test(message);
}

export class NativeStreamingHttpAdapter {
  constructor(
    private readonly purpose: NativeHttpRequestPurpose = NativeHttpRequestPurpose.Model
  ) {}

  async send(request: HttpTransportRequest): Promise<Response> {
    request.signal?.throwIfAborted();
    await ensureNativeStreamingAvailable();
    request.signal?.throwIfAborted();
    const releasePermit = await nativeTransportGate.acquire(request.signal);
    let permitReleased = false;
    const release = () => {
      if (permitReleased) return;
      permitReleased = true;
      releasePermit();
    };
    const requestId = crypto.randomUUID();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let listener: PluginListenerHandle | undefined;
    let settled = false;

    const stream = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
      cancel() {
        void nativeStreamingHTTP.cancelStream({ requestId }).catch(() => undefined);
      }
    });

    const response = new Promise<Response>((resolve, reject) => {
      const fail = (error: unknown) => {
        release();
        request.signal?.removeEventListener('abort', abort);
        if (settled) {
          try {
            controller?.error(error);
          } catch {
            // The consumer may already have closed the stream after cancellation.
          }
        } else {
          settled = true;
          reject(error);
        }
        void listener?.remove();
      };
      const abort = () => {
        void nativeStreamingHTTP.cancelStream({ requestId }).catch(() => undefined);
        fail(request.signal?.reason ?? new DOMException('Request aborted', 'AbortError'));
      };
      request.signal?.addEventListener('abort', abort, { once: true });

      void nativeStreamingHTTP.addListener('nativeHttpStream', (event) => {
        if (event.requestId !== requestId) return;
        if (event.type === 'response') {
          if (settled) return;
          settled = true;
          const headers = new Headers(event.headers ?? {});
          if (event.url) headers.set('x-platform-final-url', event.url);
          resolve(new Response(stream, {
            status: event.status ?? 200,
            headers
          }));
          return;
        }
        if (event.type === 'data') {
          if (event.base64) controller?.enqueue(decodeBase64(event.base64));
          return;
        }
        request.signal?.removeEventListener('abort', abort);
        release();
        if (event.error) {
          fail(new Error(event.error));
          return;
        }
        if (!settled) {
          fail(new Error('Native stream ended before receiving an HTTP response'));
          return;
        }
        void listener?.remove();
        controller?.close();
      }).then((handle) => {
        listener = handle;
        if (settled || request.signal?.aborted) {
          void listener.remove();
          return;
        }
        return nativeStreamingHTTP.startStream({
          requestId,
          url: request.url,
          method: request.method,
          headers: { ...request.headers },
          body: request.body ?? '',
          purpose: this.purpose
        });
      }).catch(fail);
    });

    return response;
  }
}

interface NativeTransportWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  cancelled: boolean;
  abort?: () => void;
}

/**
 * All model, enrichment and public-web requests share the same native URLSession
 * capacity. Queueing here prevents independent business pools from overflowing
 * the Swift plugin and turning normal contention into provider retries.
 */
class NativeTransportGate {
  private active = 0;
  private readonly queue: NativeTransportWaiter[] = [];

  constructor(private readonly limit: number) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise<() => void>((resolve, reject) => {
      const waiter: NativeTransportWaiter = {
        resolve,
        reject,
        signal,
        cancelled: false
      };
      waiter.abort = () => {
        waiter.cancelled = true;
        reject(abortReason(signal));
        this.drain();
      };
      signal?.addEventListener('abort', waiter.abort, { once: true });
      this.queue.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.limit && this.queue.length) {
      const waiter = this.queue.shift()!;
      waiter.signal?.removeEventListener('abort', waiter.abort!);
      if (waiter.cancelled || waiter.signal?.aborted) continue;
      this.active += 1;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
        this.drain();
      });
    }
  }
}

const NATIVE_TRANSPORT_CONCURRENCY = 6;
const nativeTransportGate = new NativeTransportGate(NATIVE_TRANSPORT_CONCURRENCY);

export async function probeNativeStreamingHttp(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await ensureNativeStreamingAvailable();
    return true;
  } catch {
    return false;
  }
}

async function ensureNativeStreamingAvailable(): Promise<void> {
  availabilityProbe ??= nativeStreamingHTTP.getStatus().then((status) => {
    if (!status.available) {
      throw new Error('NativeStreamingHTTP plugin reported unavailable');
    }
  }).catch((error: unknown) => {
    if (!isNativeStreamingPluginUnavailable(error)) {
      availabilityProbe = undefined;
    }
    throw error;
  });
  return availabilityProbe;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('Request aborted', 'AbortError');
}
