"""Web search skill — search the web and fetch page content."""

import email.message
import html.parser
import http.client
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from agent.tool_registry import tool


class _HTMLStripper(html.parser.HTMLParser):
    """Strip HTML tags, return plain text."""
    def __init__(self):
        super().__init__()
        self._text = []
    def handle_data(self, data):
        self._text.append(data)
    def get_text(self):
        return "".join(self._text)


def _strip_html(html_text: str) -> str:
    s = _HTMLStripper()
    s.feed(html_text)
    return s.get_text()


# Tags to drop entirely during extraction
_NOISE_TAGS = frozenset({
    "script", "style", "noscript", "iframe", "svg", "canvas",
    "nav", "header", "footer", "aside", "form", "button", "input",
    "select", "option", "textarea",
})

# Tags that should produce a line break
_BLOCK_TAGS = frozenset({
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "div", "blockquote", "pre", "hr",
    "ul", "ol", "li", "dl", "dt", "dd",
    "table", "thead", "tbody", "tr", "th", "td",
    "section", "article", "main", "figure", "figcaption",
    "details", "summary",
})


class _ContentExtractor(html.parser.HTMLParser):
    """Extract readable content from HTML, preserving structure."""

    def __init__(self):
        super().__init__()
        self._parts = []       # collected text pieces
        self._skip_depth = 0   # >0 means inside a noise tag
        self._skip_tags = []   # stack of noise tags we're inside
        self._in_link = False
        self._link_href = ""
        self._current_block_text = []

    def feed(self, data):
        data = re.sub(r'[ \t]+', ' ', data)
        super().feed(data)
        self._flush_block()

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in _NOISE_TAGS:
            self._skip_depth += 1
            self._skip_tags.append(tag)
            return
        if self._skip_depth > 0:
            return
        if tag == "a":
            self._in_link = True
            self._link_href = dict(attrs).get("href", "")
            self._flush_block()
            return
        if tag in _BLOCK_TAGS:
            self._flush_block()
            return

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._skip_tags and tag == self._skip_tags[-1]:
            self._skip_tags.pop()
            self._skip_depth -= 1
            return
        if self._skip_depth > 0:
            return
        if tag == "a" and self._in_link:
            self._in_link = False
            self._link_href = ""
            return
        if tag in _BLOCK_TAGS:
            self._flush_block()
            return

    def handle_data(self, data):
        if self._skip_depth > 0:
            return
        text = data.strip()
        if not text:
            return
        if self._in_link:
            self._parts.append(f"[{text}]({self._link_href})" if self._link_href else text)
        else:
            self._parts.append(text)

    def _flush_block(self):
        if self._parts:
            self._current_block_text.append(" ".join(self._parts))
            self._parts = []

    def get_text(self) -> str:
        lines = []
        for block in self._current_block_text:
            block = block.strip()
            if block:
                lines.append(block)
            elif lines and lines[-1] != "":
                lines.append("")
        result = "\n".join(lines)
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()


def _extract_content(html_content: str) -> str:
    """Extract readable content from HTML, preserving basic structure."""
    extractor = _ContentExtractor()
    extractor.feed(html_content)
    return extractor.get_text()


_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


# Multiple Bing regex patterns for robustness
_BING_PATTERNS = [
    # Pattern 1: b_algo + tilk (current Bing layout)
    {
        "block": r'<li[^>]*b_algo[^>]*>(.*?)</li>',
        "url": r'<a[^>]*tilk[^>]*href="([^"]+)"',
        "title": r'<h2[^>]*>(.*?)</h2>',
        "snippet": r'<p[^>]*>(.*?)</p>',
    },
    # Pattern 2: b_algo + any href (fallback for layout changes)
    {
        "block": r'<li[^>]*b_algo[^>]*>(.*?)</li>',
        "url": r'<a[^>]*href="([^"]*https?://[^"]+)"',
        "title": r'<h2[^>]*>(.*?)</h2>',
        "snippet": r'<p[^>]*>(.*?)</p>',
    },
    # Pattern 3: generic result blocks (last resort)
    {
        "block": r'<div[^>]*class="[^"]*result[^"]*"[^>]*>(.*?)</div>',
        "url": r'<a[^>]*href="([^"]*https?://[^"]+)"',
        "title": r'<h[1-3][^>]*>(.*?)</h[1-3]>',
        "snippet": r'<(p|span|div)[^>]*>(.*?)</(p|span|div)>',
    },
]

