"""Edit tool — fuzzy-tolerant string replacement with retry. Model-agnostic: handles whitespace variations automatically."""

import os
import re
import time
from agent.tool_registry import tool

MAX_RETRIES = 3
RETRY_DELAY = 0.3  # seconds between retries


def _normalize(s: str) -> str:
    """Strip trailing whitespace from each line for fuzzy matching."""
    return '\n'.join(line.rstrip() for line in s.split('\n'))


def _normalize_aggressive(s: str) -> str:
    """Strip ALL trailing whitespace AND collapse multiple spaces. Last-resort matching."""
    return '\n'.join(
        re.sub(r'[ \t]+', ' ', line.rstrip())
        for line in s.split('\n')
    )


def _find_fuzzy(text: str, pattern: str, aggressive: bool = False) -> tuple[int, int] | None:
    """Try exact match first, then line-trailing-whitespace tolerant match, then aggressive."""
    # 1. Exact match
    idx = text.find(pattern)
    if idx >= 0:
        return idx, idx + len(pattern)

    # 2. Line-trailing-whitespace tolerant: normalize both
    if '\n' in pattern:
        norm_text = _normalize(text)
        norm_pattern = _normalize(pattern)
        idx = norm_text.find(norm_pattern)
        if idx >= 0:
            result = _map_back(text, norm_text, norm_pattern, idx)
            if result:
                return result

        # 3. Aggressive: collapse spaces too (last resort)
        if aggressive:
            norm_text = _normalize_aggressive(text)
            norm_pattern = _normalize_aggressive(pattern)
            idx = norm_text.find(norm_pattern)
            if idx >= 0:
                result = _map_back(text, norm_text, norm_pattern, idx)
                if result:
                    return result

    return None


def _map_back(text: str, norm_text: str, norm_pattern: str, norm_idx: int) -> tuple[int, int] | None:
    """Map normalized-match positions back to original text positions."""
    try:
        pre_newlines = norm_text[:norm_idx].count('\n')
        orig_before = 0
        for _ in range(pre_newlines):
            orig_before = text.index('\n', orig_before) + 1

        lines = norm_pattern.split('\n')
        end_pos = orig_before
        for li, line in enumerate(lines):
            line_end = text.index('\n', end_pos) if li < len(lines) - 1 else len(text)
            actual_line = text[end_pos:line_end]
            if actual_line.rstrip() != line.rstrip():
                return None
            end_pos = line_end + 1 if li < len(lines) - 1 else end_pos + len(actual_line)
        return orig_before, end_pos
    except (ValueError, IndexError):
        return None


@tool(
    name="edit",
    description="Edit file contents with string replacement. Tolerates trailing whitespace differences. Finds old_string in the file and replaces it with new_string. Use replace_all to replace every occurrence, otherwise old_string must be unique.",
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute or relative path to the file to edit."
            },
            "old_string": {
                "type": "string",
                "description": "Text to find and replace. Trailing whitespace on each line is ignored during matching."
            },
            "new_string": {
                "type": "string",
                "description": "Replacement text. Must be different from old_string."
            },
            "replace_all": {
                "type": "boolean",
                "description": "Replace all occurrences of old_string (default false). Set to true for renaming variables globally."
            },
        },
        "required": ["path", "old_string", "new_string"],
    }
)
def edit(path: str, old_string: str, new_string: str, replace_all: bool = False) -> str:
    if old_string == new_string:
        return "Error: old_string and new_string are identical — nothing to change."

    if not os.path.isabs(path):
        path = os.path.join(os.getcwd(), path)

    if not os.path.exists(path):
        return f"Error: file not found: {path}"

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
        except UnicodeDecodeError:
            return f"Error: cannot read {path} — file is binary or has unsupported encoding."
        except Exception as e:
            last_error = f"Error reading file: {e}"
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
                continue
            return last_error

        # Try fuzzy match — use aggressive mode on retry
        use_aggressive = (attempt >= 2)
        match = _find_fuzzy(content, old_string, aggressive=use_aggressive)
        if match is None:
            first_line = old_string.split('\n')[0].rstrip()[:60]
            hint = ""
            if first_line and first_line in content:
                pos = content.find(first_line)
                ctx_start = max(0, pos - 10)
                ctx_end = min(len(content), pos + len(first_line) + 60)
                hint = f"\nHint: found \"{first_line}\" at offset {pos}. Surrounding:\n  ...{repr(content[ctx_start:ctx_end])}..."
            last_error = f"Error: old_string not found in {path} (attempt {attempt}/{MAX_RETRIES}).{hint}"
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
                continue
            return last_error + "\n\n建议：文件可能已被修改，请用 read_file 重新读取目标内容，确认后重试 edit。也可用 write_file 重写整个文件。"

        start, end = match

        if not replace_all:
            other_match = _find_fuzzy(content[end:], old_string, aggressive=use_aggressive)
            if other_match is not None:
                return f"Error: old_string appears multiple times in {path}. Use replace_all=true to replace all, or provide more surrounding context to make it unique."

        try:
            if replace_all:
                new_content = content.replace(old_string, new_string)
            else:
                new_content = content[:start] + new_string + content[end:]

            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(new_content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
            what = f"all occurrences" if replace_all else "1 occurrence"
            return f"Replaced {what} in {path} (offset {start})"
        except PermissionError:
            return f"Error: permission denied writing {path}"
        except OSError as e:
            last_error = f"Error writing file (attempt {attempt}/{MAX_RETRIES}): {e}"
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
                continue
            return last_error + "\n\n建议：磁盘可能已满或文件被锁定，请用 write_file 换路径重试。"
        except Exception as e:
            return f"Error writing file: {e}"

    return last_error or "Error: unknown"
