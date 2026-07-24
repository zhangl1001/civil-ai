"""Test execution tools - run tests and collect results."""

import json
import os
import subprocess
from agent.tool_registry import tool


@tool(
    name="run_pytest",
    description="Execute pytest tests and collect results. Specify test path and options.",
    parameters={
        "type": "object",
        "properties": {
            "test_path": {"type": "string", "description": "Path to test file or directory"},
            "options": {"type": "string", "description": "Additional pytest options (e.g. '-v -k test_login')"},
            "timeout_seconds": {"type": "integer", "description": "Max execution time in seconds (default 60)"},
        },
        "required": ["test_path"],
    }
)
def run_pytest(test_path: str, options: str = "-v", timeout_seconds: int = 60) -> str:
    if not os.path.exists(test_path):
        return f"Error: test path not found: {test_path}"

    cmd = ["pytest", test_path] + options.split()

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=os.getcwd(),
        )
        output = result.stdout + "\n" + result.stderr
        lines = output.split("\n")

        # Parse summary
        summary_line = ""
        for line in lines:
            if "passed" in line.lower() or "failed" in line.lower():
                summary_line = line
                break

        # Extract failure details
        failures = []
        in_failure = False
        failure_lines = []
        for line in lines:
            if "FAILURES" in line:
                in_failure = True
                continue
            if in_failure:
                if line.startswith("=") and "short test summary" in line.lower():
                    in_failure = False
                elif line.strip():
                    failure_lines.append(line.strip()[:200])
        failures = failure_lines[:30]

        return json.dumps({
            "exit_code": result.returncode,
            "summary": summary_line or "No summary found",
            "output_tail": "\n".join(lines[-20:]),
            "failures": failures,
        }, ensure_ascii=False, indent=2)

    except subprocess.TimeoutExpired:
        return f"Test execution timed out after {timeout_seconds}s"
    except FileNotFoundError:
        return "Error: pytest not found. Install with: pip install pytest"
    except Exception as e:
        return f"Error running tests: {e}"


@tool(
    name="run_newman",
    description="Execute Postman collections using Newman CLI. Requires newman installed (npm install -g newman).",
    parameters={
        "type": "object",
        "properties": {
            "collection_path": {"type": "string", "description": "Path to Postman collection JSON file"},
            "environment_path": {"type": "string", "description": "Path to environment JSON file (optional)"},
            "options": {"type": "string", "description": "Additional newman options (e.g. '--delay-request 100')"},
            "timeout_seconds": {"type": "integer", "description": "Max execution time in seconds (default 120)"},
        },
        "required": ["collection_path"],
    }
)
def run_newman(collection_path: str, environment_path: str = "", options: str = "", timeout_seconds: int = 120) -> str:
    if not os.path.exists(collection_path):
        return f"Error: collection not found: {collection_path}"

    cmd = ["newman", "run", collection_path]
    if environment_path:
        cmd.extend(["-e", environment_path])
    if options:
        cmd.extend(options.split())

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=os.getcwd(),
        )

        # Newman outputs summary in its stdout
        output = result.stdout + "\n" + result.stderr
        return json.dumps({
            "exit_code": result.returncode,
            "output": output[-3000:],  # Last 3000 chars
        }, ensure_ascii=False, indent=2)

    except subprocess.TimeoutExpired:
        return f"Newman execution timed out after {timeout_seconds}s"
    except FileNotFoundError:
        return "Error: newman not found. Install with: npm install -g newman"
    except Exception as e:
        return f"Error running newman: {e}"
