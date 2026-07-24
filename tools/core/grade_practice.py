"""
grade_practice tool — deterministic grading. AI provides structured JSON,
the tool handles ALL file writing and format assembly. Zero format variance.
"""
import json
import os
import re
from agent.tool_registry import tool
from backend.stats import handle_update_stats


def _find_insertion_points(content: str) -> list[tuple[int, int]]:
    """Find all --- separators and their positions. Returns [(start, end)]."""
    points = []
    for m in re.finditer(r'^---\s*$', content, re.MULTILINE):
        points.append((m.start(), m.end()))
    return points


def _insert_grading_blocks(content: str, grades: list[dict]) -> tuple[str, int, int]:
    """
    Insert grading blocks before each --- anchor.
    Returns (new_content, correct_count, wrong_count).
    """
    points = _find_insertion_points(content)
    if not points:
        return content, 0, 0

    # Map question numbers to their --- anchors (Q1 → first ---, Q2 → second, etc.)
    correct = 0
    wrong = 0
    grade_map = {str(g.get("q", 0)): g for g in grades}

    # Build from end to start to preserve positions
    parts = list(content)
    for q_idx in range(min(len(points), len(grades)), 0, -1):
        g = grades[q_idx - 1]
        q_num = g.get("q", q_idx)

        # Check if grading block already exists before this ---
        sep_start, sep_end = points[q_idx - 1]
        before_sep = content[max(0, sep_start - 200):sep_start]
        if '<div class="grading-block' in before_sep:
            # Already graded — count but don't re-insert
            if g.get("correct", False):
                correct += 1
            else:
                wrong += 1
            continue

        is_correct = g.get("correct", False)
        if is_correct:
            correct += 1
        else:
            wrong += 1

        block = _build_correct_block(q_num) if is_correct else _build_wrong_block(g, q_num)

        # Insert before the --- separator
        prefix = "\n\n" if sep_start > 0 and content[sep_start - 1] == "\n" else "\n"
        insert = f"{prefix}{block}\n\n"
        parts.insert(sep_start, insert)

    return "".join(parts), correct, wrong


def _build_correct_block(q_num: int) -> str:
    return f'<div class="grading-block correct" data-q="{q_num}">\n\n### ✅ 正确\n\n</div>'


def _build_wrong_block(g: dict, q_num: int) -> str:
    your_answer = g.get("your_answer", "?")
    error_type = g.get("error_type", "概念性错误")
    error_detail = g.get("error_detail", "")
    lines = [
        f'<div class="grading-block wrong" data-q="{q_num}">',
        '',
        '### ❌ 错误',
        '',
        f'**你的答案** {your_answer}',
        '',
        f'**错因** {error_type}',
        f'{error_detail}' if error_detail else '',
        '',
        '</div>',
    ]
    return "\n".join(lines)


def _extract_results(grades: list[dict]) -> list[dict]:
    """Extract results array for update_stats."""
    results = []
    for g in grades:
        r = {
            "q": g.get("q", 0),
            "correct": g.get("correct", False),
            "difficulty": g.get("difficulty", "★★"),
        }
        if not r["correct"]:
            r["user_answer"] = g.get("your_answer", "?")
            r["correct_answer"] = g.get("correct_answer", "?")
            r["error_type"] = g.get("error_type", "概念性错误")
            r["error_analysis"] = g.get("error_detail", "")
            r["correct_approach"] = g.get("correct_approach", "")
            r["tips"] = g.get("tips", "")
        results.append(r)
    return results


@tool(
    name="grade_practice",
    description="""Grade practice questions deterministically. Pass a JSON with grades, the tool handles ALL file writing and stats updating.

JSON format:
{
  "file": "练习/判断推理/2026-06-26.md",
  "module": "判断推理",
  "date": "2026-06-26",
  "knowledge_points": ["逻辑判断"],
  "grades": [
    {"q": 1, "correct": true},
    {"q": 2, "correct": false, "your_answer": "C", "correct_answer": "A",
     "error_type": "概念性错误", "error_detail": "混淆了因果倒置和它因削弱",
     "difficulty": "★★★"}
  ],
  "time_seconds": 600
}

The tool will:
- Read the file, insert grading blocks before each --- separator
- Write the complete file back in ONE operation
- Call update_stats automatically
- Return a summary with correct/wrong counts
""",
    parameters={
        "type": "object",
        "properties": {
            "grading_data": {
                "type": "string",
                "description": "JSON string with grading data. See tool description for format."
            },
        },
        "required": ["grading_data"],
    }
)
def grade_practice(grading_data: str) -> str:
    try:
        if isinstance(grading_data, dict):
            data = grading_data
        else:
            data = json.loads(grading_data)
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON — {e}"

    # Validate required fields
    file_path = data.get("file", "")
    if not file_path:
        return "Error: 'file' field is required (e.g. 练习/判断推理/2026-06-26.md)"

    grades = data.get("grades", [])
    if not grades:
        return "Error: 'grades' array is empty"

    module = data.get("module", "")
    date = data.get("date", "")
    knowledge_points = data.get("knowledge_points", [])
    time_seconds = data.get("time_seconds", 0)

    # Resolve file path — auto-detect active project
    from cli.settings import get_user_dir
    projects_root = os.path.join(get_user_dir(), "projects")
    project_name = "公考练习"
    if os.path.isdir(projects_root):
        dirs = [d for d in os.listdir(projects_root) if os.path.isdir(os.path.join(projects_root, d)) and not d.startswith('.')]
        if dirs: project_name = dirs[0]
    project_dir = os.path.join(projects_root, project_name)
    full_path = os.path.join(project_dir, file_path)
    if not os.path.isfile(full_path):
        # Try relative to cwd
        full_path = file_path
        if not os.path.isfile(full_path):
            return f"Error: file not found: {file_path} (looked in {project_dir})"

    # Read the file
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return f"Error reading file: {e}"

    # Insert grading blocks
    try:
        new_content, correct, wrong = _insert_grading_blocks(content, grades)
    except Exception as e:
        return f"Error inserting grading blocks: {e}"

    total = len(grades)
    if total == 0:
        return "Error: no grades to insert"

    # Write the file
    tmp = full_path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(new_content)
        os.replace(tmp, full_path)
    except Exception as e:
        return f"Error writing file: {e}"

    # Build update_stats payload
    results = _extract_results(grades)
    # Use mode from input, fallback to auto-detect
    mode = data.get("mode", "")
    if not mode:
        mode = "essay" if ("申论" in module or "申论" in file_path) else "practice"

    stats_payload = {
        "mode": mode,
        "module": module,
        "date": date,
        "knowledge_points": knowledge_points,
        "results": results,
        "total": total,
        "correct": correct,
        "time_seconds": time_seconds,
    }

    stats_result = ""
    try:
        payload_str = json.dumps(stats_payload, ensure_ascii=False)
        stats_result = handle_update_stats(payload_str)
    except Exception as e:
        stats_result = f"(stats update skipped: {e})"

    accuracy = round(correct / total * 100, 1) if total > 0 else 0
    return (
        f"批改完成：{correct}/{total} 正确 ({accuracy}%)\n"
        f"文件已更新：{file_path}\n"
        f"统计：{stats_result}"
    )
