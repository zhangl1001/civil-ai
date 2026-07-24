"""Escape hatch: execute arbitrary shell commands when other tools fail."""

import os
import subprocess
import time
from agent.tool_registry import tool


@tool(
    name="run_bash",
    description="Run shell commands. For file search use Grep/Glob instead. NEVER for destructive ops. Working dir is project root.",
    parameters={
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Shell command to execute. Can use pipes, redirects, && chaining."
            },
            "description": {
                "type": "string",
                "description": "Short description of what this command does (shown while running)."
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Max execution time in seconds (default 60)."
            },
            "cwd": {
                "type": "string",
                "description": "Working directory. Defaults to project root."
            },
        },
        "required": ["command"],
    }
)
def run_bash(
    command: str,
    description: str = "",
    timeout_seconds: int = 60,
    cwd: str = "",
) -> str:
    """Execute a shell command and return stdout/stderr.

    This is the ultimate escape hatch — read-only only:
    1. Explore filesystem (ls, find, grep, head, wc)
    2. Check environment (which, env, pwd, git log)
    3. Install packages (pip install)
    For reading file contents, ALWAYS use read_file tool instead of cat/python3 -c.
    """
    # Security: block obviously destructive patterns
    dangerous = ["rm -rf /", "mkfs.", "dd if=", "> /dev/sda", ":(){ :|:& };:"]
    cmd_lower = command.lower().replace(" ", "")
    for pattern in dangerous:
        if pattern.replace(" ", "") in cmd_lower:
            return f"Blocked dangerous command pattern: {pattern}. Use safer alternatives."

    if not cwd:
        cwd = os.getcwd()
    if not os.path.isdir(cwd):
        cwd = os.getcwd()

    start = time.time()
    timeout = min(timeout_seconds, 300)

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )

        elapsed = time.time() - start
        exit_code = result.returncode

        lines = []
        if description:
            lines.append(f"$ {description}")
        else:
            lines.append(f"$ {command[:120]}")

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        # Bash output is ephemeral — cap aggressively to avoid context bloat
        MAX_OUT = 2000
        if stdout:
            total = len(stdout)
            if total > MAX_OUT:
                out = stdout[:MAX_OUT]
                lines.append(out)
                lines.append(f"[stdout truncated: {total} chars → {len(out)} shown. Use grep/head/tail in command to narrow output.]")
            else:
                lines.append(stdout)
        if stderr:
            err = stderr[-300:] if len(stderr) > 300 else stderr
            lines.append(f"[stderr] {err}")

        lines.append(f"[exit {exit_code} | {elapsed:.1f}s]")

        if exit_code != 0:
            lines.insert(0, f"Command failed (exit {exit_code}). Review stderr and adjust.")

        return "\n".join(lines)

    except subprocess.TimeoutExpired:
        return f"Command timed out after {timeout}s. Try reducing scope or increasing timeout_seconds."
    except Exception as e:
        return f"Error running command: {e}"
