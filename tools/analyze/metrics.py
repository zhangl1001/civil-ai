"""
Test metrics and trend analysis tools.
Collects metrics across sessions and generates trend reports.
"""

import json
import os
import time
from agent.tool_registry import tool
from tools import parse_json_arg

_metrics_dir = None


def set_metrics_dir(path: str):
    global _metrics_dir
    _metrics_dir = path
    os.makedirs(path, exist_ok=True)


@tool(
    name="test_metrics_record",
    description="Record test metrics for the current session: pass rates, case counts, priority distribution, coverage. Data persists across sessions for trend analysis.",
    parameters={
        "type": "object",
        "properties": {
            "project_name": {
                "type": "string",
                "description": "Project or feature name for grouping metrics"
            },
            "metrics_json": {
                "type": "string",
                "description": "JSON object with metrics: total_cases, p0/p1/p2/p3 counts, pass_rate (0-100), coverage_percent, defects_found, execution_time_seconds"
            },
        },
        "required": ["project_name", "metrics_json"],
    }
)
def test_metrics_record(project_name: str, metrics_json: str) -> str:
    try:
        metrics = parse_json_arg(metrics_json)
    except json.JSONDecodeError as e:
        return f"Error parsing metrics: {e}"

    from cli.settings import SETTINGS_DIR as _sd
    md = _metrics_dir or os.path.join(_sd, "metrics")
    os.makedirs(md, exist_ok=True)

    filepath = os.path.join(md, f"{project_name}.jsonl")
    entry = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "metrics": metrics,
    }

    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # Also update summary
    _update_summary(md, project_name)

    return f"Metrics recorded for {project_name}. Use test_metrics_trend to analyze."


@tool(
    name="test_metrics_trend",
    description="Analyze test metrics trends over time. Reads historical metrics for a project and generates trend analysis with improvement suggestions.",
    parameters={
        "type": "object",
        "properties": {
            "project_name": {
                "type": "string",
                "description": "Project name to analyze trends for"
            },
            "period": {
                "type": "string",
                "enum": ["all", "week", "month"],
                "description": "Time period for trend analysis"
            },
        },
        "required": ["project_name"],
    }
)
def test_metrics_trend(project_name: str, period: str = "all") -> str:
    from cli.settings import SETTINGS_DIR as _sd
    md = _metrics_dir or os.path.join(_sd, "metrics")
    filepath = os.path.join(md, f"{project_name}.jsonl")

    if not os.path.exists(filepath):
        return json.dumps({
            "project": project_name,
            "error": "No metrics recorded yet for this project. Use test_metrics_record to start collecting.",
        }, ensure_ascii=False, indent=2)

    entries = []
    with open(filepath, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    if not entries:
        return json.dumps({"project": project_name, "error": "No valid metric entries found"}, ensure_ascii=False, indent=2)

    # Filter by period
    if period == "week":
        cutoff = time.time() - 7 * 86400
        entries = [e for e in entries if time.mktime(time.strptime(e["timestamp"][:10], "%Y-%m-%d")) > cutoff]
    elif period == "month":
        cutoff = time.time() - 30 * 86400
        entries = [e for e in entries if time.mktime(time.strptime(e["timestamp"][:10], "%Y-%m-%d")) > cutoff]

    # Compute trends
    def extract_val(entry, key, default=0):
        return entry.get("metrics", {}).get(key, default)

    snapshots = len(entries)
    first = entries[0]["metrics"]
    last = entries[-1]["metrics"]

    changes = {}
    for key in ["total_cases", "pass_rate", "coverage_percent", "defects_found", "execution_time_seconds"]:
        old_val = first.get(key, 0)
        new_val = last.get(key, 0)
        delta = new_val - old_val
        changes[key] = {
            "first": old_val,
            "last": new_val,
            "delta": delta,
            "trend": "up" if delta > 0 else ("down" if delta < 0 else "stable"),
        }

    # Timeline
    timeline = []
    for e in entries[-20:]:  # Last 20 snapshots
        m = e["metrics"]
        timeline.append({
            "timestamp": e["timestamp"],
            "total_cases": m.get("total_cases", 0),
            "pass_rate": m.get("pass_rate", 0),
            "coverage_percent": m.get("coverage_percent", 0),
        })

    # Generate insights
    insights = _generate_insights(changes, timeline)

    return json.dumps({
        "project": project_name,
        "period": period,
        "snapshots_analyzed": snapshots,
        "first_recorded": entries[0]["timestamp"] if entries else "",
        "last_recorded": entries[-1]["timestamp"] if entries else "",
        "current_state": last,
        "changes": changes,
        "timeline": timeline,
        "insights": insights,
    }, ensure_ascii=False, indent=2)


def _update_summary(md: str, project_name: str):
    """Update summary.json with latest metrics per project."""
    filepath = os.path.join(md, f"{project_name}.jsonl")
    summary_path = os.path.join(md, "summary.json")

    # Read last entry
    last_entry = None
    with open(filepath, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    last_entry = json.loads(line)
                except json.JSONDecodeError:
                    pass

    if not last_entry:
        return

    summaries = {}
    if os.path.exists(summary_path):
        try:
            with open(summary_path, encoding="utf-8") as f:
                summaries = json.load(f)
        except (json.JSONDecodeError, IOError):
            summaries = {}

    summaries[project_name] = {
        "last_updated": last_entry["timestamp"],
        "latest_metrics": last_entry["metrics"],
    }

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summaries, f, ensure_ascii=False, indent=2)


def _generate_insights(changes: dict, timeline: list) -> list[str]:
    insights = []

    # Coverage trend
    cov = changes.get("coverage_percent", {})
    cov_delta = cov.get("delta", 0)
    if cov_delta > 5:
        insights.append(f"覆盖率持续增长 (+{cov_delta}%)，测试策略有效")
    elif cov_delta < -5:
        insights.append(f"覆盖率下降 ({cov_delta}%)，可能有新代码未覆盖，建议做 gap analysis")

    # Pass rate
    pr = changes.get("pass_rate", {})
    if pr.get("last", 100) < 95:
        insights.append(f"通过率偏低 ({pr['last']}%)，建议优先修复失败用例")
    elif pr.get("delta", 0) < 0:
        insights.append("通过率呈下降趋势，检查是否有回归缺陷")

    # Defects
    defects = changes.get("defects_found", {})
    if defects.get("trend") == "down" and cov.get("trend") == "up":
        insights.append("缺陷数量下降 + 覆盖率上升 = 质量改善信号，继续保持")
    elif defects.get("trend") == "up":
        insights.append(f"缺陷数量上升 (+{defects['delta']})，排查是测试发现能力提升还是代码质量下降")

    # Execution time
    exec_time = changes.get("execution_time_seconds", {})
    if exec_time.get("delta", 0) > 60:
        insights.append("测试执行时间增长显著，建议增加并行执行或用 spawn_expert 优化")
    elif exec_time.get("delta", 0) < -30:
        insights.append("测试执行时间优化有效，保持当前策略")

    if len(timeline) >= 3:
        insights.append("连续跟踪 3 次以上，趋势数据稳定可参考")

    return insights
