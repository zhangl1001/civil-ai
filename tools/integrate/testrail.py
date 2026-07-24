"""TestRail integration tool - push test cases to TestRail via API."""

import json
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="testrail_push",
    description="Push test cases to TestRail. Requires TestRail URL, username, API key, and project ID. Generates a TestRail-compatible payload and shows what would be pushed. If TestRail API is accessible, performs actual push.",
    parameters={
        "type": "object",
        "properties": {
            "test_cases_json": {"type": "string", "description": "JSON array of test case objects"},
            "testrail_url": {"type": "string", "description": "TestRail instance URL (e.g. https://example.testrail.io)"},
            "username": {"type": "string", "description": "TestRail username/email"},
            "api_key": {"type": "string", "description": "TestRail API key"},
            "project_id": {"type": "string", "description": "TestRail project ID"},
            "section_id": {"type": "string", "description": "TestRail section/suite ID (optional)"},
            "dry_run": {"type": "boolean", "description": "If true (default), only preview what would be pushed"},
        },
        "required": ["test_cases_json"],
    }
)
def testrail_push(
    test_cases_json: str,
    testrail_url: str = "",
    username: str = "",
    api_key: str = "",
    project_id: str = "",
    section_id: str = "",
    dry_run: bool = True,
) -> str:
    try:
        cases = parse_json_arg(test_cases_json)
    except json.JSONDecodeError as e:
        return f"Error parsing test cases: {e}"

    # Build TestRail payload
    payload = []
    for tc in cases:
        steps_text = ""
        for s in tc.get("steps", []):
            if isinstance(s, dict):
                steps_text += f"Step {s.get('step', '?')}: {s.get('action', '')}\n"
                if s.get("data"):
                    steps_text += f"  Data: {s.get('data')}\n"
                if s.get("expected"):
                    steps_text += f"  Expected: {s.get('expected')}\n"
            else:
                steps_text += str(s) + "\n"

        tr_case = {
            "title": tc.get("title", "Untitled"),
            "type_id": 1,  # Functional
            "priority_id": {"P0": 1, "P1": 2, "P2": 3, "P3": 4}.get(tc.get("priority", "P2"), 3),
            "custom_steps": steps_text.strip(),
            "custom_expected": tc.get("expectedResult", ""),
            "custom_preconds": tc.get("precondition", ""),
            "refs": f"ID: {tc.get('id', '')}",
        }
        payload.append(tr_case)

    if dry_run or not testrail_url:
        return json.dumps({
            "mode": "dry_run",
            "total_cases": len(payload),
            "payload": payload[:3],
            "note": "Set dry_run=false and provide testrail_url/username/api_key to push. First 3 cases shown for preview.",
        }, ensure_ascii=False, indent=2)

    # Actual push
    try:
        import urllib.request
        import base64

        auth = base64.b64encode(f"{username}:{api_key}".encode()).decode()
        url = f"{testrail_url.rstrip('/')}/index.php?/api/v2/add_cases/{section_id or project_id}"

        results = []
        for tc_payload in payload:
            data = json.dumps(tc_payload).encode()
            req = urllib.request.Request(url, data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", f"Basic {auth}")

            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    results.append({"title": tc_payload["title"], "status": resp.status, "ok": resp.status == 200})
            except Exception as e:
                results.append({"title": tc_payload["title"], "status": "failed", "error": str(e)})

        pushed = sum(1 for r in results if r.get("ok"))
        return json.dumps({"pushed": pushed, "failed": len(results) - pushed, "results": results}, ensure_ascii=False, indent=2)

    except Exception as e:
        return f"Error pushing to TestRail: {e}"
