"""
Task management tools — task tracking system.
Tasks are the single source of truth for completion. The engine gates
AgentDone on _has_incomplete_tasks(), not on fragile signals like
"did the AI return tool calls."

Key design:
- AI creates tasks BEFORE spawning experts (plan then execute)
- spawn_expert links to a task via task_id → status auto-updates
- Engine injects task status into context each turn
- Dependencies (blocks/blockedBy) prevent premature work
"""

import uuid
from dataclasses import dataclass, field
from typing import Optional
from agent.tool_registry import tool

# In-memory task store (session-scoped)
_tasks: dict[str, "Task"] = {}
_counter: list[int] = [0]
_session_slug: str = uuid.uuid4().hex[:4]  # changes every process restart

# Valid status transitions
VALID_TRANSITIONS = {
    "pending": {"in_progress"},
    "in_progress": {"done", "pending"},
    "done": {"in_progress"},  # can reopen
}


@dataclass
class Task:
    id: str
    subject: str
    description: str = ""
    status: str = "pending"  # pending, in_progress, done
    owner: str = ""          # agent name or expert type
    expert_id: str = ""      # linked background expert task_id
    expert_failures: int = 0  # how many times an expert failed for this task
    result_summary: str = ""  # brief completion summary (not full output)
    blocks: list[str] = field(default_factory=list)    # task IDs blocked by this one
    blocked_by: list[str] = field(default_factory=list)  # task IDs blocking this one

    @staticmethod
    def next_id() -> str:
        _counter[0] += 1
        return f"{_counter[0]}-{_session_slug}"


# --- Programmatic API (used by engine and spawn_expert, not tool-callable) ---

def _get_task(task_id: str) -> Optional[Task]:
    return _tasks.get(task_id)

def _find_task_by_expert(expert_id: str) -> Optional[Task]:
    for t in _tasks.values():
        if t.expert_id == expert_id:
            return t
    return None

def _set_task_status(task_id: str, status: str) -> bool:
    """Programmatic status update. Validates transitions. Returns True on success."""
    task = _tasks.get(task_id)
    if not task:
        return False
    if status not in VALID_TRANSITIONS.get(task.status, set()):
        return False
    task.status = status
    return True

def _link_expert_to_task(task_id: str, expert_id: str) -> bool:
    """Called by spawn_expert to link a background task to a tracked task."""
    task = _tasks.get(task_id)
    if not task:
        return False
    task.expert_id = expert_id
    task.owner = expert_id.split("-")[1] if "-" in expert_id else expert_id
    task.status = "in_progress"
    return True

def _has_incomplete_tasks() -> bool:
    """Engine gate: true if any task is not done."""
    return any(t.status != "done" for t in _tasks.values())

def _has_blocked_tasks() -> list[str]:
    """Return IDs of tasks whose dependencies aren't met."""
    blocked = []
    for t in _tasks.values():
        if t.status == "done":
            continue
        for dep_id in t.blocked_by:
            dep = _tasks.get(dep_id)
            if dep and dep.status != "done":
                blocked.append(t.id)
                break
    return blocked


def _exhausted_expert_retries() -> list[tuple[str, int]]:
    """Return list of (task_id, expert_type) where expert failed twice."""
    result = []
    for t in _tasks.values():
        if t.status == "done" or t.expert_failures >= 2:
            continue
        if t.expert_failures > 0 and t.owner and t.owner != "agent":
            result.append((t.id, t.owner))
    return result

def _task_status_summary() -> str:
    """One-line summary for injection into engine context."""
    if not _tasks:
        return ""
    done = sum(1 for t in _tasks.values() if t.status == "done")
    total = len(_tasks)
    pending = [t for t in _tasks.values() if t.status != "done"]
    lines = [f"任务进度: {done}/{total}"]
    for t in sorted(pending, key=lambda x: int(x.id.split("-")[0])):
        icon = {"pending": "⬜", "in_progress": "🔄"}.get(t.status, "  ")
        owner = f" [{t.owner}]" if t.owner else ""
        fail = f" (专家已失败{t.expert_failures}次)" if t.expert_failures > 0 else ""
        lines.append(f"  [{t.id}] {icon} {t.subject}{owner}{fail}")
    return "\n".join(lines)

def reset_tasks():
    """Reset task store for new session."""
    import logging, traceback
    _log = logging.getLogger("agent.engine")
    stack = traceback.format_stack()[-4:-1]  # 3 frames: caller, caller's caller, reset_tasks
    _log.warning("reset_tasks() called! Stack: %s", " ← ".join(s.strip() for s in stack))
    _tasks.clear()
    _counter[0] = 0
    global _session_slug
    _session_slug = uuid.uuid4().hex[:4]


# --- Tool-callable functions (AI-facing) ---

