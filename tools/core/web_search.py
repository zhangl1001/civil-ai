"""Web search tool — search the internet using DuckDuckGo (free, no API key needed)."""

from agent.tool_registry import tool


@tool(
    name="web_search",
    description="Search the web using DuckDuckGo. Returns title, URL, and snippet for each result. Use for finding current news, documentation, facts, or any information not in your training data. Free, no API key required.",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query string. Be specific — include keywords, dates, or site restrictions for better results."
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results to return (default 5, max 10)."
            },
        },
        "required": ["query"],
    }
)
def web_search(query: str, max_results: int = 5) -> str:
    try:
        from ddgs import DDGS
    except ImportError:
        return "Error: ddgs package not installed. Run: pip install ddgs"

    max_results = min(max_results, 10)

    try:
        results = list(DDGS().text(query, max_results=max_results))
    except Exception as e:
        return f"Search failed: {e}"

    if not results:
        return f"No results found for: {query}"

    lines = [f"Search results for: {query}\n"]
    for i, r in enumerate(results, 1):
        title = r.get('title', '')
        href = r.get('href', '')
        body = r.get('body', '')
        lines.append(f"{i}. {title}")
        lines.append(f"   {href}")
        lines.append(f"   {body}\n")

    return "\n".join(lines)
