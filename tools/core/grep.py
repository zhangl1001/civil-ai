"""Grep tool — content search with regex. Like Claude Code's Grep (backed by ripgrep)."""

import os
import re
from agent.tool_registry import tool


@tool(
    name="grep",
    description="Search file contents using regex patterns. Supports full regex syntax. Filter by glob pattern. Much faster and more precise than running grep via bash — more complete results, automatic dedup, safe handling of large outputs.",
    parameters={
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Regular expression pattern to search for. Example: 'function\\s+\\w+' or 'TODO|FIXME'."
            },
            "path": {
                "type": "string",
                "description": "File or directory to search in. Default: current working directory."
            },
            "glob": {
                "type": "string",
                "description": "Filter files by glob pattern. Example: '*.py', '**/*.{ts,tsx}'. Applied before searching."
            },
            "output_mode": {
                "type": "string",
                "description": "Output mode: 'content' shows matching lines, 'files_with_matches' shows file paths, 'count' shows match counts. Default: 'files_with_matches'."
            },
            "-i": {
                "type": "boolean",
                "description": "Case insensitive search. Default: false."
            },
            "head_limit": {
                "type": "integer",
                "description": "Limit output lines to first N. Default: 200."
            },
        },
        "required": ["pattern"],
    }
)
def grep(
    pattern: str,
    path: str = "",
    glob: str = None,
    output_mode: str = "files_with_matches",
    case_insensitive: bool = False,
    head_limit: int = 200,
) -> str:
    if not path:
        path = os.getcwd()

    if not os.path.exists(path):
        return f"Error: path not found: {path}"

    flags = re.IGNORECASE if case_insensitive else 0
    try:
        regex = re.compile(pattern, flags)
    except re.error as e:
        return f"Error compiling regex '{pattern}': {e}"

    # Build file list
    if os.path.isfile(path):
        files = [path]
    else:
        import fnmatch as _fnmatch
        files = []
        try:
            for root, dirs, filenames in os.walk(path):
                # Skip hidden dirs and common noise
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('__pycache__', 'node_modules', '.git')]
                for fname in filenames:
                    if fname.startswith('.'):
                        continue
                    full = os.path.join(root, fname)
                    if glob and not _fnmatch.fnmatch(full, f"*{glob.lstrip('*')}"):
                        # Simple glob matching — re-check with pathlib
                        from pathlib import Path
                        try:
                            rel = os.path.relpath(full, path)
                            if not Path(rel).match(glob):
                                continue
                        except Exception:
                            pass
                    files.append(full)
        except Exception as e:
            return f"Error walking directory: {e}"

    if not files:
        return f"No files to search (path={path}, glob={glob or 'none'})"

    # Search
    file_matches = {}  # file -> list of (line_num, line_text)
    total_matches = 0
    for fpath in sorted(files):
        try:
            with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                for i, line in enumerate(f, 1):
                    m = regex.search(line)
                    if m:
                        if fpath not in file_matches:
                            file_matches[fpath] = []
                        file_matches[fpath].append((i, line.rstrip('\n\r')))
                        total_matches += 1
                        if output_mode == 'content' and total_matches >= head_limit * 2:
                            break  # stop searching this file
        except Exception:
            pass
        if output_mode == 'content' and total_matches >= head_limit * 2:
            break

    if not file_matches:
        return f"No matches for '{pattern}' ({'case insensitive' if case_insensitive else 'case sensitive'})"

    if output_mode == 'count':
        lines = []
        for fpath, ms in sorted(file_matches.items(), key=lambda x: -len(x[1])):
            rel = os.path.relpath(fpath, path)
            lines.append(f"  {len(ms):4d}  {rel}")
        return f"{len(file_matches)} files, {total_matches} matches:\n" + "\n".join(lines)

    elif output_mode == 'files_with_matches':
        lines = []
        for fpath in sorted(file_matches.keys()):
            rel = os.path.relpath(fpath, path)
            lines.append(f"  {rel}")
        return f"{len(file_matches)} files match:\n" + "\n".join(lines)

    else:  # content
        lines = []
        shown = 0
        for fpath in sorted(file_matches.keys()):
            rel = os.path.relpath(fpath, path)
            ms = file_matches[fpath]
            # Only show each file header if there's content to show
            file_lines = []
            for lnum, ltext in ms:
                file_lines.append(f"  {lnum}: {ltext}")
                shown += 1
                if shown >= head_limit:
                    break
            lines.append(f"{rel}:")
            lines.extend(file_lines)
            if shown >= head_limit:
                lines.append(f"... (truncated, {total_matches} total matches)")
                break

        return "\n".join(lines)
