"""
Change impact analysis tool.
Compares requirement versions to identify affected test cases.
Pure reasoning tool - no external dependencies.
"""

import json
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="analyze_change_impact",
    description="Analyze the impact of requirement changes on existing test cases. Compares old vs new requirements, identifies affected cases via traceability, and recommends add/update/delete actions.",
    parameters={
        "type": "object",
        "properties": {
            "old_requirements": {
                "type": "string",
                "description": "Old/current requirements, one per line. Format: REQ-ID: description"
            },
            "new_requirements": {
                "type": "string",
                "description": "New/updated requirements, one per line. Format: REQ-ID: description"
            },
            "test_cases_json": {
                "type": "string",
                "description": "JSON array of existing test case objects affected by the change"
            },
            "change_description": {
                "type": "string",
                "description": "Natural language description of what changed and why (optional but recommended for richer analysis)"
            },
        },
        "required": ["old_requirements", "new_requirements"],
    }
)
def analyze_change_impact(
    old_requirements: str,
    new_requirements: str,
    test_cases_json: str = "[]",
    change_description: str = "",
) -> str:
    try:
        cases = parse_json_arg(test_cases_json) if test_cases_json else []
    except json.JSONDecodeError:
        cases = []

    def parse_reqs(text: str) -> dict[str, str]:
        reqs = {}
        for line in text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            if ":" in line:
                rid, desc = line.split(":", 1)
                reqs[rid.strip()] = desc.strip()
            else:
                reqs[line] = line
        return reqs

    old_reqs = parse_reqs(old_requirements)
    new_reqs = parse_reqs(new_requirements)

    added = {rid: desc for rid, desc in new_reqs.items() if rid not in old_reqs}
    removed = {rid: desc for rid, desc in old_reqs.items() if rid not in new_reqs}
    modified = {}
    unchanged = {}
    for rid, new_desc in new_reqs.items():
        if rid in old_reqs:
            if old_reqs[rid] != new_desc:
                modified[rid] = {"old": old_reqs[rid], "new": new_desc}
            else:
                unchanged[rid] = new_desc

    # Match cases to changed requirements
    def match_cases(req_id: str, req_desc: str) -> list[str]:
        matched = []
        keywords = [kw.lower() for kw in req_desc.split() if len(kw) > 2]
        for tc in cases:
            tc_text = (tc.get("title", "") + tc.get("module", "") + tc.get("expectedResult", "")).lower()
            score = sum(1 for kw in keywords if kw in tc_text)
            if score > 0:
                matched.append(tc.get("id", "?"))
        return matched

    impacts = []
    for rid, desc in removed.items():
        linked = match_cases(rid, desc)
        impacts.append({
            "change_type": "removed",
            "requirement_id": rid,
            "description": desc,
            "affected_cases": linked,
            "action": "DELETE or mark as deprecated",
            "reason": f"Requirement {rid} has been removed",
        })

    for rid, change in modified.items():
        linked = match_cases(rid, change["new"])
        impacts.append({
            "change_type": "modified",
            "requirement_id": rid,
            "old_description": change["old"],
            "new_description": change["new"],
            "affected_cases": linked,
            "action": "UPDATE - revise test data, expected results, or steps",
            "reason": f"Requirement {rid} description changed",
        })

    for rid, desc in added.items():
        impacts.append({
            "change_type": "added",
            "requirement_id": rid,
            "description": desc,
            "affected_cases": [],
            "action": "ADD new test cases",
            "reason": f"New requirement {rid} needs coverage",
            "suggested_test_types": _suggest_test_types(desc),
        })

    # Summary
    total_affected = sum(len(i["affected_cases"]) for i in impacts)
    actions = {}
    for i in impacts:
        actions[i["action"]] = actions.get(i["action"], 0) + 1

    return json.dumps({
        "change_summary": change_description or f"Requirements: {len(added)} added, {len(modified)} modified, {len(removed)} removed",
        "statistics": {
            "total_old_requirements": len(old_reqs),
            "total_new_requirements": len(new_reqs),
            "added": len(added),
            "modified": len(modified),
            "removed": len(removed),
            "unchanged": len(unchanged),
            "total_test_cases": len(cases),
            "affected_test_cases": total_affected,
        },
        "action_breakdown": actions,
        "impacts": impacts,
        "recommendation": _build_recommendation(len(added), len(modified), len(removed), total_affected),
    }, ensure_ascii=False, indent=2)


def _suggest_test_types(desc: str) -> list[str]:
    types = ["功能测试"]
    desc_lower = desc.lower()
    if any(kw in desc_lower for kw in ["登录", "auth", "认证", "权限", "login", "token"]):
        types.append("安全测试")
    if any(kw in desc_lower for kw in ["查询", "搜索", "列表", "search", "list", "查询"]):
        types.append("边界测试")
    if any(kw in desc_lower for kw in ["上传", "文件", "upload", "file"]):
        types.append("异常测试")
    if any(kw in desc_lower for kw in ["删除", "delete", "remove", "修改", "update"]):
        types.append("异常测试")
    return types


def _build_recommendation(added: int, modified: int, removed: int, affected: int) -> str:
    parts = []
    if added:
        parts.append(f"新增 {added} 条需求，需生成对应测试用例")
    if modified:
        parts.append(f"修改 {modified} 条需求，需审查并更新受影响用例")
    if removed:
        parts.append(f"删除 {removed} 条需求，{affected} 条用例需归档或删除")
    return "；".join(parts) if parts else "无需变更"
