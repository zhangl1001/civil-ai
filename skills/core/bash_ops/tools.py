"""Bash shell command skill — run shell commands for exploration."""

import os
import subprocess
import time

from agent.tool_registry import tool


@tool(
    name="run_bash",
    description="Run shell commands for exploration or as fallback. Read-only: ls, wc, head, tail, git log, python3 -c pipelines for JSON analysis. For file search, use Grep (regex) or Glob (pattern) instead — they are faster and safer. For reading files, use read_file first.",
    parameters={
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Shell command to execute."},
            "description": {"type": "string", "description": "Short description of what this command does."},
            "timeout_seconds": {"type": "integer", "description": "Max execution time in seconds (default 60)."},
            "cwd": {"type": "string", "description": "Working directory. Defaults to project root."},
        },
        "required": ["command"],
    }
)
def run_bash(command: str, description: str = "", timeout_seconds: int = 60, cwd: str = "") -> str:
    dangerous = ["rm -rf /", "mkfs.", "dd if=", "> /dev/sda", ":(){ :|:& };:"]
    cmd_lower = command.lower().replace(" ", "")
    for pattern in dangerous:
        if pattern.replace(" ", "") in cmd_lower:
            return f"Blocked dangerous command pattern: {pattern}."

    if not cwd:
        cwd = os.getcwd()
    if not os.path.isdir(cwd):
        cwd = os.getcwd()

    start = time.time()
    timeout = min(timeout_seconds, 300)

    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True,
            timeout=timeout, cwd=cwd, env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        elapsed = time.time() - start
        lines = []
        if description:
            lines.append(f"$ {description}")
        else:
            lines.append(f"$ {command[:120]}")

        MAX_OUT = 2000
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        if stdout:
            total = len(stdout)
            if total > MAX_OUT:
                out = stdout[:MAX_OUT]
                lines.append(out)
                lines.append(f"[stdout truncated: {total} chars → {len(out)} shown. Use grep/head/tail in command to narrow output.]")
            else:
                lines.append(stdout)
        if stderr:
            lines.append(f"[stderr] {stderr[-300:] if len(stderr) > 300 else stderr}")
        lines.append(f"[exit {result.returncode} | {elapsed:.1f}s]")
        if result.returncode != 0:
            lines.insert(0, f"Command failed (exit {result.returncode}). Review stderr and adjust.")
        return "\n".join(lines)
    except subprocess.TimeoutExpired:
        return f"Command timed out after {timeout}s."
    except Exception as e:
        return f"Error running command: {e}"
