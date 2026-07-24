"""
Spawn expert tool - main agent uses this to delegate work to specialized sub-agents.

Key features:
- Background execution: experts run as async tasks, main agent continues immediately
- Model routing: simple tasks → fast model, complex tasks → smart model
- No recursive spawning: experts cannot spawn sub-experts
- Results injected into context on completion
"""
import asyncio
import os
import re
import sys
import threading
import time as _time
import uuid
from typing import Optional
from agent.tool_registry import tool

# Module-level references, set by repl.py during init
_llm = None
_skill_registry = None
_agent_registry = None  # AgentRegistry for agent definitions
_settings = None
_init_source = ""  # records which resolution path succeeded (for diagnostics)

# Completion queue — single producer (done callback), single consumer (engine).
# No scattered collection logic — this is the ONLY path for expert results.
_result_queue: asyncio.Queue = asyncio.Queue()

# --- Expert task state management ---

class ExpertTaskState:
    """Single source of truth for one expert's lifecycle.
    All state lives here — no scattered dicts that can get out of sync."""
    __slots__ = ('id', 'type', 'task_desc', 'async_task', 'queue', 'start_time', 'result', 'success', 'killed', 'done_event')

    def __init__(self, expert_id: str, expert_type: str, task_desc: str,
                 async_task: asyncio.Task, queue: asyncio.Queue):
        self.id = expert_id
        self.type = expert_type
        self.task_desc = task_desc
        self.async_task = async_task
        self.queue = queue
        self.start_time = asyncio.get_event_loop().time()
        self.result = None
        self.success = None  # None = running, bool = finished
        self.killed = False  # True if explicitly terminated via kill_expert
        self.done_event = asyncio.Event()  # set when expert finishes


# All active experts keyed by expert_id. A task is "pending" as long as it
# appears here. collect_background_results() removes completed entries atomically.
_active_experts: dict[str, ExpertTaskState] = {}

# Legacy mirrors for backward compat (drain_expert_events, old callers)
_expert_queues: dict[str, asyncio.Queue] = {}
_expert_start_times: dict[str, float] = {}
_background_tasks: dict = {}  # write-only mirror: keys mirror _active_experts

# Experts running longer than this are considered stale/dead (likely hung below asyncio level).
EXPERT_STALE_TIMEOUT = 600


def _analyze_expert_result(result) -> bool:
    """Check if expert result indicates success or failure.

    Only trusts structured ExpertRunResult (set by the expert run loop).
    Any other type (string, None, etc.) is treated as failure — we cannot
    reliably infer success from unstructured text.
    """
    from agent.sub_agents.base import ExpertRunResult
    if isinstance(result, ExpertRunResult):
        return result.success
    return False  # unstructured results are untrusted → treat as failure


def _update_task_for_expert_finish(expert_id: str, expert_type: str, success: bool, summary: str):
    """Update the linked Task object with expert result. Task is the authoritative
    business-layer state; ExpertTaskState is execution-layer only.

    Safety: only updates the task whose expert_id matches the given expert_id.
    This prevents state from leaking between experts when a task_id is reused.
    """
    try:
        from tools.core.task_tools import _find_task_by_expert
        task = _find_task_by_expert(expert_id)
        if task is None:
            return  # no linked task, nothing to update
        if success:
            task.status = "done"
        else:
            task.expert_failures += 1
        task.result_summary = summary
    except Exception:
        pass

# Per-expert event queues for real-time progress streaming to UI
_expert_queues: dict[str, asyncio.Queue] = {}

# Cached LLM providers per model (avoids creating new httpx clients)
_model_cache: dict[str, object] = {}


def set_expert_dependencies(llm, skill_registry, settings=None, agent_registry=None):
    """Called by repl.py to inject dependencies."""
    global _llm, _skill_registry, _settings, _init_source, _agent_registry
    _llm = llm
    _skill_registry = skill_registry
    _agent_registry = agent_registry
    _settings = settings
    _init_source = "set_expert_dependencies() — direct injection from agent init"

    # Log validation status at startup so we know immediately if something's wrong
    status = validate_expert_system()
    if status["ready"]:
        import logging
        _log = logging.getLogger(__name__)
        _log.info("Expert system ready: %s, model=%s, tools=%d, agents=%s",
                  status["init_source"], status["llm"]["model"],
                  status["tool_registry"]["count"], list(status["agents"].keys()))
    else:
        import logging
        _log = logging.getLogger(__name__)
        _log.warning("Expert system NOT ready: %s", status["issues"])


