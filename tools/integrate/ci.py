"""CI/CD integration tools - generate and parse CI configurations."""

import json
from agent.tool_registry import tool


@tool(
    name="ci_generate_config",
    description="Generate CI/CD pipeline configuration for running tests. Supports GitHub Actions, GitLab CI, and generic shell script.",
    parameters={
        "type": "object",
        "properties": {
            "platform": {"type": "string", "enum": ["github", "gitlab", "shell"], "description": "CI/CD platform"},
            "test_command": {"type": "string", "description": "Command to run tests (e.g. 'pytest tests/' or 'npm test')"},
            "python_version": {"type": "string", "description": "Python version (for Python projects)"},
            "output_dir": {"type": "string", "description": "Output directory for config files"},
        },
        "required": ["platform", "test_command"],
    }
)
def ci_generate_config(
    platform: str = "github",
    test_command: str = "pytest tests/",
    python_version: str = "3.11",
    output_dir: str = "",
) -> str:
    config = ""

    if platform == "github":
        config = f"""name: Test Pipeline
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '{python_version}'
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Run tests
        run: {test_command}
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: test-results/
"""

    elif platform == "gitlab":
        config = f"""stages:
  - test

test:
  stage: test
  image: python:{python_version}
  before_script:
    - pip install -r requirements.txt
  script:
    - {test_command}
  artifacts:
    when: always
    paths:
      - test-results/
    reports:
      junit: test-results/*.xml
"""

    elif platform == "shell":
        config = f"""#!/bin/bash
# Auto-generated test runner
set -e
echo "Installing dependencies..."
pip install -r requirements.txt
echo "Running tests..."
{test_command}
echo "Done. Exit code: $?"
"""

    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        ext = {"github": ".yml", "gitlab": ".yml", "shell": ".sh"}[platform]
        fname = {"github": "test-pipeline", "gitlab": ".gitlab-ci", "shell": "run-tests"}[platform]
        path = os.path.join(output_dir, fname + ext)
        with open(path, "w", encoding="utf-8") as f:
            f.write(config)
        return f"Generated {platform} CI config at {path}"

    return f"```yaml\n{config}\n```"


@tool(
    name="ci_parse_result",
    description="Parse CI test result output (JUnit XML or plain text) and extract pass/fail summary.",
    parameters={
        "type": "object",
        "properties": {
            "result_text": {"type": "string", "description": "Test result output (JUnit XML or pytest output)"},
        },
        "required": ["result_text"],
    }
)
def ci_parse_result(result_text: str) -> str:
    # Try JUnit XML first
    if result_text.strip().startswith("<?xml") or "<testsuite" in result_text:
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(result_text)
            total = int(root.get("tests", 0))
            failures = int(root.get("failures", 0))
            errors = int(root.get("errors", 0))
            skipped = int(root.get("skipped", 0))
            passed = total - failures - errors - skipped

            cases = []
            for tc in root.iter("testcase"):
                failure = tc.find("failure")
                error = tc.find("error")
                skipped_el = tc.find("skipped")
                status = "skipped" if skipped_el is not None else ("failed" if failure is not None else ("error" if error is not None else "passed"))
                if status != "passed":
                    cases.append({"name": tc.get("name", ""), "classname": tc.get("classname", ""), "status": status, "message": (failure.text or error.text or "")[:200] if (failure is not None or error is not None) else ""})

            return json.dumps({
                "format": "junit_xml",
                "total": total, "passed": passed, "failed": failures, "errors": errors, "skipped": skipped,
                "pass_rate": round(passed / max(total, 1) * 100),
                "failures": cases[:30],
            }, ensure_ascii=False, indent=2)
        except Exception as e:
            pass  # Fall through to text parsing

    # Parse pytest-style output
    lines = result_text.split("\n")
    total = 0
    passed = 0
    failed = 0
    failures = []

    for line in lines[-50:]:
        if "passed" in line.lower() and "failed" in line.lower():
            import re
            nums = re.findall(r'\d+', line)
            if len(nums) >= 2:
                passed = int(nums[0]) if "passed" in line.lower().split("passed")[0] else total - failed
                failed = int(nums[1]) if nums else 0
        if "FAILED" in line or "ERROR" in line:
            failures.append(line.strip()[:200])

    if total == 0:
        # Heuristic: count PASSED/FAILED lines
        for line in lines:
            if "PASSED" in line:
                passed += 1
                total += 1
            elif "FAILED" in line:
                failed += 1
                total += 1
                failures.append(line.strip()[:200])

    return json.dumps({
        "format": "text",
        "total": total or "unknown",
        "passed": passed,
        "failed": failed,
        "pass_rate": round(passed / max(total, 1) * 100) if total else "unknown",
        "failures": failures[:20],
    }, ensure_ascii=False, indent=2)


import os  # For ci_generate_config output_dir
