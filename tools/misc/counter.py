"""Demo tool - no boilerplate, just a decorated function in the right directory."""

from agent.tool_registry import tool


@tool(
    name="count_chars",
    description="Count characters, words, and lines in a text string.",
    parameters={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Text to analyze"},
        },
        "required": ["text"],
    }
)
def count_chars(text: str) -> str:
    chars = len(text)
    words = len(text.split())
    lines = text.count("\n") + 1
    return f"Characters: {chars}, Words: {words}, Lines: {lines}"