def validate_expert_system() -> dict:
    """Return a detailed diagnostic report of the expert subsystem state.

    This is the single source of truth for whether experts are operational.
    Call at startup (logged) or via GET /api/expert-status (on-demand).
    """
    llm, tool_registry, agent_registry = _get_or_create_deps()

    # --- LLM status ---
    llm_status = {}
    if llm is None:
        llm_status = {"available": False, "model": None, "provider": None}
    else:
        provider_type = type(llm).__name__
        model = getattr(llm, 'model', 'unknown')
        api_base = getattr(llm, '_api_base', '') or ''
        # Redact key prefixes for safe logging
        api_key = getattr(llm, '_api_key', '') or ''
        has_key = bool(api_key and len(api_key) > 4)
        llm_status = {
            "available": True,
            "model": model,
            "provider": provider_type,
            "has_api_key": has_key,
            "api_base": api_base[:80] if api_base else "(default)",
        }

    # --- Tool registry status ---
    tool_status = {}
    if tool_registry is None:
        tool_status = {"available": False, "count": 0, "agent_tools": {}}
    else:
        all_tools = tool_registry.list_all()
        tool_status = {
            "available": True,
            "count": len(all_tools),
            "agent_tools": {},
        }
        agent_defs = agent_registry.list_all() if agent_registry else []
        for agent_def in agent_defs:
            missing = [t for t in agent_def.tools if t not in {x.name for x in all_tools}]
            tool_status["agent_tools"][agent_def.name] = {
                "required": len(agent_def.tools),
                "registered": len(agent_def.tools) - len(missing),
                "missing": missing,
            }

    # --- Agent/Expert status ---
    agents_status = {}
    agent_defs = agent_registry.list_all() if agent_registry else []
    for agent_def in agent_defs:
        agents_status[agent_def.name] = {
            "prompt_loaded": bool(agent_def.system_prompt),
            "prompt_length": len(agent_def.system_prompt) if agent_def.system_prompt else 0,
            "tool_count": len(agent_def.tools),
            "model_tier": agent_def.model_tier,
            "model": (getattr(_settings, f'{agent_def.model_tier}_model', '') if _settings else '')
                     or getattr(llm, 'model', 'unknown'),
        }

    # --- Running / completed tasks (read-only, no pop) ---
    try:
        running_loop = asyncio.get_event_loop()
    except RuntimeError:
        running_loop = None
    if running_loop is not None:
        running = []
        completed = []
        for task_id, es in list(_active_experts.items()):
            elapsed = running_loop.time() - es.start_time if es.start_time else 0
            entry = {
                "task_id": task_id,
                "type": es.type,
                "done": es.success is not None or es.async_task.done(),
                "elapsed_s": round(elapsed, 1),
            }
            if es.success is not None:
                entry["success"] = es.success
                entry["result_preview"] = str(es.result or "")[:120]
                completed.append(entry)
            elif es.async_task.done():
                entry["success"] = False
                entry["result_preview"] = str(es.result or "")[:120]
                completed.append(entry)
            else:
                running.append(entry)
    else:
        running = []
        completed = []

    # --- Model cache ---
    cached_models = list(_model_cache.keys())

    # --- Final verdict ---
    ready = bool(llm and tool_registry and llm_status.get("has_api_key"))
    issues = []
    if not llm:
        issues.append("No LLM provider available")
    elif not llm_status.get("has_api_key"):
        issues.append("LLM provider has no API key")
    if not tool_registry:
        issues.append("No tool registry available")
    for agent_name, es in agents_status.items():
        if not es["prompt_loaded"]:
            issues.append(f"Agent '{agent_name}' has no system prompt")
        if tool_status.get("agent_tools", {}).get(agent_name, {}).get("missing"):
            issues.append(f"Agent '{agent_name}' missing tools: {tool_status['agent_tools'][agent_name]['missing']}")

    return {
        "ready": ready,
        "issues": issues,
        "init_source": _init_source or "not initialized",
        "llm": llm_status,
        "tool_registry": tool_status,
        "agents": agents_status,
        "running": running,
        "completed_recent": completed,
        "model_cache": cached_models,
    }


