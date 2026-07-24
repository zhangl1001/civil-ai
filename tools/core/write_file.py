"""Core write_file tool — always visible, never auto-unloaded."""

from agent.tool_registry import tool
from skills.core.file_ops.tools import write_file as _impl


@tool(
    name="write_file",
    description="Write content to a file. Creates parent directories automatically. Overwrites existing files. For appending to existing files, use append_file.",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to the file to write"},
            "content": {"type": "string", "description": "Content to write to the file"},
        },
        "required": ["path", "content"],
    }
)
def write_file(path: str, content: str) -> str:
    return _impl(path, content)