# Known trusted domains for credibility scoring
_TRUSTED_DOMAINS = {
    "github.com": "代码托管平台",
    "stackoverflow.com": "技术问答社区",
    "docs.microsoft.com": "Microsoft 官方文档",
    "developer.mozilla.org": "MDN Web 文档",
    "wikipedia.org": "维基百科",
    "zhihu.com": "知乎",
    "juejin.cn": "掘金开发者社区",
    "csdn.net": "CSDN 技术社区",
    "blog.csdn.net": "CSDN 博客",
    "cnblogs.com": "博客园",
    "segmentfault.com": "SegmentFault 思否",
    "oschina.net": "开源中国",
    "infoq.cn": "InfoQ 中国",
    "jianshu.com": "简书",
    "zhuanlan.zhihu.com": "知乎专栏",
    "www.runoob.com": "菜鸟教程",
    "www.w3school.com.cn": "w3school 在线教程",
    "v2ex.com": "V2EX 社区",
    "npmjs.com": "NPM 包管理",
    "pypi.org": "Python 包索引",
}


def _classify_domain(url: str) -> str:
    """Classify URL domain credibility for LLM quick judgment."""
    try:
        domain = urllib.parse.urlparse(url).netloc.lower()
        domain = re.sub(r'^www\.', '', domain)
    except Exception:
        return ""
    if domain in _TRUSTED_DOMAINS:
        return _TRUSTED_DOMAINS[domain]
    for trusted, label in _TRUSTED_DOMAINS.items():
        if domain.endswith("." + trusted):
            return label
    return ""


def _detect_encoding(headers: email.message.Message) -> str | None:
    """Detect page encoding from Content-Type header."""
    content_type = headers.get("Content-Type", "")
    m = re.search(r'charset=([^\s;]+)', content_type, re.IGNORECASE)
    if m:
        return m.group(1).strip("'\"")
    return None


def _decode_response(resp: http.client.HTTPResponse) -> str:
    """Decode HTTP response body with auto-detection for Chinese encodings."""
    raw = resp.read()
    # 1. Content-Type header charset
    charset = _detect_encoding(resp.headers)
    if charset:
        try:
            return raw.decode(charset, errors="replace")
        except LookupError:
            pass
    # 2. <meta charset> tag
    meta_m = re.search(rb'<meta[^>]+charset=["\']?([a-zA-Z0-9_-]+)', raw)
    if meta_m:
        cs = meta_m.group(1).decode("ascii", errors="replace")
        try:
            return raw.decode(cs, errors="replace")
        except LookupError:
            pass
    # 3. GBK heuristic: try GBK first, if it produces Chinese chars, use it
    try:
        text = raw.decode("gbk")
        if re.search(r'[一-鿿]', text):
            return text
    except (UnicodeDecodeError, LookupError):
        pass
    # 4. UTF-8 fallback
    return raw.decode("utf-8", errors="replace")


def _format_http_error(e: Exception, url: str) -> str:
    """Format HTTP errors with actionable context for the agent."""
    if isinstance(e, urllib.error.HTTPError):
        codes = {
            400: "请求格式错误，检查 URL 参数",
            403: "页面拒绝访问（可能需要登录或反爬），尝试换其他 URL",
            404: "页面不存在，检查 URL 或换其他来源",
            429: "请求太频繁被限流，等几秒再试",
            500: "服务器内部错误，稍后重试或换其他 URL",
            502: "网关错误，服务器暂时不可用",
            503: "服务暂时不可用（维护或过载），稍后重试",
        }
        hint = codes.get(e.code, f"HTTP {e.code}")
        return f"HTTP {e.code} {hint}: {url}"
    if isinstance(e, urllib.error.URLError):
        reason = str(e.reason)
        if "timed out" in reason.lower() or isinstance(e.reason, socket.timeout):
            return f"请求超时: {url}（网络慢或服务器无响应，换其他来源）"
        if "refused" in reason.lower():
            return f"连接被拒绝: {url}（网站可能下线了）"
        if "Name or service not known" in reason or "nodename nor servname" in reason.lower():
            return f"DNS 解析失败: {url}（域名不存在）"
        return f"网络错误: {reason} — {url}"
    if isinstance(e, (socket.timeout, TimeoutError)):
        return f"请求超时: {url}"
    return f"抓取失败: {e} — {url}"