def _get_or_create_deps():
    """Try to get LLM/tool_registry from module globals, or auto-discover.

    Resolution order:
    1. Module globals (set by set_expert_dependencies during agent init)
    2. sys.modules scan (any loaded module with _agent attribute)
    3. backend.app._agent (FastAPI web mode)
    4. cli.repl instances (CLI mode)
    5. Bootstrap from _settings (last resort — create new LLM + ToolRegistry)
    """
    global _llm, _skill_registry, _init_source
    global _llm, _skill_registry, _init_source, _agent_registry
    if _agent_registry is not None:
        return _llm, _skill_registry, _agent_registry

    # Try to find deps from any loaded Repl instance in sys.modules
    for mod in list(sys.modules.values()):
        agent = getattr(mod, '_agent', None)
        if agent is None:
            continue
        if hasattr(agent, 'llm') and hasattr(agent, 'skill_registry') and hasattr(agent, 'agent_registry'):
            _llm = agent.llm
            _skill_registry = agent.skill_registry
            _agent_registry = agent.agent_registry
            _init_source = f"sys.modules scan — found agent in {mod.__name__}"
            return _llm, _skill_registry, _agent_registry

    # Try backend's global (web mode)
    try:
        import backend.app as backend_app
        agent = getattr(backend_app, '_agent', None)
        if agent and hasattr(agent, 'llm') and hasattr(agent, 'skill_registry') and hasattr(agent, 'agent_registry'):
            _llm = agent.llm
            _skill_registry = agent.skill_registry
            _agent_registry = agent.agent_registry
            _init_source = "backend.app._agent"
            return _llm, _skill_registry, _agent_registry
    except ImportError:
        pass

    # Try import from cli.repl (CLI mode)
    try:
        import cli.repl as repl_mod
        instances = getattr(repl_mod, '_instances', [])
        for agent in reversed(instances):
            if hasattr(agent, 'llm') and hasattr(agent, 'skill_registry') and hasattr(agent, 'agent_registry'):
                _llm = agent.llm
                _skill_registry = agent.skill_registry
                _agent_registry = agent.agent_registry
                _init_source = "cli.repl._instances"
                return _llm, _skill_registry, _agent_registry
    except ImportError:
        pass

    # Bootstrap from cached settings when all other paths fail.
    # This is the safety net: even if no Repl/agent instance is reachable,
    # we can still create a working LLM provider from the configured model.
    global _settings
    if _settings is not None:
        try:
            from cli.settings import get_active_provider
            from agent.llm_client import create_provider, detect_provider
            import os as _os

            provider_type, api_key, api_base, model, max_tokens = get_active_provider(_settings)
            if not api_key:
                _init_source = "bootstrap failed: no api_key in settings"
                return None, None, None

            pt = detect_provider(api_key, api_base, forced=provider_type)
            _llm = create_provider(pt, api_key, api_base, model, max_tokens)

            project_root = _os.environ.get(
                "ZHANGL_PROJECT_ROOT",
                _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
            )
            from skills.skill_registry import SkillRegistry
            _skill_registry = SkillRegistry()
            _skill_registry.discover_core(_os.path.join(project_root, "tools"))
            from agent.sub_agents.agent_registry import AgentRegistry
            _agent_registry = AgentRegistry()
            _agent_registry.auto_discover(_os.path.join(project_root, "agent", "sub_agents"))
            _init_source = f"bootstrap from _settings — model={model}"

            return _llm, _skill_registry, _agent_registry
        except Exception as e:
            _init_source = f"bootstrap failed: {e}"
            pass

    _init_source = "all paths exhausted, no LLM available"
    return None, None, None


