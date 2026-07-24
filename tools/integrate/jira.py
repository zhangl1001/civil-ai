"""Jira integration tool - create issues from test results."""

import json
from agent.tool_registry import tool


@tool(
    name="jira_create_issue",
    description="Create a Jira issue (bug/story/task) from a test case or defect. Requires Jira URL, email, and API token.",
    parameters={
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Issue summary/title"},
            "description": {"type": "string", "description": "Issue description (markdown supported)"},
            "issue_type": {"type": "string", "enum": ["Bug", "Story", "Task", "Improvement"], "description": "Jira issue type"},
            "priority": {"type": "string", "enum": ["Highest", "High", "Medium", "Low", "Lowest"], "description": "Issue priority"},
            "jira_url": {"type": "string", "description": "Jira instance URL (e.g. https://your-company.atlassian.net)"},
            "email": {"type": "string", "description": "Jira account email"},
            "api_token": {"type": "string", "description": "Jira API token"},
            "project_key": {"type": "string", "description": "Jira project key (e.g. TEST)"},
            "dry_run": {"type": "boolean", "description": "If true (default), preview only"},
        },
        "required": ["summary"],
    }
)
def jira_create_issue(
    summary: str,
    description: str = "",
    issue_type: str = "Bug",
    priority: str = "Medium",
    jira_url: str = "",
    email: str = "",
    api_token: str = "",
    project_key: str = "TEST",
    dry_run: bool = True,
) -> str:
    payload = {
        "fields": {
            "project": {"key": project_key},
            "summary": summary,
            "description": description or summary,
            "issuetype": {"name": issue_type},
            "priority": {"name": priority},
        }
    }

    if dry_run or not jira_url:
        return json.dumps({
            "mode": "dry_run",
            "payload": payload,
            "note": "Set dry_run=false and provide jira_url/email/api_token to create. Use project_key for your project.",
        }, ensure_ascii=False, indent=2)

    try:
        import urllib.request
        import base64

        auth = base64.b64encode(f"{email}:{api_token}".encode()).decode()
        url = f"{jira_url.rstrip('/')}/rest/api/2/issue"
        data = json.dumps(payload).encode()

        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Basic {auth}")

        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            return json.dumps({
                "status": "created",
                "key": result.get("key", ""),
                "url": f"{jira_url.rstrip('/')}/browse/{result.get('key', '')}",
            }, ensure_ascii=False, indent=2)

    except Exception as e:
        return f"Error creating Jira issue: {e}\n\nPayload was: {json.dumps(payload, ensure_ascii=False, indent=2)}"
