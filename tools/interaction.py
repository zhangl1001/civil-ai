"""
User interaction tools - ask the user questions, request confirmations.
"""

import os
from agent.tool_registry import tool

# Global callback set by CLI to handle user questions
_user_ask_callback = None


def set_ask_callback(callback):
    global _user_ask_callback
    _user_ask_callback = callback


def _is_web_context() -> bool:
    """Detect if we're running in web server context (no stdin)."""
    return not os.isatty(0)


@tool(
    name="ask_user",
    description="Ask the user a question or request confirmation. Use this when you need clarification before proceeding.",
    parameters={
        "type": "object",
        "properties": {
            "question": {"type": "string", "description": "The question to ask the user"},
            "options": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of choices for the user"
            },
        },
        "required": ["question"],
    }
)
def ask_user(question: str, options: list = None) -> str:
    if _is_web_context():
        opts = f"\n选项: {', '.join(options)}" if options else ""
        return (
            f"[需用户回复] {question}{opts}\n\n"
            "请在对话中直接向用户提问，用户会在下一轮回复。"
        )
    if _user_ask_callback:
        answer = _user_ask_callback(question, options or [])
        return f"User answered: {answer}"
    return "Cannot ask user: no interactive session available"


@tool(
    name="request_review",
    description="Present generated content to the user for review. The user can approve, reject, or request changes.",
    parameters={
        "type": "object",
        "properties": {
            "content_type": {"type": "string", "description": "Type of content: test_points, test_cases, summary"},
            "summary": {"type": "string", "description": "Brief summary of what's being reviewed"},
            "items": {
                "type": "array",
                "items": {"type": "object"},
                "description": "The content to review"
            },
        },
        "required": ["content_type", "summary"],
    }
)
def request_review(content_type: str, summary: str, items: list = None) -> str:
    if _is_web_context():
        items_text = f"\n前3项: {items[:3]}" if items else ""
        return (
            f"[需用户审核] {content_type}: {summary}{items_text}\n"
            f"共 {len(items or [])} 项待审核。\n"
            "请在对话中直接向用户展示内容并请求审核（approve/reject/modify），用户会在下一轮回复。"
        )
    if _user_ask_callback:
        response = _user_ask_callback(
            f"[REVIEW] {content_type}: {summary}\n{len(items or [])} items ready for review. Approve?",
            ["approve", "reject", "modify"]
        )
        return f"Review result: {response}"
    return "Cannot request review: no interactive session"
