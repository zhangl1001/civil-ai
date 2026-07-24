"""
Code coverage tools - wraps coverage.py for code coverage analysis.
Enables agent to: run coverage → identify gaps → improve quality → re-check.
"""

import json
import os
import subprocess
import tempfile
from agent.tool_registry import tool


@tool(
    name="run_coverage",
    description="Run Python code coverage analysis using coverage.py. Measures statement/branch coverage and identifies uncovered lines. Useful for understanding code quality and identifying gaps in automated checks.",
    parameters={
        "type": "object",
        "properties": {
            "source_path": {
                "type": "string",
                "description": "Path to the source code directory or file to measure (e.g. './src' or './app.py')"
            },
            "test_command": {
                "type": "string",
                "description": "Command to run tests (e.g. 'pytest tests/' or 'python -m pytest tests/')"
            },
            "output_format": {
                "type": "string",
                "enum": ["json", "report", "brief"],
                "description": "Coverage output format: json (detailed), report (summary), brief (one-line)"
            },
        },
        "required": ["source_path", "test_command"],
    }
)
def run_coverage(source_path: str, test_command: str, output_format: str = "json") -> str:
    if not os.path.exists(source_path):
        return f"Error: source path not found: {source_path}"

    # Generate unique data file name to avoid conflicts
    data_file = os.path.join(tempfile.gettempdir(), f".coverage_zhangl_{os.getpid()}")

    commands = [
        ["coverage", "run", f"--data-file={data_file}", "--branch", "-m"] + test_command.split(),
        ["coverage", "report", f"--data-file={data_file}", "--show-missing"],
        ["coverage", "json", f"--data-file={data_file}", "-o", os.path.join(tempfile.gettempdir(), "zhangl_coverage.json")],
    ]

    results = []
    try:
        # Step 1: Run coverage
        r1 = subprocess.run(
            commands[0], capture_output=True, text=True, timeout=300,
            cwd=os.getcwd(),
        )
        results.append(f"=== Test Run ===\n{r1.stdout[-2000:]}\n{r1.stderr[-500:]}")

    except subprocess.TimeoutExpired:
        return "Coverage run timed out after 300s"
    except FileNotFoundError:
        return "Error: coverage.py not found. Install with: pip install coverage"

    # Step 2: Generate report
    try:
        r2 = subprocess.run(
            commands[1], capture_output=True, text=True, timeout=30,
            cwd=os.getcwd(),
        )
        report_text = r2.stdout
        results.append(f"=== Coverage Report ===\n{report_text}")

    except Exception as e:
        report_text = f"Report generation error: {e}"

    # Step 3: Generate JSON if requested
    json_data = None
    if output_format in ("json", "brief"):
        try:
            subprocess.run(commands[2], capture_output=True, text=True, timeout=30, cwd=os.getcwd())
            json_path = os.path.join(tempfile.gettempdir(), "zhangl_coverage.json")
            if os.path.exists(json_path):
                with open(json_path, encoding="utf-8") as f:
                    json_data = json.load(f)

                # Parse and summarize
                totals = json_data.get("totals", {})
                results.append(json.dumps({
                    "format": "json_summary",
                    "total_lines": totals.get("num_statements", 0),
                    "covered_lines": totals.get("covered_lines", 0),
                    "missing_lines": totals.get("missing_lines", 0),
                    "percent_covered": totals.get("percent_covered", 0),
                    "branch_coverage": totals.get("percent_covered", 0),
                    "files": len(json_data.get("files", {})),
                    "uncovered_files": [
                        {"file": f, "missing_lines": info.get("missing_lines", [])}
                        for f, info in json_data.get("files", {}).items()
                        if info.get("summary", {}).get("percent_covered", 100) < 100
                    ][:30],
                }, ensure_ascii=False, indent=2))

        except Exception as e:
            results.append(f"JSON generation error: {e}")

    # Cleanup
    try:
        os.unlink(data_file)
    except OSError:
        pass

    if output_format == "brief":
        if json_data:
            t = json_data.get("totals", {})
            return f"Coverage: {t.get('percent_covered', '?')}% ({t.get('covered_lines', 0)}/{t.get('num_statements', 0)} lines)"
        return report_text.split("\n")[1] if "\n" in report_text else report_text

    return "\n".join(results)