@tool(
    name="web_search",
    description="Search the web for information. Returns title, snippet, and URL for each result. Use before fetch_page to find relevant URLs.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "num_results": {"type": "integer", "description": "Number of results to return (default 10)"},
        },
        "required": ["query"],
    }
)
def web_search(query: str, num_results: int = 10) -> str:
    """Search using Bing HTML search page with multiple fallback patterns."""
    try:
        url = "https://www.bing.com/search?" + urllib.parse.urlencode({"q": query})
        req = urllib.request.Request(url, headers={
            "User-Agent": _UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            html_content = _decode_response(resp)
    except Exception as e:
        return _format_http_error(e, url)

    # Try multiple regex patterns until one yields results
    for pat in _BING_PATTERNS:
        blocks = re.findall(pat["block"], html_content, re.DOTALL)
        results = []
        for block in blocks:
            url_match = re.search(pat["url"], block)
            title_match = re.search(pat["title"], block, re.DOTALL)
            snippet_match = re.search(pat["snippet"], block, re.DOTALL)
            if not url_match:
                continue
            result_url = url_match.group(1)
            if not result_url.startswith(("http://", "https://")):
                continue
            title = _strip_html(title_match.group(1)).strip()[:200] if title_match else ""
            snippet = _strip_html(snippet_match.group(1)).strip()[:200] if snippet_match else ""
            site_type = _classify_domain(result_url)
            results.append({"title": title, "url": result_url, "snippet": snippet, "site_type": site_type})
            if len(results) >= num_results:
                break
        if results:
            break  # got results, stop trying patterns

    if not results:
        return f"未找到 '{query}' 的搜索结果，尝试换一个关键词或搜索引擎。"

    lines = [f"找到 {len(results)} 条结果：\n"]
    for i, r in enumerate(results, 1):
        type_hint = f" [{r['site_type']}]" if r["site_type"] else ""
        lines.append(f"{i}. {r['title']}{type_hint}")
        if r["snippet"]:
            lines.append(f"   {r['snippet']}")
        lines.append(f"   URL: {r['url']}")
    lines.append("\n使用 fetch_page(url) 获取完整页面内容。")
    return "\n".join(lines)


@tool(
    name="fetch_page",
    description="Fetch a web page and extract its text content. Useful for reading articles, documentation, or tutorials found via web_search. For pages requiring login, use headers parameter.",
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "URL to fetch"},
            "max_chars": {"type": "integer", "description": "Maximum characters to return (default 5000)"},
            "headers": {"type": "string", "description": "Optional custom headers as JSON string, for pages requiring login or special auth"},
        },
        "required": ["url"],
    }
)
def fetch_page(url: str, max_chars: int = 5000, headers: str = None) -> str:
    """Fetch a page and extract text content with structure preservation."""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        import json
        req_headers = {
            "User-Agent": _UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        if headers:
            req_headers.update(json.loads(headers))
        req = urllib.request.Request(url, headers=req_headers)

        with urllib.request.urlopen(req, timeout=20) as resp:
            html_content = _decode_response(resp)
    except Exception as e:
        return _format_http_error(e, url)

    text = _extract_content(html_content)

    total = len(text)
    if total <= 0:
        return f"页面 {url} 无可提取的文本内容（可能需要登录或为纯 JS 渲染）。"
    if total > max_chars:
        head = text[:max_chars * 2 // 3]
        tail = text[-max_chars // 3:]
        text = f"{head}\n...({total - max_chars} chars omitted)...\n{tail}"

    return f"Content from {url} ({total} chars):\n\n{text}"


@tool(
    name="fetch_robots",
    description="Fetch a site's robots.txt or sitemap to quickly discover available pages. Faster than fetching full pages for documentation sites. Use path='/robots.txt' or path='/sitemap.xml'.",
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "Base URL of the site (e.g. https://docs.example.com)"},
            "path": {"type": "string", "description": "Path to fetch, default '/robots.txt'. Also try '/sitemap.xml' or '/sitemap_index.xml'"},
            "max_chars": {"type": "integer", "description": "Maximum characters to return (default 5000)"},
        },
        "required": ["url"],
    }
)
def fetch_robots(url: str, path: str = "/robots.txt", max_chars: int = 5000) -> str:
    """Fetch robots.txt or sitemap from a site."""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        base = url.rstrip("/")
        full_url = f"{base}{path.lstrip('/')}"
        req = urllib.request.Request(full_url, headers={
            "User-Agent": _UA,
            "Accept": "text/plain,application/xml,text/xml,*/*;q=0.1",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        return _format_http_error(e, full_url)

    total = len(text)
    if total > max_chars:
        text = text[:max_chars] + f"\n...({total - max_chars} chars omitted)..."

    return f"{path} from {url} ({total} chars):\n\n{text}"
