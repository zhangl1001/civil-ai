"""File operations skill — read, write, list, merge files with retry."""

import threading
import time
from agent.tool_registry import tool

PROJECT_ROOT = __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))

# Thread-local storage so concurrent experts don't share _last_output
_tls = threading.local()
_tls.last_output = ""

MAX_RETRIES = 3
RETRY_DELAY = 0.3


def set_last_output(text: str):
    _tls.last_output = text


@tool(
    name="read_file",
    description="Read file contents. Supports text files and images (PNG/JPG/GIF/WebP → base64 for vision).",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to the file to read"},
            "lines": {"type": "string", "description": "Line range to read. Examples: 'last_50' (last 50 lines), '10-20' (lines 10 to 20), 'first_100'. Omit to read entire file."},
            "tail_bytes": {"type": "integer", "description": "Read only the last N bytes of the file. Useful for appending to large files without reading them entirely. Mutually exclusive with 'lines'."},
        },
        "required": ["path"],
    }
)
def read_file(path: str, lines: str = None, tail_bytes: int = None) -> str:
    import os
    path = os.path.expanduser(path)
    if not path:
        return "Error: no path provided."
    if not os.path.exists(path):
        return f"Error: file not found: {path}"
    try:
        ext = os.path.splitext(path)[1].lower()
        if ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'):
            import base64
            mime_map = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'}
            with open(path, 'rb') as f:
                b64 = base64.b64encode(f.read()).decode()
            return f"[image:{mime_map.get(ext, 'image/png')};base64,{b64}]"

        # tail_bytes: read last N bytes efficiently
        if tail_bytes is not None:
            file_size = os.path.getsize(path)
            with open(path, 'rb') as f:
                if tail_bytes >= file_size:
                    f.seek(0)
                    raw = f.read()
                else:
                    f.seek(file_size - tail_bytes)
                    # Skip partial first line
                    f.readline()
                    raw = f.read()
            content = raw.decode('utf-8', errors='replace')
            return content

        # lines: read specific line range — iterate line-by-line, never load
        # entire file into memory
        if lines is not None:
            from collections import deque
            with open(path, 'r', encoding='utf-8') as f:
                if lines.startswith('last_'):
                    n = int(lines[5:])
                    buf = deque(maxlen=n)
                    total = 0
                    for line in f:
                        buf.append(line)
                        total += 1
                    selected = list(buf)
                elif lines.startswith('first_'):
                    n = int(lines[6:])
                    selected = []
                    total = 0
                    for line in f:
                        if total >= n:
                            break
                        selected.append(line)
                        total += 1
                elif '-' in lines:
                    parts = lines.split('-', 1)
                    start = max(0, int(parts[0]) - 1)  # 1-indexed
                    end = int(parts[1]) if parts[1] else None
                    selected = []
                    total = 0
                    for line in f:
                        if total < start:
                            total += 1
                            continue
                        if end is not None and total >= end:
                            break
                        selected.append(line)
                        total += 1
                else:
                    selected = []
                    total = 0
                    for line in f:
                        if total >= 50:
                            break
                        selected.append(line)
                        total += 1
            content = ''.join(selected)
            if not content:
                return f"(file has {total} lines, range returned nothing)"
            return content

        # Full file read — bounded to avoid loading huge files into memory
        MAX_READ = 64000  # read a bit more than 50000 to detect truncation
        with open(path, "r", encoding="utf-8") as f:
            content = f.read(MAX_READ)
        if len(content) >= MAX_READ - 100:  # likely truncated
            content = content[:50000] + "\n... (truncated at 50000 chars, use 'lines' or 'tail_bytes' parameter to read specific ranges)"
        elif len(content) > 50000:
            content = content[:50000] + "\n... (truncated at 50000 chars)"
        return content
    except Exception as e:
        return f"Error reading file: {e}"


