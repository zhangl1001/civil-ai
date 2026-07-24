"""Core read_file tool — always visible, never auto-unloaded."""

from agent.tool_registry import tool
from skills.core.file_ops.tools import read_file as _impl


@tool(
    name="read_file",
    description="Read file contents. Supports text files (with line range) and images (PNG/JPG/GIF/WebP → base64 for vision). For searching file contents by pattern, use Grep. For finding files by name pattern, use Glob.",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to the file to read"},
            "lines": {"type": "string", "description": "Line range. 'last_50' (last 50 lines), '10-20' (lines 10-20), 'first_100'. Omit for entire file."},
            "tail_bytes": {"type": "integer", "description": "Read last N bytes only. For appending to large files without full read."},
        },
        "required": ["path"],
    }
)
def read_file(path: str, lines: str = None, tail_bytes: int = None) -> str:
    return _impl(path, lines, tail_bytes)
