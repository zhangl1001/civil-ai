import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const research = await server.ssrLoadModule('/src/capabilities/web-research/public.ts');
  assert.throws(() => research.requirePublicWebUrl('http://127.0.0.1/private'), /本机或内网/);
  assert.throws(() => research.requirePublicWebUrl('http://[::ffff:127.0.0.1]/private'), /本机或内网/);
  assert.throws(() => research.requirePublicWebUrl('https://user:secret@example.com/private'), /账号信息/);
  assert.throws(() => research.requirePublicWebUrl('https://example.com:8443/private'), /非标准端口/);
  assert.throws(() => research.requirePublicWebUrl('file:///tmp/test'), /HTTP/);
  assert.equal(research.requirePublicWebUrl('https://www.gov.cn/test#section').hash, '');

  const builtInRequests = [];
  const builtIn = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      builtInRequests.push(request);
      return new Response(`<?xml version="1.0"?><rss><channel>
        <item><title>国务院&amp;政策</title><link>https://www.gov.cn/policy/latest</link><description>近期&lt;b&gt;政策&lt;/b&gt;摘要</description><pubDate>Mon, 27 Jul 2026 00:00:00 GMT</pubDate></item>
        <item><title>内网</title><link>http://127.0.0.1/private</link><description>不得返回</description></item>
      </channel></rss>`, { status: 200, headers: { 'content-type': 'text/xml' } });
    }
  });
  const builtInResult = await builtIn.search({ query: '近期时政', freshness: 'week', limit: 5 });
  assert.equal(builtInResult.hits.length, 1);
  assert.equal(builtInResult.hits[0].title, '国务院&政策');
  assert.equal(builtInResult.hits[0].snippet, '近期政策摘要');
  assert.match(builtInRequests[0].url, /format=rss/);
  assert.match(builtInRequests[0].url, /filters=/);
  const readerRequests = [];
  const builtInReader = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      readerRequests.push(request);
      return new Response('国务院政策正文', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
  });
  await builtInReader.readPage('https://www.gov.cn/policy/latest');
  assert.match(readerRequests[0].url, /^https:\/\/r\.jina\.ai\/https:\/\/www\.gov\.cn/);
  assert.equal(readerRequests[0].headers.Authorization, undefined);

  const braveRequests = [];
  const brave = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.Brave,
    apiKey: 'brave-test',
    updatedAt: 1
  }, {
    async send(request) {
      braveRequests.push(request);
      return new Response(JSON.stringify({
        web: {
          results: [
            { title: '国务院政策', url: 'https://www.gov.cn/policy/1', description: '政策摘要', extra_snippets: ['补充证据'] },
            { title: '无效内网', url: 'http://127.0.0.1/private', description: '不得返回' }
          ]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const braveResult = await brave.search({ query: '近期时政', freshness: 'week', limit: 3 });
  assert.equal(braveResult.hits.length, 1);
  assert.equal(braveResult.hits[0].domain, 'www.gov.cn');
  assert.match(braveResult.hits[0].snippet, /补充证据/);
  assert.equal(braveRequests[0].method, 'GET');
  assert.equal(braveRequests[0].headers['X-Subscription-Token'], 'brave-test');
  assert.match(braveRequests[0].url, /freshness=pw/);

  const jina = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.Jina,
    apiKey: 'jina-test',
    updatedAt: 1
  }, {
    async send(request) {
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.Authorization, 'Bearer jina-test');
      return new Response(JSON.stringify({
        data: [
          { title: '省考公告', url: 'https://example.gov.cn/exam', description: '公告摘要', content: '公告正文摘要' }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const jinaResult = await jina.search({ query: '省考大纲', freshness: 'any', limit: 5 });
  assert.equal(jinaResult.hits[0].title, '省考公告');
  assert.equal(jinaResult.hits[0].content, '公告正文摘要');
  await assert.rejects(() => jina.readPage('http://192.168.1.10/private'), /本机或内网/);

  console.log('Web research verification passed.');
} finally {
  await server.close();
}