def _get_provider_for_tier(tier: str, base_llm):
    """Get or create an LLM provider for the given model tier.

    Fast tier for simple/read-heavy tasks, smart tier for complex reasoning tasks.

    Priority: settings > env var > default.
    """
    global _settings
    base_model = getattr(base_llm, 'model', 'deepseek-v4-flash')
    if tier == "fast":
        target_model = (
            (getattr(_settings.model, 'small_model', '') if _settings else '')
            or os.environ.get("FAST_MODEL", "")
            or base_model
        )
    else:
        target_model = (
            (getattr(_settings.model, 'smart_model', '') if _settings else '')
            or os.environ.get("SMART_MODEL", "")
            or base_model
        )

    # Same model as main → reuse provider directly (most efficient)
    if target_model == base_model:
        return base_llm

    # Cached provider for this model
    if target_model in _model_cache:
        return _model_cache[target_model]

    from agent.llm_client import create_provider, detect_provider
    api_key = getattr(base_llm, '_api_key', '') or ''
    api_base = getattr(base_llm, '_api_base', '') or ''
    provider_type = detect_provider(api_key, api_base)
    provider = create_provider(
        provider_type,
        api_key=api_key,
        api_base=api_base,
        model=target_model,
        max_tokens=base_llm.max_tokens,
    )
    _model_cache[target_model] = provider
    return provider


