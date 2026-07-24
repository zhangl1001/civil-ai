"""Glob tool — fast file pattern matching. Like Claude Code's Glob."""

import glob as _glob
import os
from agent.tool_registry import tool


@tool(
    name="glob",
    description="Fast file search by glob patterns. Supports ** for recursive matching (e.g. 'src/**/*.ts'). Much faster than ls|grep for finding files by name. Use to discover file locations before reading them.",
    parameters={
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Glob pattern to match. Supports ** for recursive. Examples: '**/*.py', 'src/**/*.ts', '*.json'."
            },
            "path": {
                "type": "string",
                "description": "Base directory to search in. Default: current working directory."
            },
        },
        "required": ["pattern"],
    }
)
def glob_files(pattern: str, path: str = "") -> str:
    if not path:
        path = os.getcwd()

    if not os.path.isdir(path):
        return f"Error: not a directory: {path}"

    full_pattern = os.path.join(path, pattern)
    try:
        matches = sorted(_glob.glob(full_pattern, recursive=True))
    except Exception as e:
        return f"Error matching glob: {e}"

    if not matches:
        return f"No files matching '{pattern}' in {path}"

    # Show relative paths from the search base
    lines = []
    shown = 0
    for f in matches:
        rel = os.path.relpath(f, path)
        is_dir = os.path.isdir(f)
        lines.append(f"  {rel}{'/' if is_dir else ''}")
        shown += 1
        if shown >= 200:
            lines.append(f"  ... ({len(matches)} total, showing first 200)")
            break

    return "\n".join(lines)
