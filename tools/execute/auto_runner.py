"""
Auto test runner — detects test framework, finds tests, executes, parses results.
Framework-agnostic design: each language/ecosystem gets its own detector.
"""

import json
import os
import re
import subprocess
from agent.tool_registry import tool

# ── Framework detection ──────────────────────────────────

def _detect_framework(project_dir: str) -> dict:
    """Detect the test framework used by a project.

    Returns {"framework": str, "language": str, "test_paths": [str], "command": str}
    or {"framework": "unknown", "reason": str}.
    """
    files = set()
    for root, dirs, fnames in os.walk(project_dir):
        # Skip venv, node_modules, .git
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "venv", ".venv", "__pycache__", ".pytest_cache")]
        for f in fnames:
            files.add(f)

    # Python: pytest
    py_test_files = [f for f in files if (f.startswith("test_") or f.endswith("_test.py")) and f.endswith(".py")]
    if py_test_files:
        return _pytest_config(project_dir, files)
    if "pytest.ini" in files or "pyproject.toml" in files or "setup.cfg" in files:
        return _pytest_config(project_dir, files)

    # Node.js
    if "package.json" in files:
        return _node_config(project_dir, files)

    # Go
    if any(f.endswith("_test.go") for f in files):
        return _go_config(project_dir)

    # Java/Maven
    if "pom.xml" in files:
        return _maven_config(project_dir, files)
    if "build.gradle" in files or "build.gradle.kts" in files:
        return _gradle_config(project_dir, files)

    return {"framework": "unknown", "language": "unknown",
            "reason": "No recognizable test framework found. Supported: pytest, jest, go test, maven, gradle"}


def _pytest_config(project_dir: str, files: set[str]) -> dict:
    """Build pytest config."""
    # Find test paths
    test_paths = []
    for root, dirs, fnames in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "venv", ".venv", "__pycache__", ".pytest_cache")]
        for f in fnames:
            if f.startswith("test_") or f.endswith("_test.py"):
                rel = os.path.relpath(os.path.join(root, f), project_dir)
                test_paths.append(rel)
    # Prefer test dirs
    test_dirs = []
    for tp in test_paths:
        d = os.path.dirname(tp)
        if d and d not in test_dirs:
            test_dirs.append(d)
    return {
        "framework": "pytest",
        "language": "python",
        "test_paths": test_paths[:50],
        "test_dirs": test_dirs[:10],
        "command": "pytest",
        "args": ["-v", "--tb=short"],
    }


def _node_config(project_dir: str, files: set[str]) -> dict:
    """Detect Node.js test framework from package.json."""
    pkg_path = os.path.join(project_dir, "package.json")
    try:
        with open(pkg_path) as f:
            pkg = json.load(f)
    except Exception:
        return {"framework": "unknown", "reason": "Cannot read package.json"}

    scripts = pkg.get("scripts", {})
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}

    # Jest
    if "jest" in deps or "jest" in scripts.get("test", ""):
        test_paths = _find_test_files(project_dir, [".test.js", ".test.ts", ".test.jsx", ".test.tsx", ".spec.js", ".spec.ts"])
        return {
            "framework": "jest",
            "language": "javascript",
            "test_paths": test_paths[:50],
            "command": "npx",
            "args": ["jest", "--verbose"],
        }

    # Mocha
    if "mocha" in deps:
        test_paths = _find_test_files(project_dir, [".test.js", ".spec.js"])
        return {
            "framework": "mocha",
            "language": "javascript",
            "test_paths": test_paths[:50],
            "command": "npx",
            "args": ["mocha", "--reporter", "spec"],
        }

    # Generic npm test
    if "test" in scripts:
        return {
            "framework": "npm",
            "language": "javascript",
            "test_paths": [],
            "command": "npm",
            "args": ["test"],
        }

    return {"framework": "unknown", "reason": "No test script or framework found in package.json"}


def _go_config(project_dir: str) -> dict:
    test_paths = _find_test_files(project_dir, ["_test.go"])
    return {
        "framework": "go test",
        "language": "go",
        "test_paths": test_paths[:50],
        "command": "go",
        "args": ["test", "-v", "./..."],
    }


def _maven_config(project_dir: str, files: set[str]) -> dict:
    return {
        "framework": "maven",
        "language": "java",
        "test_paths": _find_test_files(project_dir, ["Test.java", "Tests.java"]),
        "command": "mvn",
        "args": ["test"],
    }


def _gradle_config(project_dir: str, files: set[str]) -> dict:
    return {
        "framework": "gradle",
        "language": "java",
        "test_paths": _find_test_files(project_dir, ["Test.java", "Tests.java"]),
        "command": "./gradlew" if os.path.exists(os.path.join(project_dir, "gradlew")) else "gradle",
        "args": ["test"],
    }


def _find_test_files(project_dir: str, suffixes: list[str]) -> list[str]:
    """Find test files matching given suffixes."""
    found = []
    for root, dirs, fnames in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "venv", ".venv", "__pycache__")]
        for f in fnames:
            if any(f.endswith(s) for s in suffixes):
                found.append(os.path.relpath(os.path.join(root, f), project_dir))
    return found


# ── Result parsing ───────────────────────────────────────

