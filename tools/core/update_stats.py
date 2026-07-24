"""
update_stats tool — LLM calls this after grading to update all data files programmatically.
Replaces ~10 LLM tool calls (read+write 5 JSON files) with 1 deterministic call.
"""

import json
from agent.tool_registry import tool
from backend.stats import handle_update_stats


@tool(
    name="update_stats",
    description="""Update all statistics files after grading. Call this ONCE after you finish grading all questions and writing grading marks to the practice file.

Provide a JSON string with the structured grading results. The tool will update:
- 练习统计.json (append record, recalculate summary)
- 能力画像.json (update per-knowledge-point accuracy/attempts/trend/mastery)
- 复习队列.json (add mastered KPs to spaced repetition queue)
- 每日完成/{date}.json (calculate daily score)
- 错题本/{module}.md (format and append wrong questions)
- syllabus/{module}.json (update KP status)

JSON format:
{
  "mode": "practice",
  "module": "判断推理",
  "date": "2026-05-29",
  "knowledge_points": ["定义判断"],
  "results": [
    {"q": 1, "correct": true, "difficulty": "★★"},
    {"q": 2, "correct": false, "user_answer": "C", "correct_answer": "A",
     "difficulty": "★★★", "error_type": "概念性错误",
     "error_analysis": "混淆了概念...",
     "correct_approach": "正确做法是...", "tips": "技巧是..."}
  ],
  "total": 20,
  "correct": 17,
  "time_seconds": 1200,
  "time_suggested_seconds": 1500,
  "lecture_completed": true,
  "extra_practice": false,
  "batch_label": "首次",
  "comment": "表现不错，继续保持"
}

mode: "practice" (日常练习), "review" (间隔复习), "essay" (申论), "mock_exam" (模拟考试), "diagnostic" (初始诊断).
error_type must be one of: 概念性错误, 理解性错误, 执行性错误.
difficulty: "★" / "★★" / "★★★" (optional but recommended for accurate tracking).
Only wrong answers need error_analysis, correct_approach, tips.
""",
    parameters={
        "type": "object",
        "properties": {
            "grading_result": {
                "type": "string",
                "description": "JSON string with structured grading results. See tool description for format."
            },
        },
        "required": ["grading_result"],
    }
)
def update_stats(grading_result: str) -> str:
    try:
        # Handle case where LLM passes a dict instead of string
        if isinstance(grading_result, dict):
            grading_result = json.dumps(grading_result, ensure_ascii=False)
        return handle_update_stats(grading_result)
    except Exception as e:
        import traceback
        return f"update_stats failed: {e}\n{traceback.format_exc()}"
