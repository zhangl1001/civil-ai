"""Append content to an existing file. Opens in append mode — efficient for large files,
doesn't read the entire file into memory like cat >> or write_file+re-read."""

import os
from agent.tool_registry import tool


@tool(
    name="append_file",
    description="Append text to an existing file. Creates file if it doesn't exist. Efficient for large files and JSONL records.",
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute or relative path to the file to append to."
            },
            "content": {
                "type": "string",
                "description": "Content to append. Must include a leading newline if you want separation from existing content."
            },
        },
        "required": ["path", "content"],
    }
)
def append_file(path: str, content: str) -> str:
    """Append content to a file. Creates if doesn't exist."""
    if not os.path.isabs(path):
        path = os.path.join(os.getcwd(), path)

    try:
        with open(path, 'a', encoding='utf-8') as f:
            f.write(content)
        lines = content.count('\n')
        chars = len(content)
        return f"Appended {chars} chars ({lines} lines) to {path}"
    except Exception as e:
        return f"Failed to append to {path}: {e}"
