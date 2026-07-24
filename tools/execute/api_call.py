"""
API call tool - execute HTTP requests for API testing and integration tasks.
"""

import json
import time
import urllib.request
import urllib.error
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="api_call",
    description="Execute an HTTP request and return structured response data. Use for API debugging, integration testing, and inspecting HTTP responses.",
    parameters={
        "type": "object",
        "properties": {
            "method": {
                "type": "string",
                "enum": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
                "description": "HTTP method (default GET)"
            },
            "url": {
                "type": "string",
                "description": "Full request URL (e.g. https://api.example.com/v1/users)"
            },
            "headers": {
                "type": "string",
                "description": "JSON object of headers, e.g. {\"Authorization\": \"Bearer xxx\", \"Content-Type\": \"application/json\"}"
            },
            "body": {
                "type": "string",
                "description": "Request body (JSON string for POST/PUT/PATCH). Will be sent as JSON if body starts with { or ["
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Request timeout in seconds (default 30)"
            },
            "max_response_chars": {
                "type": "integer",
                "description": "Max response chars to return (default 5000)"
            },
        },
        "required": ["url"],
    },
    category="execute",
)
def api_call(
    url: str,
    method: str = "GET",
    headers: str = "",
    body: str = "",
    timeout_seconds: int = 30,
    max_response_chars: int = 5000,
) -> str:
    parsed_headers = {}
    if headers:
        try:
            parsed_headers = parse_json_arg(headers)
        except Exception:
            return f"Error parsing headers JSON: {headers}"

    data = None
    content_type = None
    if body:
        stripped = body.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            # JSON body
            try:
                data = json.dumps(json.loads(stripped)).encode("utf-8")
                content_type = "application/json"
            except json.JSONDecodeError:
                data = stripped.encode("utf-8")
        else:
            data = stripped.encode("utf-8")

    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", "zhangl-agent/1.0")
    if content_type:
        req.add_header("Content-Type", content_type)
    for k, v in parsed_headers.items():
        req.add_header(k, v)

    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            elapsed = round((time.monotonic() - start) * 1000)
            resp_body = resp.read().decode("utf-8", errors="replace")
            if len(resp_body) > max_response_chars:
                resp_body = resp_body[:max_response_chars] + f"\n... ({len(resp_body)} total chars, truncated)"

            return json.dumps({
                "status": resp.status,
                "status_text": resp.reason,
                "headers": dict(resp.headers),
                "body": resp_body,
                "elapsed_ms": elapsed,
                "truncated": len(resp_body) >= max_response_chars,
            }, ensure_ascii=False, indent=2)

    except urllib.error.HTTPError as e:
        elapsed = round((time.monotonic() - start) * 1000)
        resp_body = ""
        try:
            resp_body = e.read().decode("utf-8", errors="replace")
            if len(resp_body) > max_response_chars:
                resp_body = resp_body[:max_response_chars] + f"\n... ({len(resp_body)} total chars, truncated)"
        except Exception:
            pass
        return json.dumps({
            "status": e.code,
            "status_text": e.reason,
            "headers": dict(e.headers),
            "body": resp_body,
            "elapsed_ms": elapsed,
            "error": True,
        }, ensure_ascii=False, indent=2)

    except urllib.error.URLError as e:
        elapsed = round((time.monotonic() - start) * 1000)
        return json.dumps({
            "status": 0,
            "error": True,
            "reason": str(e.reason),
            "elapsed_ms": elapsed,
        }, ensure_ascii=False, indent=2)

    except Exception as e:
        elapsed = round((time.monotonic() - start) * 1000)
        return json.dumps({
            "status": 0,
            "error": True,
            "reason": str(e),
            "elapsed_ms": elapsed,
        }, ensure_ascii=False, indent=2)
