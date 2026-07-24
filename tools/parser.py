"""
Document parsing tools - parse OpenAPI specs, Markdown docs, etc.
"""

import json
import yaml
from agent.tool_registry import tool


@tool(
    name="parse_openapi",
    description="Parse an OpenAPI/Swagger specification into a structured summary of endpoints, parameters, and schemas.",
    parameters={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "Raw OpenAPI YAML or JSON content"},
        },
        "required": ["content"],
    }
)
def parse_openapi(content: str) -> str:
    try:
        if content.strip().startswith("{"):
            spec = json.loads(content)
        else:
            spec = yaml.safe_load(content)
    except (json.JSONDecodeError, yaml.YAMLError) as e:
        return f"Error parsing OpenAPI spec: {e}"

    if not isinstance(spec, dict):
        return "Error: not a valid OpenAPI specification"

    info = spec.get("info", {})
    title = info.get("title", "Untitled API")
    version = info.get("version", "unknown")
    base_url = ""
    servers = spec.get("servers", [])
    if servers:
        base_url = servers[0].get("url", "")

    lines = [
        f"API: {title} (v{version})",
        f"Base URL: {base_url}",
        f"Paths: {len(spec.get('paths', {}))} endpoints",
        ""
    ]

    # Parse paths
    for path, methods in spec.get("paths", {}).items():
        for method, details in methods.items():
            if method.upper() not in ("GET", "POST", "PUT", "DELETE", "PATCH"):
                continue
            summary = details.get("summary", details.get("description", "(no description)"))
            lines.append(f"  {method.upper()} {path}")
            lines.append(f"    Summary: {summary}")

            params = details.get("parameters", [])
            if params:
                lines.append(f"    Parameters:")
                for p in params:
                    required = "required" if p.get("required") else "optional"
                    lines.append(f"      - {p['name']} ({p.get('in','?')}): {p.get('type', p.get('schema',{}).get('type','?'))} [{required}]")

            # Request body
            req_body = details.get("requestBody")
            if req_body:
                content_type = next(iter(req_body.get("content", {})), None)
                lines.append(f"    Request Body: {content_type}")

            # Responses
            for status, resp in details.get("responses", {}).items():
                lines.append(f"    Response {status}: {resp.get('description', '')}")

            # Security
            security = details.get("security", [])
            if security:
                for sec in security:
                    lines.append(f"    Auth: {list(sec.keys())}")

            lines.append("")

    return "\n".join(lines)


@tool(
    name="parse_markdown",
    description="Parse a Markdown requirement document, preserving heading structure. Returns section titles and summaries.",
    parameters={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "Raw Markdown content"},
        },
        "required": ["content"],
    }
)
def parse_markdown(content: str) -> str:
    lines = content.split("\n")
    result = []
    current_section = ""
    section_lines = 0

    for line in lines:
        if line.startswith("#"):
            if current_section and section_lines > 0:
                result.append(f" ({section_lines} lines)")
            level = len(line.split()[0]) if line.split() else 1
            current_section = f"{'  ' * (level - 1)}{line.lstrip('#').strip()}"
            section_lines = 0
            result.append(current_section)
        elif current_section:
            section_lines += 1

    if current_section and section_lines > 0:
        result.append(f" ({section_lines} lines)")

    return "\n".join(result) if result else content[:5000]