def _format_tasks() -> str:
    if not _tasks:
        return "(no tasks)"
    lines = []
    for t in sorted(_tasks.values(), key=lambda x: int(x.id.split("-")[0])):
        icon = {"pending": "⬜", "in_progress": "🔄", "done": "✅"}.get(t.status, "  ")
        deps = ""
        if t.blocked_by:
            deps = f" (等待: {', '.join(t.blocked_by)})"
        owner = f" [{t.owner}]" if t.owner else ""
        fail = f" (专家失败{t.expert_failures}次)" if t.expert_failures > 0 else ""
        lines.append(f"  [{t.id}] {icon} {t.subject}{owner}{deps}{fail}")
    return "\n".join(lines)


@tool(
    name="task_create",
    description="Create a task to track progress. Use before spawning experts or starting complex work. Plan first, then execute.",
    parameters={
        "type": "object",
        "properties": {
            "subject": {"type": "string", "description": "Short task title (imperative form)"},
            "description": {"type": "string", "description": "What needs to be done, expected output"},
            "blocks": {"type": "array", "items": {"type": "string"}, "description": "Task IDs that depend on this task"},
            "blocked_by": {"type": "array", "items": {"type": "string"}, "description": "Task IDs that must complete first"},
        },
        "required": ["subject"],
    }
)
def task_create(subject: str, description: str = "", blocks: list[str] = None, blocked_by: list[str] = None) -> str:
    task = Task(
        id=Task.next_id(),
        subject=subject,
        description=description,
        blocks=blocks or [],
        blocked_by=blocked_by or [],
    )
    _tasks[task.id] = task

    # Update reverse dependencies
    for bid in task.blocks:
        if bid in _tasks:
            if task.id not in _tasks[bid].blocked_by:
                _tasks[bid].blocked_by.append(task.id)
    for bid in task.blocked_by:
        if bid in _tasks:
            if task.id not in _tasks[bid].blocks:
                _tasks[bid].blocks.append(task.id)

    blocked_warn = ""
    blocked_ids = _has_blocked_tasks()
    if task.id in blocked_ids:
        unmet = [f"[{b}]" for b in task.blocked_by if b in _tasks and _tasks[b].status != "done"]
        blocked_warn = f"\n⚠️ 此任务被阻塞，等待: {', '.join(unmet)}"

    return f"Task [{task.id}] created: {subject}{blocked_warn}\n{_format_tasks()}"


@tool(
    name="task_update",
    description="Update a task's status or dependencies. Mark in_progress when starting, done when finished.",
    parameters={
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "Task ID to update"},
            "status": {"type": "string", "enum": ["pending", "in_progress", "done"], "description": "New status"},
            "add_blocks": {"type": "array", "items": {"type": "string"}, "description": "Task IDs that this task now blocks"},
            "add_blocked_by": {"type": "array", "items": {"type": "string"}, "description": "Task IDs this task now depends on"},
        },
        "required": ["task_id"],
    }
)
def task_update(task_id: str, status: str = "", add_blocks: list[str] = None, add_blocked_by: list[str] = None) -> str:
    if task_id not in _tasks:
        return (
            f"❌ Task [{task_id}] 不存在！任务列表中没有此项。\n"
            f"⚠️ 可能原因: 1) 这是旧会话中的 task_id，任务存储已重置 2) 你还没创建此任务。\n"
            f"👉 请先调用 task_create 创建新任务，不要使用历史消息中看到的旧 task_id。\n"
            f"{_format_tasks()}"
        )

    task = _tasks[task_id]
    msgs = []

    if status:
        if not _set_task_status(task_id, status):
            msgs.append(f"状态转换无效: {task.status} → {status}")
        else:
            icon = {"pending": "⬜", "in_progress": "🔄", "done": "✅"}.get(status, "")
            msgs.append(f"Task [{task_id}] → {icon} {status}")

    for bid in (add_blocks or []):
        if bid not in task.blocks:
            task.blocks.append(bid)
        if bid in _tasks and task_id not in _tasks[bid].blocked_by:
            _tasks[bid].blocked_by.append(task_id)

    for bid in (add_blocked_by or []):
        if bid not in task.blocked_by:
            task.blocked_by.append(bid)
        if bid in _tasks and task_id not in _tasks[bid].blocks:
            _tasks[bid].blocks.append(task_id)

    return "\n".join(msgs) + f"\n{_format_tasks()}" if msgs else _format_tasks()


@tool(
    name="task_list",
    description="Show all current tasks with status and dependencies. Review before claiming completion.",
    parameters={"type": "object", "properties": {}}
)
def task_list() -> str:
    if not _tasks:
        return "(no tasks yet — use task_create to plan work)"
    done = sum(1 for t in _tasks.values() if t.status == "done")
    total = len(_tasks)
    blocked = _has_blocked_tasks()
    lines = [f"进度: {done}/{total} 已完成"]
    if blocked:
        lines.append(f"⚠️ {len(blocked)} 个任务被阻塞: {', '.join(f'[{b}]' for b in blocked)}")
    lines.append(_format_tasks())
    return "\n".join(lines)
