"""
write_questions tool — deterministic practice file writer. AI provides structured
question data, the tool handles ALL A1/A5 formatting. Zero format variance.
"""
import json
import os
from agent.tool_registry import tool


def _format_question(q: dict, q_num: int) -> str:
    """Format a single question in A1 format. Returns markdown string."""
    stem = q.get("stem", "")
    difficulty = q.get("difficulty", "★★")
    kp_label = q.get("kp_label", "")
    options = q.get("options", [])
    answer = q.get("answer", "")
    steps = q.get("steps", [])
    topic = q.get("knowledge_point", kp_label)
    tip = q.get("tip", "")

    lines = []
    # Question header
    header = f"**{q_num}.** （{difficulty} {kp_label}）{stem}" if kp_label else f"**{q_num}.** （{difficulty}）{stem}"
    lines.append(header)
    lines.append("")

    # Options
    labels = ["A", "B", "C", "D"]
    for i, opt in enumerate(options[:4]):
        opt = opt.strip()
        # Strip ALL AI-duplicated prefixes (e.g. "A. A. xxx" → "xxx")
        while len(opt) > 2 and opt[0] in 'ABCD' and opt[1] == '.':
            opt = opt[2:].strip()
        lines.append(f"{labels[i]}. {opt}")
        lines.append("")

    # Answer block
    lines.append('<div class="answer-block">')
    lines.append("")
    lines.append(f"**答案** {answer}")
    lines.append("")
    lines.append("**解题步骤**")
    for j, step in enumerate(steps, 1):
        lines.append(f"{j}. {step}")
    lines.append("")
    lines.append(f"**考点** {topic if topic else kp_label}")
    lines.append("")
    lines.append(f"**避坑** {tip if tip else '无'}")
    lines.append("")
    lines.append("</div>")
    lines.append("")
    lines.append("---")

    return "\n".join(lines)


def _format_lecture(lecture: dict) -> str:
    """Format lecture section in A5 format."""
    topic = lecture.get("topic", "")
    lines = [f"## 讲义：{topic}", ""]
    lines.append("> 本次学习知识点，请认真阅读讲义后再做练习题。")
    lines.append("")

    sections = [
        ("概念定义", lecture.get("concept")),
        ("解题步骤", lecture.get("steps_text")),
        ("常见题型", lecture.get("types_text")),
        ("易错陷阱", lecture.get("pitfalls_text")),
        ("例题精讲", lecture.get("examples_text")),
    ]
    for title, content in sections:
        if content:
            lines.append(f"### {title}")
            lines.append("")
            if isinstance(content, list):
                for item in content:
                    lines.append(f"- {item}")
            else:
                lines.append(str(content))
            lines.append("")

    return "\n".join(lines)


def _format_essay(essay: dict) -> str:
    """Format essay content with question-block and answer-block wrappers. Returns markdown string."""
    material = essay.get("material", "")
    requirements = essay.get("requirements", "")
    reference_answer = essay.get("reference_answer", "")

    lines = []
    lines.append('<div class="question-block">')
    lines.append("")
    lines.append("## 题目")
    lines.append("")
    if material:
        lines.append(material)
        lines.append("")
    if requirements:
        lines.append("### 【作答要求】")
        lines.append("")
        lines.append(requirements)
        lines.append("")
    lines.append("</div>")
    lines.append("")

    if reference_answer:
        lines.append('<div class="answer-block">')
        lines.append("")
        lines.append("## 答案")
        lines.append("")
        lines.append(reference_answer)
        lines.append("")
        lines.append("</div>")
        lines.append("")

    lines.append("## 答案区（用户作答）")
    lines.append("")
    lines.append("<!-- 请在下方写出你的答案，然后告诉我\"批改\" -->")

    return "\n".join(lines)


def _build_essay_file(
    module: str,
    date: str,
    lecture: dict | None,
    essay: dict,
) -> str:
    """Build the complete essay file content with proper div wrappers."""
    lines = []

    lines.append(f"# {module} | {date}")
    lines.append("")

    if lecture:
        lines.append(_format_lecture(lecture))
        lines.append("")

    lines.append(_format_essay(essay))

    return "\n".join(lines)


