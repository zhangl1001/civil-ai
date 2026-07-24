"""Test case refinement tools - detect duplicates, suggest improvements."""

import json
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="refine_testcase",
    description="Analyze test cases and suggest improvements: find duplicates, missing edge cases, priority adjustments, missing tags. Does NOT modify - just reports findings.",
    parameters={
        "type": "object",
        "properties": {
            "test_cases_json": {"type": "string", "description": "JSON array of test case objects to analyze"},
            "focus": {"type": "string", "enum": ["all", "duplicates", "priorities", "completeness"], "description": "Analysis focus area"},
        },
        "required": ["test_cases_json"],
    }
)
def refine_testcase(test_cases_json: str, focus: str = "all") -> str:
    try:
        cases = parse_json_arg(test_cases_json)
    except json.JSONDecodeError as e:
        return f"Error parsing test cases: {e}"

    suggestions = []
    seen_titles = {}
    duplicate_pairs = []

    for tc in cases:
        title = tc.get("title", "").strip().lower()
        tid = tc.get("id", "?")

        # Duplicate detection
        if focus in ("all", "duplicates"):
            if title in seen_titles:
                duplicate_pairs.append({"id_a": seen_titles[title], "id_b": tid, "title": tc.get("title", "")})
            else:
                seen_titles[title] = tid

        # Priority review
        if focus in ("all", "priorities"):
            # P0 should have clear business impact
            if tc.get("priority") == "P0" and not tc.get("precondition"):
                suggestions.append({"id": tid, "type": "missing_precondition", "detail": "P0 case has no precondition - consider adding setup steps"})
            # Security/exception cases should usually be P0/P1
            if tc.get("testDataType") in ("安全测试", "异常测试") and tc.get("priority") in ("P3",):
                suggestions.append({"id": tid, "type": "priority_too_low", "detail": f"Security/exception case marked {tc.get('priority')} - consider P1"})

        # Completeness
        if focus in ("all", "completeness"):
            if not tc.get("tags"):
                suggestions.append({"id": tid, "type": "missing_tags", "detail": "No tags - add tags for better organization"})
            steps = tc.get("steps", [])
            if steps and all(not s.get("expected") for s in steps if isinstance(s, dict)):
                suggestions.append({"id": tid, "type": "missing_step_expected", "detail": "Steps have no expected results - add per-step expectations"})
            if tc.get("expectedResult", "").strip() in ("", "成功", "ok"):
                suggestions.append({"id": tid, "type": "vague_expected", "detail": "Expected result is too vague - be specific"})

    result = {
        "analyzed": len(cases),
        "suggestions_count": len(suggestions),
        "duplicates": duplicate_pairs,
        "suggestions": suggestions[:30],
    }
    if not suggestions and not duplicate_pairs:
        result["status"] = "looks_good"

    return json.dumps(result, ensure_ascii=False, indent=2)


@tool(
    name="merge_testcases",
    description="Identify and suggest merges for similar test cases. Returns groups of similar cases with a suggested merged version.",
    parameters={
        "type": "object",
        "properties": {
            "test_cases_json": {"type": "string", "description": "JSON array of test case objects"},
        },
        "required": ["test_cases_json"],
    }
)
def merge_testcases(test_cases_json: str) -> str:
    try:
        cases = parse_json_arg(test_cases_json)
    except json.JSONDecodeError as e:
        return f"Error parsing test cases: {e}"

    # Simple similarity: same module + same testDataType + similar title keywords
    groups = {}
    for tc in cases:
        key = f"{tc.get('module','')}|{tc.get('testDataType','')}"
        groups.setdefault(key, []).append(tc)

    merge_suggestions = []
    for key, group in groups.items():
        if len(group) > 1:
            # Check if titles are very similar
            titles = [tc.get("title", "") for tc in group]
            merge_suggestions.append({
                "module": group[0].get("module", ""),
                "test_data_type": group[0].get("testDataType", ""),
                "count": len(group),
                "case_ids": [tc.get("id", "?") for tc in group],
                "titles": titles,
                "suggestion": f"These {len(group)} cases in the same module/type could potentially be merged with parameterization" if len(group) <= 3 else f"Consider creating a parameterized test for these {len(group)} similar cases",
            })

    return json.dumps({
        "total_cases": len(cases),
        "merge_groups_found": len(merge_suggestions),
        "suggestions": merge_suggestions[:20],
    }, ensure_ascii=False, indent=2)