def _parse_pytest_output(stdout: str, stderr: str) -> dict:
    """Parse pytest output into structured results."""
    combined = stdout + "\n" + stderr
    lines = combined.split("\n")

    passed = failed = skipped = 0
    failures = []
    duration = ""

    # Parse summary line
    for line in lines:
        if "passed" in line and ("failed" in line or "skipped" in line or "error" in line):
            m = re.search(r'(\d+)\s+passed', line)
            passed = int(m.group(1)) if m else 0
            m = re.search(r'(\d+)\s+failed', line)
            failed = int(m.group(1)) if m else 0
            m = re.search(r'(\d+)\s+skipped', line)
            skipped = int(m.group(1)) if m else 0
            continue
        dur_match = re.search(r'=+.*in\s+([\d.]+)s', line)
        if dur_match:
            duration = f"{dur_match.group(1)}s"

    # Extract failure details
    in_failures = False
    current_failure = ""
    for line in lines:
        if re.match(r'^=+\s*FAILURES\s*=+', line):
            in_failures = True
            continue
        if in_failures:
            if re.match(r'^=+', line):
                if current_failure.strip():
                    failures.append(_summarize_failure(current_failure))
                in_failures = False
                current_failure = ""
                continue
            current_failure += line + "\n"
    if current_failure.strip():
        failures.append(_summarize_failure(current_failure))

    return {
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "total": passed + failed + skipped,
        "pass_rate": round(passed / max(passed + failed + skipped, 1) * 100),
        "duration": duration,
        "failures": failures[:20],
    }


def _parse_generic_output(stdout: str, stderr: str) -> dict:
    """Generic output parser — extracts exit code and last lines."""
    combined = (stdout + "\n" + stderr).strip()
    lines = combined.split("\n")

    # Try to find pass/fail counts
    passed = failed = skipped = 0
    for line in lines:
        m = re.search(r'(\d+)\s+pass(?:ed)?', line, re.IGNORECASE)
        if m: passed = int(m.group(1))
        m = re.search(r'(\d+)\s+fail(?:ed)?', line, re.IGNORECASE)
        if m: failed = int(m.group(1))
        m = re.search(r'(\d+)\s+skip(?:ped)?', line, re.IGNORECASE)
        if m: skipped = int(m.group(1))

    return {
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "total": passed + failed + skipped,
        "pass_rate": round(passed / max(passed + failed + skipped, 1) * 100) if (passed + failed + skipped) else 0,
        "output_tail": "\n".join(lines[-30:]),
    }


def _summarize_failure(failure_text: str) -> str:
    """Extract key info from failure text (first 300 chars)."""
    lines = [l.strip() for l in failure_text.split("\n") if l.strip()]
    # Find the assertion error line
    for line in lines:
        if "AssertionError" in line or "assert" in line.lower():
            return line[:300]
    # Fallback: first meaningful line
    for line in lines:
        if len(line) > 10 and not line.startswith("_"):
            return line[:300]
    return lines[0][:300] if lines else failure_text[:300]


# ── Main tool ────────────────────────────────────────────

@tool(
    name="detect_and_run_tests",
    description="Auto-detect test framework (pytest/jest/go test/maven/gradle), find test files, run them, and return structured results (pass/fail/skip counts, failures, execution time).",
    parameters={
        "type": "object",
        "properties": {
            "project_dir": {
                "type": "string",
                "description": "Absolute path to the project directory"
            },
            "project_name": {
                "type": "string",
                "description": "Project name for display/report purposes"
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Max execution time in seconds (default 120)"
            },
        },
        "required": ["project_dir"],
    }
)
def detect_and_run_tests(project_dir: str, project_name: str = "", timeout_seconds: int = 120) -> str:
    if not os.path.isdir(project_dir):
        return json.dumps({"error": f"Directory not found: {project_dir}"}, ensure_ascii=False)

    # 1. Detect framework
    config = _detect_framework(project_dir)

    if config["framework"] == "unknown":
        return json.dumps({
            "status": "no_framework",
            **config,
        }, ensure_ascii=False, indent=2)

    # 2. Build command
    cmd = [config["command"]] + config.get("args", [])
    cmd_str = " ".join(cmd)

    # 3. Execute
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=project_dir,
        )
    except subprocess.TimeoutExpired:
        return json.dumps({
            "status": "timeout",
            "framework": config["framework"],
            "command": cmd_str,
            "error": f"Test execution timed out after {timeout_seconds}s",
        }, ensure_ascii=False, indent=2)
    except FileNotFoundError:
        return json.dumps({
            "status": "tool_missing",
            "framework": config["framework"],
            "command": cmd_str,
            "error": f"'{config['command']}' not found. Install the test framework first.",
        }, ensure_ascii=False, indent=2)

    # 4. Parse results
    if config["framework"] == "pytest":
        parsed = _parse_pytest_output(result.stdout, result.stderr)
    else:
        parsed = _parse_generic_output(result.stdout, result.stderr)

    return json.dumps({
        "status": "completed",
        "project": project_name or os.path.basename(project_dir),
        "framework": config["framework"],
        "language": config["language"],
        "command": cmd_str,
        "exit_code": result.returncode,
        "test_files_found": len(config.get("test_paths", [])),
        **parsed,
    }, ensure_ascii=False, indent=2)