def _build_file(
    module: str,
    date: str,
    lecture: dict | None,
    questions: list[dict],
    existing_content: str = "",
    is_review: bool = False,
) -> str:
    """Build the complete practice file content."""
    lines = []

    # Header
    if existing_content:
        # Appending to existing file — find where to insert
        lines.append(existing_content.rstrip())
        lines.append("")
    else:
        lines.append(f"# {module} | {date}")
        lines.append("")

    # Lecture section (only for new files)
    if lecture and not existing_content:
        lines.append(_format_lecture(lecture))
        lines.append("")

    # Questions section header
    if not existing_content:
        lines.append("## 练习题")
        lines.append("")

    # Determine starting question number
    start_num = 1
    if existing_content:
        # Count existing questions
        import re
        existing_qs = re.findall(r'^\*\*(\d+)\.\*\*', existing_content, re.MULTILINE)
        if existing_qs:
            start_num = max(int(n) for n in existing_qs) + 1

    # Section marker for appended questions
    if is_review:
        lines.append("## 间隔复习")
        lines.append("")
    elif existing_content and questions:
        # Appending extra practice
        pass  # continue numbering from start_num

    # Format each question
    for i, q in enumerate(questions):
        lines.append(_format_question(q, start_num + i))
        lines.append("")

    return "\n".join(lines)


@tool(
    name="write_questions",
    description="""Write practice questions to a file with guaranteed A1/A5 formatting.
The tool handles ALL format assembly — the AI only provides question data.

For a NEW file (first time today):
{
  "file": "练习/判断推理/2026-06-26.md",
  "module": "判断推理",
  "date": "2026-06-26",
  "lecture": {
    "topic": "逻辑判断-解释评价",
    "concept": "定义...",
    "steps_text": "1. 读题\\n2. 找矛盾...",
    "types_text": "- 类型一\\n- 类型二",
    "pitfalls_text": "- 坑一\\n- 坑二",
    "examples_text": "例题：..."
  },
  "questions": [
    {
      "stem": "题干文字",
      "difficulty": "★★",
      "kp_label": "解释评价",
      "knowledge_point": "逻辑判断-解释评价",
      "options": ["A选项文字", "B选项文字", "C选项文字", "D选项文字"],
      "answer": "B",
      "steps": ["第一步推理", "第二步推理"],
      "tip": "避坑提示"
    }
  ]
}

For appending to an existing file (review questions, extra practice), omit "lecture".

For essay (申论) files, use "essay" instead of "questions":
{
  "file": "练习/申论/2026-06-29.md",
  "module": "申论",
  "date": "2026-06-29",
  "lecture": {"topic": "提出对策题", "concept": "...", "steps_text": "...", "types_text": "...", "pitfalls_text": "...", "examples_text": "..."},
  "essay": {
    "material": "给定资料材料文字...",
    "requirements": "作答要求文字...",
    "reference_answer": "参考答案/范文..."
  }
}

The tool will:
- Build properly formatted questions with <div class="answer-block"> wrapping
- For essay: wrap question in <div class="question-block"> and answer in <div class="answer-block">
- Each field on its own line with blank line separation
- Write the file atomically (tmp → rename)
- Return a summary
""",
    parameters={
        "type": "object",
        "properties": {
            "data": {
                "type": "string",
                "description": "JSON string with question data. See tool description for format."
            },
        },
        "required": ["data"],
    },
    category="output",
)
def write_questions(data: str) -> str:
    try:
        if isinstance(data, dict):
            d = data
        else:
            d = json.loads(data)
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON — {e}"

    file_path = d.get("file", "")
    if not file_path:
        return "Error: 'file' is required"

    module = d.get("module", "")
    date = d.get("date", "")
    lecture = d.get("lecture")
    questions = d.get("questions", [])
    essay = d.get("essay")
    is_review = d.get("is_review", False)

    if not questions and not essay:
        return "Error: 'questions' array or 'essay' object is required"

    # Resolve path — auto-detect active project
    from cli.settings import get_user_dir
    projects_root = os.path.join(get_user_dir(), "projects")
    project_name = "公考练习"
    if os.path.isdir(projects_root):
        dirs = [d for d in os.listdir(projects_root) if os.path.isdir(os.path.join(projects_root, d)) and not d.startswith('.')]
        if dirs: project_name = dirs[0]  # Use first available project
    project_dir = os.path.join(projects_root, project_name)
    full_path = os.path.join(project_dir, file_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    # Check if file already exists
    existing = ""
    if os.path.isfile(full_path):
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                existing = f.read()
        except Exception as e:
            return f"Error reading existing file: {e}"

    # Build file content
    try:
        if essay:
            content = _build_essay_file(module, date, lecture, essay)
        else:
            content = _build_file(module, date, lecture, questions, existing, is_review)
    except Exception as e:
        return f"Error building file content: {e}"

    # Atomic write
    tmp = full_path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, full_path)
    except Exception as e:
        return f"Error writing file: {e}"

    if essay:
        return (
            f"文件已写入：{file_path}\n"
            f"申论练习（含讲义+题目+答案）"
        )

    total = len(questions)
    return (
        f"文件已写入：{file_path}\n"
        f"{'新建' if not existing else '追加'} {total} 题"
        f"{'（含讲义）' if lecture else ''}"
    )
