"""WebFetch tool — fetch and process web content. Like Claude Code's WebFetch."""

import re
from agent.tool_registry import tool


@tool(
    name="web_fetch",
    description="Fetch content from a URL and process it with an AI model. Fetches the URL, converts HTML to markdown, and returns model's response about the content. Use for retrieving and analyzing web page content.",
    parameters={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to fetch content from. Must be a fully-formed valid URL."
            },
            "prompt": {
                "type": "string",
                "description": "The prompt describing what information to extract from the page."
            },
        },
        "required": ["url", "prompt"],
    }
)
def web_fetch(url: str, prompt: str) -> str:
    import urllib.request
    import urllib.error

    # Basic URL validation
    if not re.match(r'^https?://', url):
        url = f'https://{url}'

    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; ClaudeCode/1.0)',
                'Accept': 'text/html,application/xhtml+xml,*/*',
            }
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            # Respect size limit
            content_type = resp.headers.get('Content-Type', '')
            if 'text/html' not in content_type and 'text/plain' not in content_type:
                return f"Error: unsupported content type '{content_type}'. Only text/html and text/plain are supported."

            raw = resp.read(1024 * 1024)  # 1MB limit
            encoding = resp.headers.get_content_charset() or 'utf-8'
            html = raw.decode(encoding, errors='replace')
    except urllib.error.HTTPError as e:
        return f"Error fetching URL: HTTP {e.code} {e.reason}"
    except urllib.error.URLError as e:
        return f"Error fetching URL: {e.reason}"
    except Exception as e:
        return f"Error fetching URL: {e}"

    # Convert HTML to plain text (simple approach)
    text = _html_to_text(html)

    if len(text) < 10:
        return f"Error: page returned no readable text content."

    # Truncate to reasonable size for the prompt context
    max_chars = 8000
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n\n[Content truncated: {len(text)} total chars, showing first {max_chars}]"

    return f"Fetched content from {url}:\n\n--- BEGIN CONTENT ---\n{text}\n--- END CONTENT ---\n\nPlease use the prompt to analyze: {prompt}"


def _html_to_text(html: str) -> str:
    """Simple HTML to plain text converter. Strips tags and scripts, preserves newlines."""
    # Remove scripts, styles, comments
    for tag in ('script', 'style', 'noscript', 'iframe'):
        html = re.sub(rf'<{tag}[^>]*>.*?</{tag}>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)

    # Replace block elements with newlines
    for tag in ('p', 'div', 'li', 'tr', 'h[1-6]', 'br', 'article', 'section', 'header', 'footer', 'main', 'nav', 'aside', 'blockquote', 'pre', 'table'):
        html = re.sub(rf'</?{tag}[^>]*>', '\n', html, flags=re.IGNORECASE)

    # Remove remaining tags
    html = re.sub(r'<[^>]+>', '', html)

    # Decode common entities
    html = html.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    html = html.replace('&quot;', '"').replace('&#39;', "'").replace('&apos;', "'")

    # Collapse whitespace
    lines = [line.strip() for line in html.split('\n')]
    lines = [line for line in lines if line]
    return '\n'.join(lines)