@tool(
    name="spawn_expert",
    description="""Delegate to a background expert sub-agent. Non-blocking, returns immediately.
Types: data-analysis-expert(资料分析出题批改), essay-expert(申论批改), practice-expert(行测出题), grading-expert(练习批改).
Include project path and file paths in task.""",
    parameters={
        "type": "object",
        "properties": {
            "type": {
                "type": "string",
                "description": "Agent type to spawn, e.g. 'data-analysis-expert', 'essay-expert', 'practice-expert'"
            },
            "task": {
                "type": "string",
                "description": "Task instruction with full project path and exact file paths. Example: '批改 projects/X/练习/判断推理/2026-05-12.md 的 Q11-Q15'"
            },
        },
        "required": ["type", "task"],
    }
)
async def spawn_expert(type: str, task: str, task_id: str = "") -> str:
    """Start an expert sub-agent in the background. Returns immediately with task ID.

    Background execution — returns immediately, results auto-inject on completion.
    """
    agent_def = _agent_registry.get(type) if _agent_registry else None
    if not agent_def:
        available = [a.name for a in _agent_registry.list_all()] if _agent_registry else []
        return f"Unknown agent: {type}. Available: {available}"

    llm, tool_registry, agent_registry = _get_or_create_deps()
    if llm is None or tool_registry is None:
        status = validate_expert_system()
        diag = "\n".join(f"  - {i}" for i in status["issues"]) if status["issues"] else "unknown"
        return (
            f"spawn_expert 不可用。诊断信息：\n{diag}\n"
            f"初始化来源: {status['init_source']}\n\n"
            "请检查 API key 配置和服务日志。不要重复调用 spawn_expert。"
        )

    from agent.sub_agents.base import ExpertAgent

    prompt = agent_def.system_prompt
    if not prompt:
        return f"No prompt defined for agent: {type}"

    tool_names = agent_def.tools
    model_tier = agent_def.model_tier

    # Route to appropriate model: fast for data/api, smart for code analysis
    expert_llm = _get_provider_for_tier(model_tier, llm)

    # Experts are executors (like Claude Code sub-agents), not orchestrators.
    # Extended thinking is wasted on focused tasks — force disable.
    if hasattr(expert_llm, '_thinking_mode'):
        expert_llm._thinking_mode = "disabled"

    expert = ExpertAgent(
        name=f"{type}-expert",
        system_prompt=prompt,
        tools=tool_names,
        llm=expert_llm,
        tool_registry=tool_registry,
    )

    bg_task_id = f"expert-{type}-{uuid.uuid4().hex[:6]}"
    model_name = getattr(expert_llm, 'model', 'default')

    # Auto-generate a temp output file for this expert so parallel experts
    # never overwrite each other. The main agent merges temps at the end.
    suffix = uuid.uuid4().hex[:8]

    # Try to extract an output file path from the task description.
    # Patterns: test_cases_*.jsonl, cases/*.jsonl, or any path ending in .jsonl
    output_pattern = re.search(r'([\w一-鿿/._-]+\.jsonl)', task)
    if output_pattern:
        orig_path = output_pattern.group(1)
        base, ext = os.path.splitext(orig_path)
        temp_path = f"{base}_{suffix}{ext}"
        modified_task = task.replace(orig_path, temp_path, 1)
    else:
        # No output path found — give a short directive
        modified_task = task + f"\n\n【将输出写入临时文件，文件名加后缀 _{suffix}】"

    # Always create a task for this expert, so the engine's completion gate
    # (_has_incomplete_tasks) can track it. Because spawn_expert is non-blocking
    # and the main agent often confuses task IDs across parallel calls, we
    # ALWAYS auto-create a task rather than relying on the agent to pass the
    # correct task_id.
    # If a valid task_id WAS provided, link to it. Otherwise auto-create.
    task_exists = False
    if task_id:
        try:
            from tools.core.task_tools import _link_expert_to_task, _get_task
            if _get_task(task_id):
                _link_expert_to_task(task_id, bg_task_id)
                task_exists = True
        except Exception:
            pass

    if not task_exists:
        try:
            from tools.core.task_tools import _tasks, Task
            implicit_id = Task.next_id()
            label = task[:40].replace("\n", " ")
            implicit_task = Task(
                id=implicit_id,
                subject=f"[auto] {type}专家: {label}",
                description=task[:200],
                status="in_progress",
                owner=type,
                expert_id=bg_task_id,
            )
            _tasks[implicit_id] = implicit_task
            task_id = implicit_id  # Use for completion delta below
            import logging
            _log = logging.getLogger("agent.engine")
            _log.info("Auto-created implicit task [%s] for expert %s", implicit_id, bg_task_id)
        except Exception as e:
            import logging, traceback
            _log = logging.getLogger("agent.engine")
            _log.error("Auto-create task failed for expert %s: %s\n%s", bg_task_id, e, traceback.format_exc())

    # Create event queue for real-time progress streaming to UI
    event_queue: asyncio.Queue = asyncio.Queue()

    def _on_progress(event: dict):
        """Push expert progress event to queue. Non-blocking — if queue is full, drop."""
        try:
            event_queue.put_nowait(event)
        except asyncio.QueueFull:
            pass

    expert.on_progress = _on_progress

    async def _run_in_background():
        """Execute expert in background. On completion, update ExpertTaskState.
        The done callback (registered below) pushes to _result_queue."""
        from agent.sub_agents.base import ExpertRunResult
        import time as _t_expert
        _spawn_start = _t_expert.monotonic()
        print(f"[SPAWN_BG {_spawn_start:.3f}] {bg_task_id}: _run_in_background entered", flush=True)
        run_result = None
        success = False
        result = ""
        try:
            try:
                run_result = await expert.run(modified_task)
                success = _analyze_expert_result(run_result)
                result = run_result.text if isinstance(run_result, ExpertRunResult) else str(run_result)
                _done_time = _t_expert.monotonic()
                if isinstance(run_result, ExpertRunResult):
                    trs = [(t.name, t.success, t.category, t.summary[:60]) for t in run_result.tool_results]
                    print(f"EXPERT_DONE {_done_time:.3f} {bg_task_id}: success={success}, elapsed={_done_time-_spawn_start:.1f}s, tool_results={trs}", flush=True)
                else:
                    print(f"EXPERT_DONE {_done_time:.3f} {bg_task_id}: success={success}, type={type(run_result).__name__}", flush=True)
            except BaseException as e:
                result = f"[{type}-expert] Fatal: {e}"
                success = False
                _done_time = _t_expert.monotonic()
                print(f"EXPERT_FAIL {_done_time:.3f} {bg_task_id}: {type(e).__name__}: {e}", flush=True)
        finally:
            es = _active_experts.get(bg_task_id)
            killed = es and es.killed

            if not killed:
                if es:
                    es.success = success

                # Collect output file paths from tool results.
                output_files = []
                if run_result and isinstance(run_result, ExpertRunResult):
                    for tr in run_result.tool_results:
                        if tr.success and tr.path:
                            output_files.append(tr.path)

                tid_display = f"[{task_id}]" if task_id else "[auto]"
                if success:
                    files_str = ", ".join(output_files) if output_files else "no files written"
                    summary = f"[{type} 专家完成] 任务 {tid_display} 成功。输出: {files_str}"
                    # Also report notable failures so the main agent can act on them
                    if isinstance(run_result, ExpertRunResult) and run_result.tool_results:
                        failed = [f"{t.name}: {t.summary}" for t in run_result.tool_results if not t.success]
                        if failed:
                            summary += f"。注意: {', '.join(failed[:3])}"
                else:
                    # Derive failure reason from structured info — never leak
                    # raw expert text output into the main agent context.
                    if isinstance(run_result, ExpertRunResult) and run_result.tool_results:
                        failed = [t.name for t in run_result.tool_results if not t.success]
                        if failed:
                            reason = f"工具失败: {', '.join(failed[:3])}"
                        else:
                            reason = "未产出有效结果"
                    elif result and not isinstance(run_result, ExpertRunResult):
                        # Exception path: result is already short (exception message)
                        reason = result[:120]
                    else:
                        reason = "未产出有效结果"
                    summary = f"[{type} 专家失败] 任务 {tid_display} 失败: {reason}"

                if es:
                    es.result = summary

                _update_task_for_expert_finish(bg_task_id, type, success, summary)

    # Launch background task — main agent continues immediately
    bg_async_task = asyncio.create_task(_run_in_background())
    expert_state = ExpertTaskState(bg_task_id, type, task, bg_async_task, event_queue)
    _active_experts[bg_task_id] = expert_state
    _expert_queues[bg_task_id] = event_queue
    _expert_start_times[bg_task_id] = expert_state.start_time
    _background_tasks[bg_task_id] = bg_async_task  # legacy mirror

    # Done callback: fires after task is fully complete (including finally block).
    # Reads es.result/es.success set by _run_in_background's finally block.
    def _on_done(task: asyncio.Task):
        es = _active_experts.get(bg_task_id)
        if es and es.killed:
            return  # killed via kill_expert, result already pushed to queue

        if es and es.success is True:
            _result_queue.put_nowait({
                "id": bg_task_id,
                "result": es.result or "",
                "success": True,
            })
        else:
            preview = (es.result or "未知错误")[:150] if es else "未知错误"
            _result_queue.put_nowait({
                "id": bg_task_id,
                "result": preview,
                "success": False,
            })
        if es:
            es.done_event.set()

    bg_async_task.add_done_callback(_on_done)

    print(f"SPAWN {_time.monotonic():.3f} {bg_task_id}: task_id={task_id}, active={len(_active_experts)}", flush=True)

    return (
        f"✅ 已启动 {type} 专家（模型: {model_name}）\n"
        f"Task ID: [{task_id}] ← 记住此ID，完成后需要验证\n"
        f"任务: {task[:120]}\n"
        f"结果将在完成后自动注入上下文。"
    )


