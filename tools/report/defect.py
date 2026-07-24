"""Defect report generation tools."""

import json
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="generate_defect_report",
    description="Generate a structured defect report from test case results. Include defect ID, severity, reproduction steps, and suggested fix.",
    parameters={
        "type": "object",
        "properties": {
            "failures_json": {
                "type": "string",
                "description": "JSON array of failed test cases with actual results. Each: id, title, expectedResult, actualResult, steps, severity (optional)"
            },
            "format": {
                "type": "string",
                "enum": ["json", "markdown", "jira"],
                "description": "Output format"
            },
        },
        "required": ["failures_json"],
    }
)
def generate_defect_report(failures_json: str, format: str = "markdown") -> str:
    try:
        failures = parse_json_arg(failures_json)
    except json.JSONDecodeError as e:
        return f"Error parsing failures: {e}"

    if not isinstance(failures, list):
        failures = [failures]

    defects = []
    for i, f in enumerate(failures, 1):
        severity = classify_severity(f)
        defects.append({
            "defect_id": f"BUG-{i:04d}",
            "test_case_id": f.get("id", "?"),
            "title": f"[{severity}] {f.get('title', 'Unknown failure')}",
            "severity": severity,
            "expected": f.get("expectedResult", ""),
            "actual": f.get("actualResult", "Not specified"),
            "steps_to_reproduce": _format_steps(f.get("steps", [])),
            "environment": f.get("environment", "Test environment"),
            "assigned_to": "TBD",
            "status": "Open",
        })

    if format == "json":
        return json.dumps({"total_defects": len(defects), "defects": defects}, ensure_ascii=False, indent=2)

    elif format == "markdown":
        lines = [
            f"# Defect Report",
            f"",
            f"**Total Defects**: {len(defects)}",
            f"**Generated**: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}",
            f"",
            f"## Severity Summary",
            f"",
            f"| Severity | Count |",
            f"|----------|-------|",
        ]
        sev_count = {}
        for d in defects:
            sev_count[d["severity"]] = sev_count.get(d["severity"], 0) + 1
        for s in ["Blocker", "Critical", "Major", "Minor", "Trivial"]:
            if s in sev_count:
                lines.append(f"| {s} | {sev_count[s]} |")

        lines += ["", "## Defects", ""]
        for d in defects:
            lines.append(f"### {d['defect_id']}: {d['title']}")
            lines.append(f"- **Severity**: {d['severity']}  ")
            lines.append(f"- **Status**: {d['status']}  ")
            lines.append(f"- **Test Case**: {d['test_case_id']}  ")
            lines.append(f"- **Expected**: {d['expected']}  ")
            lines.append(f"- **Actual**: {d['actual']}  ")
            lines.append(f"- **Steps**: {d['steps_to_reproduce']}  ")
            lines.append("")

        return "\n".join(lines)

    elif format == "jira":
        items = []
        for d in defects:
            items.append({
                "project": {"key": "TEST"},
                "summary": d["title"],
                "description": f"*Expected:* {d['expected']}\n*Actual:* {d['actual']}\n*Steps:* {d['steps_to_reproduce']}",
                "issuetype": {"name": "Bug"},
                "priority": {"name": d["severity"]},
            })
        return json.dumps(items, ensure_ascii=False, indent=2)

    return json.dumps(defects, ensure_ascii=False, indent=2)


def classify_severity(failure: dict) -> str:
    """Classify defect severity based on keywords and priority."""
    title = failure.get("title", "").lower()
    priority = failure.get("priority", "P2")
    actual = failure.get("actualResult", "").lower()

    # Blocker: system crash, data loss, security breach
    if any(kw in f"{title} {actual}" for kw in ["crash", "崩溃", "数据丢失", "sql注入", "越权"]):
        return "Blocker"
    # Critical: core function broken
    if priority == "P0" or any(kw in title for kw in ["登录失败", "支付失败", "核心"]):
        return "Critical"
    # Major: function broken but workaround exists
    if priority == "P1" or any(kw in title for kw in ["错误", "异常"]):
        return "Major"
    # Minor: non-critical issue
    if priority == "P2":
        return "Minor"
    return "Trivial"


def _format_steps(steps: list) -> str:
    if not steps:
        return "Not provided"
    parts = []
    for s in steps:
        if isinstance(s, dict):
            parts.append(f"Step {s.get('step','?')}: {s.get('action','')}")
        else:
            parts.append(str(s))
    return "; ".join(parts)


@tool(
    name="classify_defect",
    description="Classify a defect by type (functional/performance/security/UI/data) and severity (Blocker/Critical/Major/Minor/Trivial) based on its description.",
    parameters={
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "Defect description or error message"},
        },
        "required": ["description"],
    }
)
def classify_defect(description: str) -> str:
    desc = description.lower()

    # Type classification
    dtype = "functional"
    if any(kw in desc for kw in ["timeout", "slow", "memory", "cpu", "性能", "慢", "超时", "oom"]):
        dtype = "performance"
    elif any(kw in desc for kw in ["xss", "sql injection", "csrf", "auth", "认证", "权限", "注入", "越权"]):
        dtype = "security"
    elif any(kw in desc for kw in ["layout", "color", "font", "css", "misaligned", "ui", "界面", "显示", "样式"]):
        dtype = "ui"
    elif any(kw in desc for kw in ["null", "npe", "type error", "数据", "字段", "格式"]):
        dtype = "data"

    # Severity
    sev = "Minor"
    if any(kw in desc for kw in ["crash", "down", "崩溃", "宕机", "数据丢失", "security", "安全"]):
        sev = "Blocker"
    elif any(kw in desc for kw in ["core", "login", "payment", "核心", "登录", "支付", "p0"]):
        sev = "Critical"
    elif any(kw in desc for kw in ["error", "wrong", "incorrect", "错误", "异常", "失败"]):
        sev = "Major"

    return json.dumps({
        "defect_type": dtype,
        "severity": sev,
        "confidence": "medium - AI classification, review recommended",
    }, ensure_ascii=False, indent=2)