@tool(
    name="write_file",
    description="Write content to a file. Creates parent directories automatically. Overwrites existing files by default.",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "File path to save"},
            "content": {"type": "string", "description": "Content to write. Can be omitted — uses your last text output."},
            "overwrite": {"type": "boolean", "description": "Set to false to prevent overwriting existing files. Default true."},
        },
        "required": ["path"],
    },
    category="output",
)
def write_file(path: str, content: str = "", overwrite: bool = True) -> str:
    import os
    path = os.path.expanduser(path)
    if not path:
        return "Error: no path provided."
    if not content:
        content = _tls.last_output
    if not content:
        return "Error: no content provided."

    # Create parent dirs (retry on transient errors)
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            break
        except OSError as e:
            if attempt >= MAX_RETRIES:
                return f"Error: cannot create directory for {path}: {e}"
            time.sleep(RETRY_DELAY)

    if not overwrite and os.path.exists(path) and os.path.getsize(path) > 0:
        return f"Error: file already exists ({os.path.getsize(path)} bytes): {path}. Set overwrite=true to replace, or use a different path."

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
            _tls.last_output = ""
            return f"File saved: {path} ({len(content)} chars, {content.count(chr(10))+1} lines)"
        except PermissionError:
            return f"Error: permission denied writing {path}\n\n建议：检查文件权限或换路径重试。"
        except OSError as e:
            last_error = str(e)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
                continue
            return f"Error writing file after {MAX_RETRIES} attempts: {last_error}\n\n建议：磁盘可能已满，请清理空间或用其他方式保存内容。"
        except Exception as e:
            return f"Error writing file: {e}"

    return f"Error writing file after {MAX_RETRIES} attempts: {last_error}"


@tool(
    name="list_files",
    description="List files in a directory.",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Directory path to list"},
            "recursive": {"type": "boolean", "description": "Whether to list files recursively in subdirectories. Default: false."},
            "pattern": {"type": "string", "description": "Filter files by glob pattern (e.g. '*.md', '*.json'). Applied after listing."},
        },
        "required": [],
    }
)
def list_files(path: str = ".", recursive: bool = False, pattern: str = None) -> str:
    import os, fnmatch
    path = os.path.expanduser(path)
    if not path:
        path = "."
    if not os.path.isdir(path):
        return f"Error: not a directory: {path}"
    try:
        if recursive:
            lines = []
            count = 0
            for root, dirs, files in os.walk(path):
                dirs.sort()
                for f in sorted(files):
                    if pattern and not fnmatch.fnmatch(f, pattern):
                        continue
                    rel = os.path.relpath(os.path.join(root, f), path)
                    lines.append(f"  {rel}")
                    count += 1
                    if count >= 100:
                        break
                if count >= 100:
                    break
            if count >= 100:
                lines.append(f"  ... (truncated)")
            return "\n".join(lines) if lines else "(empty)"
        else:
            files = sorted(os.listdir(path))
            if pattern:
                files = [f for f in files if fnmatch.fnmatch(f, pattern)]
            out = []
            for f in files:
                full = os.path.join(path, f)
                out.append(f"  {f}/" if os.path.isdir(full) else f"  {f}")
            if len(out) > 100:
                out = out[:100]
                out.append(f"  ... ({len(files)} total)")
            return "\n".join(out) if out else "(empty)"
    except Exception as e:
        return f"Error listing directory: {e}"


@tool(
    name="merge_case_files",
    description="Merge all JSONL files in cases dir into target, dedup by id. Cleans up temp files after merge.",
    parameters={
        "type": "object",
        "properties": {
            "target": {"type": "string", "description": "Target file path, e.g. projects/foo/cases/test_cases.jsonl"},
        },
        "required": ["target"],
    },
    category="output",
)
def merge_case_files(target: str) -> str:
    import json, os
    target = os.path.join(PROJECT_ROOT, target) if not os.path.isabs(target) else target
    cases_dir = os.path.dirname(target)
    target_name = os.path.basename(target)

    if not os.path.isdir(cases_dir):
        return f"Error: directory not found: {cases_dir}"

    all_jsonl = sorted([f for f in os.listdir(cases_dir) if f.endswith('.jsonl')])
    temp_files = [f for f in all_jsonl if f != target_name]

    seen: dict[str, dict] = {}
    read_order = ([target_name] if target_name in all_jsonl else []) + temp_files
    total_read = 0

    for fname in read_order:
        fpath = os.path.join(cases_dir, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        case = json.loads(line)
                        cid = case.get('id', '')
                        if cid and cid not in seen:
                            seen[cid] = case
                        total_read += 1
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            return f"Error reading {fname}: {e}"

    if not seen:
        return "No valid JSONL records found"

    sorted_ids = sorted(seen.keys())
    with open(target, 'w', encoding='utf-8') as fh:
        for cid in sorted_ids:
            fh.write(json.dumps(seen[cid], ensure_ascii=False) + '\n')

    removed = []
    for fname in temp_files:
        try:
            os.remove(os.path.join(cases_dir, fname))
            removed.append(fname)
        except Exception:
            pass

    return f"Merged {len(sorted_ids)} unique cases into {target_name}\nCleaned up: {', '.join(removed) if removed else 'none'}"