# --- Engine integration ---

# Tracks whether any expert failure was collected but not yet handled.
# Engine uses this as a third hard gate before AgentDone (alongside
# has_pending_tasks and _has_incomplete_tasks).
_unhandled_failure = False
_failure_lock = threading.Lock()


def collect_background_results() -> list[dict]:
    """Drain all completed expert results from the completion queue.

    Single consumer: only engine calls this. Single producer: done callbacks
    push to _result_queue. No polling, no scattered collection paths.
    """
    global _unhandled_failure
    results = []
    while True:
        try:
            item = _result_queue.get_nowait()
            if not item.get("success", False):
                with _failure_lock:
                    _unhandled_failure = True
            print(f"[COLLECT {_time.monotonic():.3f}] Picked up {item['id']}: success={item.get('success', False)}", flush=True)
            results.append(item)
        except asyncio.QueueEmpty:
            break
    return results


def cancel_all_experts():
    """Cancel all running expert background tasks. Called when engine is stopped."""
    for es in list(_active_experts.values()):
        if es.async_task and not es.async_task.done():
            es.async_task.cancel()
    _active_experts.clear()
    # Drain result queue to prevent stale results leaking into new sessions
    while True:
        try:
            _result_queue.get_nowait()
        except asyncio.QueueEmpty:
            break


def drain_expert_events() -> list[dict]:
    """Called by engine each turn. Returns all pending expert progress events
    (tool_start, tool_result) with their task_id attached. Non-blocking."""
    events = []
    for task_id, es in list(_active_experts.items()):
        queue = es.queue
        while True:
            try:
                evt = queue.get_nowait()
                evt["task_id"] = task_id
                events.append(evt)
            except asyncio.QueueEmpty:
                break
    return events


def has_pending_tasks() -> bool:
    """Check if there are any background experts still running.
    Read-only — does NOT modify state."""
    for es in _active_experts.values():
        if es.success is None and not es.async_task.done():
            return True
    return False


