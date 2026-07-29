import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { fileURLToPath, URL } from 'node:url';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version?: string };

const appVersion = process.env.VITE_APP_VERSION || packageJson.version || '0.0.0';
const appBuildTime = process.env.VITE_APP_BUILD_TIME || new Date().toISOString();

export default defineConfig({
  base: './',
  plugins: [vue(), webResearchDevProxy()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_TIME__: JSON.stringify(appBuildTime)
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 3000
  }
});

function webResearchDevProxy(): Plugin {
  return {
    name: 'web-research-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__web-research/search', async (request, response) => {
        try {
          const incoming = new URL(request.url || '/', 'http://localhost');
          const target = new URL(searchEngineTarget(incoming.searchParams.get('engine')));
          incoming.searchParams.forEach((value, key) => {
            if (key !== 'engine') target.searchParams.append(key, value);
          });
          await relayPublicText(target, response);
        } catch (error) {
          respondProxyError(response, error);
        }
      });
      server.middlewares.use('/__web-research/read', async (request, response) => {
        try {
          const incoming = new URL(request.url || '/', 'http://localhost');
          const value = incoming.searchParams.get('url');
          if (!value) throw new Error('Missing public URL');
          await relayPublicText(new URL(value), response);
        } catch (error) {
          respondProxyError(response, error);
        }
      });
    }
  };
}

function searchEngineTarget(engine: string | null): string {
  if (engine === 'duckduckgo') return 'https://html.duckduckgo.com/html/';
  if (engine === 'duckduckgo-lite') return 'https://lite.duckduckgo.com/lite/';
  if (engine === 'sogou') return 'https://www.sogou.com/web';
  return 'https://www.bing.com/search';
}

async function relayPublicText(target: URL, response: ServerResponse): Promise<void> {
  let current = target;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    await requirePublicDevUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let upstream: Response;
    try {
      upstream = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml,text/plain;q=0.9',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
        }
      });
    } finally {
      clearTimeout(timeout);
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location || redirectCount === 3) throw new Error('Too many or invalid redirects');
      current = new URL(location, current);
      continue;
    }
    const contentType = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
    if (!/text|html|xml|json/i.test(contentType)) throw new Error(`Unsupported content type: ${contentType}`);
    const body = await readBoundedBody(upstream, 1_000_000);
    response.statusCode = upstream.status;
    response.setHeader('content-type', contentType);
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-web-research-final-url', current.toString());
    response.end(body);
    return;
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Remote response exceeds the development proxy limit');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return body;
}

async function requirePublicDevUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP(S) URLs are allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local addresses are not allowed');
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('Private network addresses are not allowed');
}

function isPrivateAddress(value: string): boolean {
  const address = value.toLowerCase();
  if (address.includes(':')) {
    return address === '::1' || address === '::' || address.startsWith('fc')
      || address.startsWith('fd') || address.startsWith('fe8') || address.startsWith('fe9')
      || address.startsWith('fea') || address.startsWith('feb');
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function respondProxyError(response: ServerResponse, error: unknown): void {
  response.statusCode = 502;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(error instanceof Error ? error.message : 'Web research proxy failed');
}
