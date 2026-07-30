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
  const researchService = await server.ssrLoadModule('/src/services/WebResearchService.ts');
  assert.throws(() => research.requirePublicWebUrl('https://127.0.0.1/private'), /本机或内网/);
  assert.throws(() => research.requirePublicWebUrl('https://[::ffff:127.0.0.1]/private'), /本机或内网/);
  assert.throws(() => research.requirePublicWebUrl('https://user:secret@example.com/private'), /账号信息/);
  assert.throws(() => research.requirePublicWebUrl('https://example.com:8443/private'), /非标准端口/);
  assert.throws(() => research.requirePublicWebUrl('http://example.com/plaintext'), /HTTPS/);
  assert.throws(() => research.requirePublicWebUrl('file:///tmp/test'), /HTTPS/);
  assert.equal(research.requirePublicWebUrl('https://www.gov.cn/test#section').hash, '');
  const recentUrls = researchService.rememberRecentPublicUrls(
    ['https://example.com/exam', ...Array.from({ length: 31 }, (_, index) => `https://example.com/old-${index}`)],
    ['https://example.com/exam', ...Array.from({ length: 16 }, (_, index) => `https://example.com/child-${index}`)],
    32
  );
  assert.equal(recentUrls.has('https://example.com/exam'), true, 'chunked page must remain authorized after child-link discovery');
  assert.equal(recentUrls.size, 32);

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
  const fallbackRequests = [];
  const builtInFallback = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      fallbackRequests.push(request);
      if (request.url.includes('bing.com')) return new Response('blocked', { status: 503 });
      return new Response(`<!doctype html><html><body>
        <div class="result results_links web-result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.gov.cn%2Fexam&amp;rut=test">江苏省考真题</a></h2><a class="result__snippet">公开真题来源</a><div class="clear"></div></div>
      </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
  });
  const fallbackResult = await builtInFallback.search({ query: '江苏省考真题', freshness: 'year', limit: 3 });
  assert.equal(fallbackResult.hits[0].title, '江苏省考真题');
  const fallbackDuckRequest = fallbackRequests.find((request) => request.url.startsWith('https://html.duckduckgo.com/html/'));
  assert.ok(fallbackDuckRequest, 'DuckDuckGo HTML must remain one of the built-in discovery paths');
  assert.equal(fallbackDuckRequest.headers.Authorization, undefined);

  const htmlFallbackRequests = [];
  const bingHtmlTarget = 'https://files.example.com/2024-jiangsu-a.pdf';
  const bingHtmlRedirect = `https://www.bing.com/ck/a?u=a1${Buffer.from(bingHtmlTarget).toString('base64url')}&ntb=1`;
  const bingHtmlFallback = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      htmlFallbackRequests.push(request);
      if (request.url.includes('format=rss')) return new Response('rss unavailable', { status: 503 });
      if (request.url.includes('duckduckgo.com')) return new Response('challenge', { status: 503 });
      return new Response(`<!doctype html><html><body><ol id="b_results">
        <li class="b_algo"><h2><a href="${bingHtmlRedirect.replace(/&/g, '&amp;')}"><strong>2024</strong>江苏省考A类真题 PDF</a></h2><div class="b_caption"><p>判断推理完整题目与选项</p></div></li>
      </ol></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
  });
  const htmlFallbackResult = await bingHtmlFallback.search({ query: '2024江苏省考A类判断推理真题', freshness: 'any', limit: 5 });
  assert.equal(htmlFallbackResult.hits[0].url, bingHtmlTarget);
  assert.ok(
    htmlFallbackRequests.some((request) => request.url.includes('bing.com/search') && !request.url.includes('format=rss')),
    'Bing HTML must remain available when RSS and DuckDuckGo fail'
  );

  const sogouRequests = [];
  const sogouFallback = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      sogouRequests.push(request);
      if (!request.url.includes('sogou.com')) return new Response('unavailable', { status: 503 });
      return new Response(`<!doctype html><html><body>
        <div class="vrwrap"><div class="struct201102">
          <h3 class="vr-title"><a target="_blank" href="/link?url=redirect-token"><em>2024年江苏公务员行测A类考试真题</em>及答案解析</a></h3>
          <p class="star-wiki space-txt">江苏省公务员考试行政职业能力测验，包含判断推理类比推理完整题目。</p>
          <div class="r-sech" data-url="https://www.docin.com/p-4695655051.html"></div>
        </div></div>
      </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
  });
  const sogouResult = await sogouFallback.search({
    query: '2024江苏省考A类判断推理真题',
    freshness: 'any',
    limit: 5
  });
  assert.equal(sogouResult.hits[0].url, 'https://www.docin.com/p-4695655051.html');
  assert.match(sogouResult.hits[0].snippet, /判断推理/);
  assert.ok(sogouRequests.some((request) => request.url.startsWith('https://www.sogou.com/web')));

  const blendedSearch = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      if (request.url.includes('bing.com')) {
        return new Response(`<?xml version="1.0"?><rss><channel>
          <item><title>2024江苏省考A类真题介绍</title><link>https://example.com/landing</link><description>试卷下载介绍</description></item>
        </channel></rss>`, { status: 200, headers: { 'content-type': 'text/xml' } });
      }
      return new Response(`<!doctype html><html><body>
        <div class="result results_links web-result"><h2><a class="result__a" href="https://files.example.com/2024-jiangsu-a.pdf">2024江苏省考A类真题 PDF</a></h2><a class="result__snippet">完整题目与选项</a><div class="clear"></div></div>
      </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
  });
  const blendedResult = await blendedSearch.search({ query: '2024江苏省考A类真题', freshness: 'any', limit: 5 });
  assert.equal(blendedResult.hits[0].url, 'https://files.example.com/2024-jiangsu-a.pdf');
  assert.equal(blendedResult.hits.length, 2, 'both free provider indexes should contribute relevant results');

  const lowRelevanceRequests = [];
  const lowRelevanceFallback = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      lowRelevanceRequests.push(request);
      if (request.url.includes('bing.com')) {
        return new Response(`<?xml version="1.0"?><rss><channel>
          <item><title>2024年</title><link>https://zh.wikipedia.org/wiki/2024%E5%B9%B4</link><description>公历闰年与日历</description></item>
          <item><title>2024 Calendar</title><link>https://example.com/calendar</link><description>Calendar dates</description></item>
        </channel></rss>`, { status: 200, headers: { 'content-type': 'text/xml' } });
      }
      return new Response(`<!doctype html><html><body>
        <div class="result results_links web-result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.huatu.com%2Fjiangsu%2F2024-a&amp;rut=test">2024年江苏省公务员考试A类判断推理真题</a></h2><a class="result__snippet">江苏省考行测真题题目与答案</a><div class="clear"></div></div>
        <div class="result results_links web-result"><h2><a class="result__a" href="https://zh.wikipedia.org/wiki/2024%E5%B9%B4">2024年</a></h2><a class="result__snippet">公历闰年与日历</a><div class="clear"></div></div>
      </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
  });
  const lowRelevanceResult = await lowRelevanceFallback.search({
    query: '2024 江苏省公务员考试 A类 判断推理 真题 题目',
    freshness: 'year',
    limit: 5
  });
  assert.equal(lowRelevanceRequests.length, 4);
  assert.ok(lowRelevanceRequests.some((request) => request.url.startsWith('https://html.duckduckgo.com/html/')));
  assert.equal(lowRelevanceResult.hits[0].domain, 'www.huatu.com');
  assert.equal(lowRelevanceResult.hits.length, 1, 'irrelevant fallback hits must not leak into Agent context');
  assert.match(lowRelevanceResult.hits[0].title, /江苏省公务员考试/);

  const singleCharacterNoise = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      if (request.url.includes('bing.com')) {
        return new Response(`<?xml version="1.0"?><rss><channel>
          <item><title>2024年</title><link>https://zh.wikipedia.org/wiki/2024%E5%B9%B4</link><description>公历日历和年度事件</description></item>
        </channel></rss>`, { status: 200, headers: { 'content-type': 'text/xml' } });
      }
      return new Response('<html><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
  });
  await assert.rejects(
    () => singleCharacterNoise.search({
      query: '2024江苏A类 类比推理 69题 停 止 行 选项 日 月 星',
      freshness: 'any',
      limit: 5
    }),
    /联网搜索暂时不可用/,
    'single Chinese characters must not make calendar results relevant'
  );
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

  const directFallbackRequests = [];
  const directFallbackReader = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send(request) {
      directFallbackRequests.push(request);
      if (request.url.startsWith('https://r.jina.ai/')) {
        return new Response('URL Source: https://example.gov.cn/exam', { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return new Response('<html><head><title>考试公告</title></head><body><main>这里是可直接读取的完整考试公告正文，包含考试范围、时间、报名条件与资格审查要求。</main></body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'x-web-research-final-url': 'https://example.gov.cn/exam-final'
        }
      });
    }
  });
  const directFallbackPage = await directFallbackReader.readPage('https://example.gov.cn/exam');
  assert.equal(directFallbackRequests.length, 2);
  assert.match(directFallbackPage.content, /完整考试公告正文/);
  assert.equal(directFallbackPage.title, '考试公告');
  assert.equal(directFallbackPage.url, 'https://example.gov.cn/exam-final');

  const longPage = new research.ConfiguredWebResearchGateway({
    enabled: true,
    provider: research.WebSearchProvider.BuiltIn,
    apiKey: '',
    updatedAt: 1
  }, {
    async send() {
      const preface = Array.from({ length: 900 }, (_, index) => `${index + 1}. 前置模块题目\nA、甲\nB、乙\nC、丙\nD、丁`).join('\n');
      const target = `四、判断推理\n66. 保护知识产权：保护创新\nA、人之初：性本善\nB、德不孤：必有邻\nC、勤有功：戏无益\nD、经一事：长一智`;
      const epilogue = Array.from({ length: 900 }, (_, index) => `${index + 1}. 后续模块题目\nA、甲\nB、乙\nC、丙\nD、丁`).join('\n');
      return new Response(`${preface}\n${target}\n${epilogue}`, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
  });
  const focusedPage = await longPage.readPage('https://example.gov.cn/long-exam', undefined, {
    focus: '判断推理',
    offset: 0
  });
  assert.match(focusedPage.content, /四、判断推理/);
  assert.match(focusedPage.content, /保护知识产权/);
  assert.ok(
    focusedPage.content.indexOf('四、判断推理') < 2_000,
    'zero offset must not suppress semantic focus'
  );
  assert.ok(focusedPage.content.length <= 24_100);

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
  await assert.rejects(() => jina.readPage('https://192.168.1.10/private'), /本机或内网/);

  console.log('Web research verification passed.');
} finally {
  await server.close();
}