async def wait_for_any_expert_completion(timeout: float = 720.0) -> Optional[str]:
    """Wait for any pending expert to finish. Returns the expert_id that completed,
    or None if no pending experts or timeout.

    Event-driven: blocks on asyncio.Event, no polling, zero delay between completion
    and notification.
    """
    pending = [
        es for es in _active_experts.values()
        if es.success is None and not es.async_task.done()
    ]
    if not pending:
        return None

    events = [(es, es.done_event) for es in pending]

    try:
        done_tasks = []
        for es, evt in events:
            done_tasks.append(asyncio.ensure_future(evt.wait()))

        done, pending_waits = await asyncio.wait(
            done_tasks, timeout=timeout, return_when=asyncio.FIRST_COMPLETED
        )

        for t in pending_waits:
            t.cancel()

        if done:
            for es, evt in events:
                if evt.is_set():
                    return es.id
    except Exception:
        pass

    return None


async def wait_for_all_experts_completion(timeout: float = 720.0) -> list[dict]:
    """Wait for ALL pending experts to complete, collecting results as they finish.

    Polls at 0.5s intervals to allow drain_expert_events to be called,
    keeping the UI alive with real-time tool progress. No LLM calls during wait.
    Returns collected results (same format as collect_background_results).
    """
    import time as _t

    deadline = _t.monotonic() + timeout
    collected = []

    while _t.monotonic() < deadline:
        # Check if all experts are done
        pending = [
            es for es in _active_experts.values()
            if es.success is None and not es.async_task.done()
        ]
        if not pending:
            break

        # Short sleep — lets the engine yield back to caller (SSE/UI) between polls
        await asyncio.sleep(0.5)

        # Collect any completed results
        collected.extend(collect_background_results())

    return collected


@tool(
    name="kill_expert",
    description="Kill a running expert task. Resets linked task to pending. Only for active experts, not completed ones.",
    parameters={
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "Task ID to kill (e.g. '8-53bc'). The linked expert will be terminated."
            },
        },
        "required": ["task_id"],
    }
)
def kill_expert(task_id: str) -> str:
    """Terminate a running expert and reset its task to pending."""
    from tools.core.task_tools import _tasks
    task = _tasks.get(task_id)
    if not task:
        return f"任务 [{task_id}] 不存在。用 task_list 查看当前任务。"

    if task.status == "done":
        return f"任务 [{task_id}] 已完成，无需终止。"

    expert_id = task.expert_id or ""
    if not expert_id:
        return f"任务 [{task_id}] 没有关联的专家进程。"

    es = _active_experts.get(expert_id)
    if not es:
        # Expert may have already completed and been collected
        return f"专家 [{expert_id}] 未在运行（可能已完成或已终止）。"

    # 1. Mark killed FIRST — finally block checks this flag before any state write.
    #    Must be set BEFORE cancel() so the flag is visible when finally runs.
    es.killed = True

    # 2. Push kill result to completion queue — engine will consume it.
    kill_summary = f"[{es.type} 专家已终止] 任务 [{task_id}] 被用户手动终止，未完成。"
    es.result = kill_summary
    es.success = False
    _result_queue.put_nowait({
        "id": expert_id,
        "result": kill_summary,
        "success": False,
    })

    # 3. Update Task state immediately
    task.status = "pending"
    task.expert_id = ""
    task.result_summary = kill_summary

    # 4. Cancel the async task — the finally block will see killed=True and skip.
    try:
        es.async_task.cancel()
    except Exception as e:
        pass

    # 5. Clean up expert state
    _expert_queues.pop(expert_id, None)
    _expert_start_times.pop(expert_id, None)
    _background_tasks.pop(expert_id, None)

    return (
        f"已终止专家 [{expert_id}]（类型: {es.type}）\n"
        f"任务 [{task_id}] 状态已重置为 pending，可重新分配。\n"
        f"任务描述: {task.subject[:80]}"
    )


def has_unhandled_failures() -> bool:
    """Check if any expert failure was collected but not yet acted upon."""
    with _failure_lock:
        return _unhandled_failure


def clear_unhandled_failures():
    """Reset failure tracking after engine forces AI to handle them."""
    global _unhandled_failure
    with _failure_lock:
        _unhandled_failure = False
    caller = traceback.extract_stack()[-2]
    print(f"CLEAR_FAIL {_time.monotonic():.3f}: called from {caller.filename.split('/')[-1]}:{caller.lineno}", flush=True)


