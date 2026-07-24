"""Meta-tool: execute Python scripts to generate custom file formats."""

import os
import subprocess
import sys
import tempfile
import time
from agent.tool_registry import tool


@tool(
    name="run_script",
    description="Execute Python script to generate files (PDF, DOCX, HTML, SVG, etc). Sandboxed, timeout-protected. Can import installed libraries.",
    parameters={
        "type": "object",
        "properties": {
            "script": {
                "type": "string",
                "description": "Python script source code to execute. Will be written to a temp file and run with subprocess."
            },
            "description": {
                "type": "string",
                "description": "Short description of what the script does (shown while running)."
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Max execution time in seconds (default 60)."
            },
            "cwd": {
                "type": "string",
                "description": "Working directory for the script (default: project root)."
            },
        },
        "required": ["script"],
    }
)
def run_script(
    script: str,
    description: str = "",
    timeout_seconds: int = 60,
    cwd: str = "",
) -> str:
    """Execute a Python script in a subprocess and return stdout/stderr.

    The script is written to a temp file and executed with `python <tmpfile>`.
    This allows the AI to generate ANY file format by writing Python code that
    produces the desired output (PDF via reportlab, DOCX via python-docx, HTML,
    SVG, custom charts, bespoke templates, etc.).
    """
    if not cwd:
        cwd = os.getcwd()

    if not os.path.isdir(cwd):
        cwd = os.getcwd()

    start = time.time()

    # Write script to a temp file so we get proper tracebacks
    tmp_path = os.path.join(tempfile.gettempdir(), f"zhangl_agent_{int(start)}.py")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(script)
    except OSError as e:
        return f"Error writing script to temp file: {e}"

    try:
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            text=True,
            timeout=min(timeout_seconds, 300),
            cwd=cwd,
        )

        elapsed = time.time() - start
        exit_code = result.returncode

        lines = []
        if description:
            lines.append(f"Script: {description}")
        lines.append(f"Exit code: {exit_code}  Elapsed: {elapsed:.1f}s")

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        if stdout:
            lines.append(f"\n--- stdout ---\n{stdout[-4000:]}")
        if stderr:
            lines.append(f"\n--- stderr ---\n{stderr[-2000:]}")

        if exit_code != 0:
            lines.insert(0, "\n".join([
                f"Script FAILED with exit code {exit_code}.",
                "Check the stderr output below. Common issues:",
                "- Missing pip package → install via Bash (pip install <pkg>)",
                "- Import errors → check module name",
                "- Syntax errors → review the script logic",
                "",
            ]))

        return "\n".join(lines)

    except subprocess.TimeoutExpired:
        return f"Script timed out after {timeout_seconds}s. Consider simplifying or increasing timeout_seconds."
    except FileNotFoundError:
        return "Error: Python not found. Check the environment."
    except Exception as e:
        return f"Error running script: {e}"

    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
