from __future__ import annotations
"""
Agent Engine - the core agent loop.
Orchestrates LLM calls + tool execution + context management.
Simple loop, no flail detection, full context, all tools always sent.
"""

import asyncio
import inspect
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable, Optional
from agent.llm_client import LLMProvider, ToolSchema, ToolCall, ResponseChunk
from context.manager import ContextManager
from skills.skill_registry import SkillRegistry
from skills.core.file_ops.tools import set_last_output


MAX_TURNS = 100
MAX_TOOL_CALLS_PER_TURN = 20
TOOL_TIMEOUT = 120        # Per-tool timeout (2 min); most tools <1s
FILE_WRITE_CONCURRENCY = 4  # Max concurrent file writes (prevents contention)
LLM_MAX_RETRIES = 3       # Max LLM retry attempts per turn
RETRY_BACKOFF_WAIT = 1    # Seconds to wait between truncated turn retries
EMERGENCY_TAIL_TURNS = 4  # Number of recent messages to keep during emergency truncation


def _load_thinking_turns() -> int:
    try:
        from cli.settings import load_settings
        return load_settings().model.expert_thinking_turns
    except Exception:
        return 2


def _has_incomplete_tasks() -> bool:
    """Check if the task list has any non-done tasks. The primary completion gate."""
    try:
        from tools.core.task_tools import _has_incomplete_tasks as _hit
        return _hit()
    except Exception:
        import sys
        print("[engine] _has_incomplete_tasks failed — assuming no tasks", file=sys.stderr, flush=True)
        return False


def _is_context_length_error(err_msg: str) -> bool:
    """Detect context-too-long errors across different API providers."""
    msg = err_msg.lower()
    return any(kw in msg for kw in (
        "context_length_exceeded",
        "context length",
        "too long",
        "maximum context",
        "max_tokens",
        "reduce the length",
        # Specific token-related length patterns (not generic "token" errors)
        "exceeds token",
        "token limit",
        "too many tokens",
        "token budget",
        "token count",
    ))


def _is_transient_error(err_msg: str) -> bool:
    """Detect transient/retriable LLM errors (rate limits, timeouts, server errors)."""
    msg = err_msg.lower()
    return any(kw in msg for kw in (
        "rate limit", "rate_limit", "too many requests", "429",
        "timeout", "timed out", "connection reset", "connection error",
        "server error", "503", "502", "internal server",
        "overloaded", "capacity", "service unavailable", "bad gateway",
        "try again", "retry",
    ))


def _is_auth_error(err_msg: str) -> bool:
    """Detect auth errors (401, 403) — not retriable, stop immediately."""
    msg = err_msg.lower()
    return any(kw in msg for kw in (
        "401", "403", "invalid_api_key", "invalid api key",
        "invalid access token", "token expired", "unauthorized",
        "authentication", "forbidden", "permission",
    ))


def _is_bad_request(err_msg: str) -> bool:
    """Detect 400 bad request errors — malformed context, not retriable."""
    msg = err_msg.lower()
    return any(kw in msg for kw in (
        "400", "bad_request", "invalid_request_error",
        "tool_use", "tool_result",  # orphaned tool_use blocks
    ))


@dataclass
class AgentEvent:
    """Base event emitted during agent execution."""
    pass


@dataclass
class TextDelta(AgentEvent):
    content: str


@dataclass
class ToolCallStart(AgentEvent):
    name: str
    arguments: dict
    expert_id: str = ""  # non-empty when from a background expert


@dataclass
class ToolCallResult(AgentEvent):
    name: str
    arguments: dict
    result: str
    expert_id: str = ""  # non-empty when from a background expert


@dataclass
class AgentThinking(AgentEvent):
    """Agent is thinking/reasoning (not streaming text)."""
    content: str = ""


@dataclass
class AgentDone(AgentEvent):
    usage: Optional[dict] = None


@dataclass
class AgentError(AgentEvent):
    message: str


class AgentEngine:
    def __init__(
        self,
        llm_provider: LLMProvider,
        tool_registry: SkillRegistry,
        system_prompt: str,
        context_manager: Optional[ContextManager] = None,
    ):
        self.llm = llm_provider
        self.tools = tool_registry
        self.system_prompt = system_prompt
        self.ctx = context_manager or ContextManager(keep_thinking_turns=_load_thinking_turns())
        self._initialized = False
        self._cancel_event: Optional[asyncio.Event] = None
        # Shared thread pool for sync tools
        self._executor = ThreadPoolExecutor(max_workers=8)
        # Semaphore to prevent file write contention (deadlock prevention)
        self._file_semaphore = asyncio.Semaphore(FILE_WRITE_CONCURRENCY)
        # Track last tool result for dedup — prevents context bloat from
        # repeated task_list / list_files calls with identical results.
        self._last_tool_sig: set[str] = set()
        self._last_tool_result: dict[str, str] = {}
        self._MAX_RESULT_CACHE = 50  # prevent unbounded memory growth in long sessions
        self._waiting_yielded: bool = False  # track if waiting message already shown

    def shutdown(self):
        """Release resources: thread pool, cancel pending tasks."""
        self._executor.shutdown(wait=False)

    def cancel(self):
        """Signal the running agent loop to stop."""
        if self._cancel_event:
            self._cancel_event.set()
        # Cancel any running expert background tasks
        try:
            from tools.core.spawn_expert import cancel_all_experts
            cancel_all_experts()
        except Exception:
            pass

    def _is_cancelled(self) -> bool:
        return self._cancel_event is not None and self._cancel_event.is_set()

    def _fix_orphaned_tool_uses(self) -> bool:
        """Remove ALL orphaned tool messages in both directions.

        Case A: assistant message has tool_calls but no matching tool_results
        (turn cancelled mid-stream). Remove the assistant message.

        Case B: tool_result message has no matching tool_use in any assistant
        message (context corrupted from resume/truncation). Remove the tool_result.

        Returns True if any fixes were applied.
        """
        fixed = False
        msgs = self.ctx.messages

        # ── Case A: orphaned tool_uses (assistant without results) ──
        changed = True
        while changed:
            changed = False
            for i in range(len(msgs) - 1, -1, -1):
                m = msgs[i]
                if m.get("role") != "assistant" or not m.get("tool_calls"):
                    continue
                tc_ids = {tc["id"] for tc in m["tool_calls"]}
                found_ids = set()
                for j in range(i + 1, len(msgs)):
                    if msgs[j].get("role") == "tool":
                        tid = msgs[j].get("tool_call_id", "")
                        if tid in tc_ids:
                            found_ids.add(tid)
                    else:
                        break
                if found_ids != tc_ids:
                    msgs.pop(i)
                    fixed = True
                    changed = True

        # ── Case B: orphaned tool_results (result without tool_use) ──
        all_tc_ids = set()
        for m in msgs:
            if m.get("role") == "assistant" and m.get("tool_calls"):
                for tc in m["tool_calls"]:
                    all_tc_ids.add(tc["id"])
        if all_tc_ids:
            changed = True
            while changed:
                changed = False
                for i in range(len(msgs) - 1, -1, -1):
                    if msgs[i].get("role") == "tool":
                        tid = msgs[i].get("tool_call_id", "")
                        if tid and tid not in all_tc_ids:
                            msgs.pop(i)
                            fixed = True
                            changed = True

        return fixed

    @staticmethod
    def _tool_sig(tc: ToolCall) -> str:
        """Compact signature: tool name + first 80 chars of args. Used to detect repeat calls."""
        args_str = json.dumps(tc.arguments, ensure_ascii=False, sort_keys=True)
        return f"{tc.name}:{args_str[:80]}"

    def _ensure_init(self):
        """Lazy init: add system prompt as first message.

        When resuming a session, the context already has a system message
        from the saved history. Don't duplicate it.
        """
        if self._initialized:
            return
        if self.ctx.messages and self.ctx.messages[0].get("role") == "system":
            self._initialized = True
            return
        self.ctx.add_message({"role": "system", "content": self.system_prompt})
        self._initialized = True

    async def run(self, user_input: str | list[dict]) -> AsyncIterator[AgentEvent]:
        """Main agent loop. Simple: add user message, loop until done or MAX_TURNS."""
        self._ensure_init()
        self._cancel_event = asyncio.Event()

        # Auto-match skills by semantic similarity (Claude Code style).
        # Injected as system message so instructions stay at the same level
        # as the main prompt, not mixed with user input.
        if isinstance(user_input, str) and hasattr(self.tools, 'get_matched_skill_bodies'):
            skill_context = self.tools.get_matched_skill_bodies(user_input)
            if skill_context:
                import sys as _sys
                print(f"[engine] auto-injected skills: {len(skill_context)} chars", file=_sys.stderr, flush=True)
                self.ctx.add_message({"role": "system", "content": skill_context, "_skill": True})

        self.ctx.add_message({"role": "user", "content": user_input})

        # Track recent tool signatures to avoid counting repeats
        recent_sigs: set[str] = set()
        notified_experts: set[str] = set()  # Track expert IDs already notified to avoid duplicates
        productive_turns = 0
        turn = 0
        consecutive_llm_failures = 0

        while productive_turns < MAX_TURNS:
            turn += 1
            stale_warned_this_turn = False
            if self._is_cancelled():
                yield AgentError(message="已停止")
                return

            # Safety net: if approaching turn limit, inject a hint to wrap up
            if productive_turns == MAX_TURNS - 10:
                hint = "\n\n[注意：已接近步骤上限，请在当前回合内完成任务或简化方案，不要重复之前失败的操作。]"
                self.ctx.add_message({"role": "user", "content": hint})

            try:
                # Drain expert progress events → real-time UI updates
                from tools.core.spawn_expert import drain_expert_events
                for evt in drain_expert_events():
                    if evt["type"] == "tool_start":
                        yield ToolCallStart(
                            name=evt["name"], arguments=evt.get("args", {}),
                            expert_id=evt.get("task_id", ""),
                        )
                    elif evt["type"] == "tool_result":
                        yield ToolCallResult(
                            name=evt["name"], arguments={},
                            result=evt.get("result", ""),
                            expert_id=evt.get("task_id", ""),
                        )

                # Collect completed background expert results
                from tools.core.spawn_expert import collect_background_results
                import time as _t_collect
                _ct = _t_collect.monotonic()
                collected = list(collect_background_results())
                if collected:
                    print(f"[ENGINE_COLLECT {_ct:.3f}] turn={turn}, picked up {len(collected)} results: {[b['id'] for b in collected]}", flush=True)
                for bg in collected:
                    eid = bg.get("id", "")
                    if eid in notified_experts:
                        continue  # already yielded (success or failure)
                    notified_experts.add(eid)
                    ok = bg.get("success", False)
                    status = "成功" if ok else "失败"
                    result_text = bg.get('result', '')
                    self.ctx.add_message({
                        "role": "user",
                        "content": f"[后台任务 {eid} {status}]\n\n{result_text}",
                    })
                    if ok:
                        # Brief progress: X/Y experts done
                        try:
                            from tools.core.task_tools import _tasks
                            done_n = sum(1 for t in _tasks.values() if t.status == "done")
                            yield TextDelta(content=f"\n> 子任务完成 ({done_n}/{len(_tasks)})\n")
                        except Exception:
                            yield TextDelta(content=f"\n> 子任务已完成\n")
                    else:
                        yield TextDelta(content=f"\n> ⚠️ 子任务执行失败，请重试\n")

                # Proactive compression before each turn
                await self.ctx.maybe_compress(self.llm)

                # Repair any orphaned tool_use blocks from cancelled turns.
                # Cancelling mid-stream leaves assistant messages with tool_calls
                # but no tool_results — the API returns 400. Fix BEFORE calling LLM.
                self._fix_orphaned_tool_uses()

                messages = self.ctx.get_messages()
                tools = self.tools.list_all()  # All tools, every turn — cache-friendly
                tools_schemas = [t.to_schema() for t in tools]

                text_buffer = ""
                tool_calls_acc: list[ToolCall] = []
                thinking_text = ""       # Merged thinking text (avoids micro-blocks)
                thinking_signature = ""  # Last seen signature

                # LLM call with retry for transient errors.
                # Context errors → compress/truncate and retry.
                # Transient errors (rate limit, timeout, 5xx) → backoff and retry.
                # All failures eventually go back into context so AI can self-correct.
                llm_ok = False
                last_err = ""
                max_llm_retries = LLM_MAX_RETRIES

                for llm_attempt in range(max_llm_retries + 1):
                    try:
                        async for chunk in self.llm.chat(
                            messages=messages,
                            tools=tools_schemas,
                            stream=True,
                        ):
                            if chunk.text:
                                text_buffer += chunk.text
                                yield TextDelta(content=chunk.text)

                            if chunk.thinking:
                                thinking_text += chunk.thinking
                                thinking_signature = chunk.thinking_signature or thinking_signature
                                yield AgentThinking(content=chunk.thinking)

                            if chunk.tool_call:
                                tool_calls_acc = self._merge_tool_calls(tool_calls_acc, chunk.tool_call)

                            if chunk.is_done and not chunk.thinking:
                                break
                        llm_ok = True
                        break

                    except Exception as e:
                        last_err = str(e)
                        import time as _time
                        # Log exception type + repr for debugging (str(e) can be empty)
                        print(f"[ENGINE_ERROR] {_time.monotonic():.3f}: LLM call failed: type={type(e).__name__}, err={last_err[:300]!r}", flush=True)

                        # Context length: compress first, then hard truncate, then ultra-truncate
                        if _is_context_length_error(last_err):
                            yield TextDelta(content="\n\n> 上下文过长，正在自动压缩...\n\n")
                            compressed = await self.ctx.maybe_compress(self.llm, force=True)
                            if compressed:
                                messages = self.ctx.get_messages()
                                yield TextDelta(content="[压缩完成，正在重试...]\n")
                                continue

                            # Compression didn't help — emergency hard truncation.
                            # Must protect tool_use/tool_result pairs to avoid API 400.
                            system_msgs = [m for m in self.ctx.messages if m["role"] == "system"]
                            non_system = [m for m in self.ctx.messages if m["role"] != "system"]
                            keep_count = EMERGENCY_TAIL_TURNS

                            def _safe_tail(msgs, keep):
                                """Take last N messages, expanding to cover orphaned tool_results."""
                                tail = msgs[-keep:]
                                # Collect all tool_call_ids in the tail's assistant messages
                                tool_ids_in_tail = set()
                                for m in tail:
                                    if m["role"] == "assistant" and m.get("tool_calls"):
                                        for tc in m["tool_calls"]:
                                            tool_ids_in_tail.add(tc["id"])
                                # Check if any tool_result in tail references a tool_call NOT in tail
                                # (i.e., its tool_use was truncated away)
                                orphaned = False
                                for m in tail:
                                    if m["role"] == "tool" and m.get("tool_call_id"):
                                        if m["tool_call_id"] not in tool_ids_in_tail:
                                            orphaned = True
                                            break
                                if not orphaned:
                                    return tail
                                # Need to pull back messages until all tool_results have matching tool_uses
                                start_idx = len(msgs) - keep
                                # Walk back to find the assistant that holds the orphaned tool_use
                                for idx in range(start_idx - 1, -1, -1):
                                    m = msgs[idx]
                                    if m["role"] == "assistant" and m.get("tool_calls"):
                                        for tc in m["tool_calls"]:
                                            if any(
                                                t.get("tool_call_id") == tc["id"]
                                                for t in tail if t["role"] == "tool"
                                            ):
                                                return msgs[idx:]
                                return tail  # fallback

                            if len(non_system) > keep_count:
                                safe_tail = _safe_tail(non_system, keep_count)
                                self.ctx.messages = system_msgs + safe_tail
                                # Clear summary since we just lost old context
                                self.ctx._summary = ""
                                messages = self.ctx.get_messages()
                                yield TextDelta(content="[截断旧消息，1s 后重试...]\n")
                                await asyncio.sleep(RETRY_BACKOFF_WAIT)
                                continue

                            # Still too long — ultra truncation (system + last 1 only)
                            if len(non_system) > 1:
                                self.ctx.messages = system_msgs + [non_system[-1]]
                                self.ctx._summary = ""
                                messages = self.ctx.get_messages()
                                yield TextDelta(content="[深度截断，1s 后重试...]\n")
                                await asyncio.sleep(RETRY_BACKOFF_WAIT)
                                continue

                            # Even system + last message too long → fatal, cannot continue
                            yield TextDelta(content="\n\n> 上下文无法进一步压缩，上下文过长。请精简系统提示词或减少单次任务的数据量。\n\n")
                            yield AgentError(message=f"上下文超长，无法继续：{last_err[:200]}")
                            return

                        # Auth errors (401, 403) — stop immediately, no retry
                        if _is_auth_error(last_err):
                            yield TextDelta(content="\n\n> API 认证失败，请检查 API Key 是否正确或已过期。\n\n")
                            yield AgentError(message=f"API 认证失败：{last_err[:200]}")
                            return

                        # Bad request (400) — context format error, not retriable.
                        # Proactive fix runs before each LLM call, so this is a fallback.
                        if _is_bad_request(last_err):
                            if self._fix_orphaned_tool_uses():
                                messages = self.ctx.get_messages()
                                yield TextDelta(content=f"\n\n> 遇到中断残留，正在恢复上下文...\n\n")
                                await asyncio.sleep(RETRY_BACKOFF_WAIT)
                                continue  # retry LLM with fixed context
                            yield TextDelta(content="\n\n> 请求格式错误，无法继续。请调整任务描述或简化请求后重试。\n\n")
                            yield AgentError(message=f"请求错误：{last_err[:200]}")
                            return

                        # Transient error: exponential backoff retry
                        if _is_transient_error(last_err) and llm_attempt < LLM_MAX_RETRIES:
                            wait = 2 ** llm_attempt
                            yield TextDelta(content=f"\n\n> AI 服务暂时不可用，{wait}s 后重试...\n\n")
                            await asyncio.sleep(wait)
                            continue

                        # Non-retriable error — fall through to error injection
                        break

                if not llm_ok:
                    consecutive_llm_failures += 1
                    if consecutive_llm_failures >= 5:
                        yield TextDelta(content=f"\n\n> AI 服务连续响应失败 {consecutive_llm_failures} 次，已停止。请检查 API 配置或网络连接。\n\n")
                        yield AgentError(message=f"AI 服务连续失败 {consecutive_llm_failures} 次：{last_err[:200]}")
                        return
                    # Inject progressively stronger hints with each failure
                    if consecutive_llm_failures == 1:
                        hint = (
                            f"[系统提示] AI 调用失败：{last_err[:200]}。"
                            "请根据此错误调整策略——减少并发工具调用、简化任务。"
                        )
                    elif consecutive_llm_failures == 2:
                        hint = (
                            f"[系统提示] AI 调用再次失败（第2次）：{last_err[:200]}。"
                            "请认真检查任务规划——可能存在重复调用或无效工具使用。"
                        )
                    else:
                        hint = (
                            f"[系统提示] AI 调用持续失败（第{consecutive_llm_failures}次）：{last_err[:200]}。"
                            "强烈建议：放弃当前方案，尝试完全不同的途径，或向用户说明遇到的问题。"
                        )
                    self.ctx.add_message({"role": "user", "content": hint})
                    wait_s = min(2 ** (consecutive_llm_failures - 1), 10)
                    yield TextDelta(content=f"\n\n> AI 服务暂不可用，{wait_s}s 后重试...\n\n")
                    await asyncio.sleep(wait_s)
                    continue
                consecutive_llm_failures = 0

                if not tool_calls_acc:
                    # Check for pending background expert tasks before finishing.
                    from tools.core.spawn_expert import has_pending_tasks, collect_background_results

                    if has_pending_tasks():
                        got_results = False
                        for bg in collect_background_results():
                            ok = bg.get("success", False)
                            status = "成功" if ok else "失败"
                            self.ctx.add_message({
                                "role": "user",
                                "content": f"[后台任务 {bg['id']} {status}]\n\n{bg.get('result', '')}",
                            })
                            if ok:
                                yield TextDelta(content=f"\n> 后台专家 {bg['id']} 已完成\n")
                            else:
                                yield TextDelta(content=f"\n> ⚠️ 后台专家 {bg['id']} 执行失败！请检查并重试\n")
                            got_results = True
                        if got_results:
                            continue

                        # No results yet — poll locally WITHOUT calling LLM
                        if not self._waiting_yielded:
                            yield TextDelta(content="\n> 后台专家正在工作中...\n")
                            self._waiting_yielded = True

                        # Show expert tool progress in real-time during wait
                        from tools.core.spawn_expert import drain_expert_events as _drain_events

                        # Staggered polling: frequent at first, then back off.
                        # Total wait window: ~12 minutes.
                        for interval, count in [
                            (3, 10),    # 10 × 3s = 30s, fast phase
                            (6, 10),    # 10 × 6s = 60s, medium phase
                            (15, 4),    #  4 × 15s = 60s, slow phase
                            (60, 10),   # 10 × 60s = 600s, idle phase
                        ]:
                            for _ in range(count):
                                if not has_pending_tasks():
                                    break
                                await asyncio.sleep(interval)
                                # Stream real-time expert progress to UI
                                for evt in _drain_events():
                                    if evt.get("type") == "tool_start":
                                        yield ToolCallStart(
                                            name=evt["name"], arguments=evt.get("args", {}),
                                            expert_id=evt.get("task_id", ""),
                                        )
                                    elif evt.get("type") == "tool_result":
                                        yield ToolCallResult(
                                            name=evt["name"], arguments={},
                                            result=evt.get("result", ""),
                                            expert_id=evt.get("task_id", ""),
                                        )
                                for bg in collect_background_results():
                                    got_results = True
                                    ok = bg.get("success", False)
                                    status = "成功" if ok else "失败"
                                    self.ctx.add_message({
                                        "role": "user",
                                        "content": f"[后台任务 {bg['id']} {status}]\n\n{bg.get('result', '')}",
                                    })
                                    if ok:
                                        yield TextDelta(content=f"\n> 后台专家已完成\n")
                                    else:
                                        yield TextDelta(content=f"\n> ⚠️ 后台专家执行失败！请检查并重试\n")
                            if got_results or not has_pending_tasks():
                                break

                        if got_results:
                            continue

                        # Final sweep — catch anything that arrived after last poll
                        for evt in _drain_events():
                            if evt.get("type") == "tool_start":
                                yield ToolCallStart(
                                    name=evt["name"], arguments=evt.get("args", {}),
                                    expert_id=evt.get("task_id", ""),
                                )
                            elif evt.get("type") == "tool_result":
                                yield ToolCallResult(
                                    name=evt["name"], arguments={},
                                    result=evt.get("result", ""),
                                    expert_id=evt.get("task_id", ""),
                                )
                        for bg in collect_background_results():
                            got_results = True
                            ok = bg.get("success", False)
                            status = "成功" if ok else "失败"
                            self.ctx.add_message({
                                "role": "user",
                                "content": f"[后台任务 {bg['id']} {status}]\n\n{bg.get('result', '')}",
                            })
                            if ok:
                                yield TextDelta(content=f"\n> 后台专家 {bg['id']} 已完成\n")
                            else:
                                yield TextDelta(content=f"\n> ⚠️ 后台专家 {bg['id']} 执行失败！请检查并重试\n")
                        if got_results:
                            continue

                        # Long wait exhausted — let LLM know
                        if has_pending_tasks():
                            hint = (
                                "[系统提示] 后台专家任务仍在执行中。"
                                "请简短回复用户当前进度，不要声称完成。"
                            )
                            self.ctx.add_message({"role": "user", "content": hint})
                        self._waiting_yielded = False  # reset for next batch
                        continue

                    # No pending tasks — reset waiting flag for next batch of experts
                    self._waiting_yielded = False

                    # Gate 2: Expert failures unhandled → hard block
                    from tools.core.spawn_expert import has_unhandled_failures
                    if has_unhandled_failures():
                        from tools.core.task_tools import _exhausted_expert_retries, _tasks
                        exhausted = _exhausted_expert_retries()
                        if exhausted:
                            # Experts failed twice — tell agent to handle it directly
                            fail_details = "\n".join(
                                f"  Task [{tid}] ({etype}专家): 已失败2次，专家无法完成。你必须自行完成此任务，不要再 spawn_expert！"
                                for tid, etype in exhausted
                            )
                            hint = (
                                f"[系统提示] 以下专家任务已失败2次，不能再使用专家重试：\n{fail_details}\n"
                                "请你自己（主 agent）直接完成这些任务：阅读需求、分析代码、生成用例，"
                                "用 write_file 写入结果，然后标记对应 task 为 done。"
                            )
                        else:
                            hint = (
                                "[系统提示] 有后台专家执行失败！你必须采取行动："
                                "1) 重新 spawn_expert 重试，或 2) 自行完成。"
                            )
                        self.ctx.add_message({"role": "user", "content": hint})
                        yield TextDelta(content="\n> 子任务失败，尝试重试或自行完成...\n")
                        continue

                    # Gate 3: Incomplete tasks with no experts running and no failures.
                    # Instead of silently auto-doning, tell the agent about pending tasks
                    # and let it decide: either do the work or confirm they're truly done.
                    # The auto-done fallback only triggers if the agent has already
                    # produced output text (i.e., it chose to respond without tools).
                    if _has_incomplete_tasks():
                        try:
                            from tools.core.task_tools import _tasks, _task_status_summary
                            # Only auto-done if the agent has already responded with
                            # text (no tools). Otherwise give it a chance to act.
                            if not text_buffer.strip():
                                summary = _task_status_summary()
                                hint = (
                                    f"[系统提示] 仍有未完成的任务：\n{summary}\n"
                                    "请使用工具完成工作或更新任务状态。"
                                )
                                self.ctx.add_message({"role": "user", "content": hint})
                                yield TextDelta(content="\n> 有未完成任务，继续处理...\n")
                                continue

                            # Agent chose to respond with text only — accept its decision
                            for t in _tasks.values():
                                if t.status != "done":
                                    t.status = "done"
                        except Exception:
                            pass


                    # No tools: save text + thinking as a single assistant message
                    if text_buffer.strip() or thinking_text:
                        if thinking_text:
                            content = [{"type": "thinking", "thinking": thinking_text, "signature": thinking_signature}]
                            if text_buffer.strip():
                                content.append({"type": "text", "text": text_buffer})
                            self.ctx.add_message({"role": "assistant", "content": content})
                        else:
                            self.ctx.add_message({"role": "assistant", "content": text_buffer})
                        if text_buffer.strip():
                            set_last_output(text_buffer)

                    # Diagnostic: write gate states to file BEFORE AgentDone
                    import logging, time as _time, sys
                    _log = logging.getLogger("agent.engine")
                    try:
                        from tools.core.spawn_expert import has_pending_tasks, has_unhandled_failures
                        from tools.core.task_tools import _task_status_summary, _tasks
                        pending = has_pending_tasks()
                        failures = has_unhandled_failures()
                        from tools.core.spawn_expert import _background_tasks as _bt
                        gates = {
                            "pending": pending,
                            "incomplete": _has_incomplete_tasks(),
                            "failures": failures,
                            "n_tasks": len(_tasks),
                            "tasks": {tid: f"{t.status}|{t.subject[:40]}" for tid, t in _tasks.items()},
                        }
                        # print(f"GATE_CHECK {_time.monotonic():.3f}: pending={pending}, failures={failures}, n_tasks={len(_tasks)}, bg_tasks={len(_bt)}, bt_id={id(_bt)}, unhandled_failure={failures}", flush=True)
                        # _log.warning("AgentDone gate states: %s", json.dumps(gates, ensure_ascii=False))
                    except Exception:
                        _log.warning("AgentDone diagnostic failed")

                    yield AgentDone()
                    return

                # Cap excessive tool calls in one turn
                if len(tool_calls_acc) > MAX_TOOL_CALLS_PER_TURN:
                    tool_calls_acc = tool_calls_acc[:MAX_TOOL_CALLS_PER_TURN]

                # Productive turn counting: same-op repeats don't consume turns.
                # The sig set persists for the entire session — we never want to
                # double-count the same tool call, even after many turns.
                turn_sigs = {self._tool_sig(tc) for tc in tool_calls_acc}
                if turn_sigs - recent_sigs:
                    productive_turns += 1
                recent_sigs |= turn_sigs

                # Execute all tools in parallel using async executor
                for tc in tool_calls_acc:
                    yield ToolCallStart(name=tc.name, arguments=tc.arguments)

                # Save ONE assistant message with ALL tool calls + thinking + text
                content = None
                if thinking_text:
                    content = [{"type": "thinking", "thinking": thinking_text, "signature": thinking_signature}]
                    if text_buffer.strip():
                        content.append({"type": "text", "text": text_buffer})
                self.ctx.add_message({
                    "role": "assistant",
                    "content": content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(self._context_args(tc), ensure_ascii=False)}
                        }
                        for tc in tool_calls_acc
                    ]
                })
                if text_buffer.strip():
                    set_last_output(text_buffer)

                loop = asyncio.get_event_loop()

                async def _run_tool(tc: ToolCall) -> tuple[ToolCall, str]:
                    try:
                        tool = self.tools.get(tc.name)
                        # File-output tools: acquire semaphore to prevent contention
                        needs_sem = (
                            tc.name in ("write_file", "append_file", "export_json",
                                        "export_excel", "export_markdown",
                                        "export_xmind", "export_testrail_csv")
                            or (tool and tool.category == "output")
                        )
                        if needs_sem:
                            await self._file_semaphore.acquire()

                        try:
                            if tool and inspect.iscoroutinefunction(tool.func):
                                # Async tool: run directly in event loop with timeout
                                result = await asyncio.wait_for(
                                    tool.func(**tc.arguments),
                                    timeout=TOOL_TIMEOUT,
                                )
                                result = str(result) if result is not None else "done"
                            else:
                                # Sync tool: offload to thread pool with timeout
                                result = await asyncio.wait_for(
                                    loop.run_in_executor(
                                        self._executor, self.tools.execute, tc.name, tc.arguments
                                    ),
                                    timeout=TOOL_TIMEOUT,
                                )
                        finally:
                            if needs_sem:
                                self._file_semaphore.release()
                    except asyncio.TimeoutError:
                        result = f"Timeout: tool '{tc.name}' exceeded {TOOL_TIMEOUT}s limit"
                    except Exception as e:
                        result = f"Error: {e}"
                    return tc, result

                tasks = [_run_tool(tc) for tc in tool_calls_acc]
                results = await asyncio.gather(*tasks)
                output_tool_called = False
                for tc, result in results:
                    yield ToolCallResult(name=tc.name, arguments=tc.arguments, result=result)
                    self._add_tool_result(tc, result)
                    t = self.tools.get(tc.name)
                    if t and t.category == "output":
                        output_tool_called = True
                    # Track tool usage for skill auto-unload
                    if hasattr(self.tools, 'record_tool_use'):
                        self.tools.record_tool_use(tc.name)

                if output_tool_called:
                    from tools.core.spawn_expert import has_unhandled_failures, clear_unhandled_failures
                    if has_unhandled_failures():
                        clear_unhandled_failures()

                # Advance turn counter for skill auto-unload tracking
                if hasattr(self.tools, 'advance_turn'):
                    self.tools.advance_turn()
                # Auto-unload stale skills
                if hasattr(self.tools, 'auto_unload_stale'):
                    unloaded = self.tools.auto_unload_stale()
                    for u in unloaded:
                        self.ctx.add_message({
                            "role": "user",
                            "content": f"[系统] '{u}' skill 已自动卸载（长时间未使用），需要时 load_skill 重新加载。"
                        })

                # Continue loop for next turn
                continue

            except Exception as e:
                yield AgentError(message=str(e))
                return

        # Turn limit reached — end gracefully without ugly system message
        yield TextDelta(content="\n\n> 已达到本轮步骤上限。如果任务未完成，请回复「继续」让我接着处理。")
        yield AgentDone()

    # Per-tool result size limits (characters). read_file/analyze_code need more
    # headroom because the AI relies on them to understand requirements and code.
    # Everything else gets aggressive truncation — the signal is at the edges.
    _TOOL_RESULT_LIMITS = {
        "read_file": 12000,
        "analyze_code": 8000,
        "parse_openapi": 8000,
    }
    _DEFAULT_RESULT_LIMIT = 3000

    @classmethod
    def _tool_result_limit(cls, tool_name: str) -> int:
        return cls._TOOL_RESULT_LIMITS.get(tool_name, cls._DEFAULT_RESULT_LIMIT)

    def _add_tool_result(self, tc: ToolCall, result: str):
        """Save tool result to context, truncating large outputs to prevent bloat.

        Skip duplicate results: if the same tool with same args produced the same
        result as last time, don't add it again — prevents context bloat from
        the agent repeatedly calling task_list / list_files / etc.
        """
        # Dedup: skip if same tool + same args + same result as last time
        sig = f"{tc.name}:{json.dumps(tc.arguments, ensure_ascii=False, sort_keys=True)}"
        if sig in self._last_tool_sig and self._last_tool_result.get(sig) == result:
            return  # duplicate — skip adding to context
        self._last_tool_sig.discard(sig)  # only track the most recent

        max_chars = self._tool_result_limit(tc.name)
        # Never truncate image data — base64 must stay intact for vision models
        if "[image:" not in result and len(result) > max_chars:
            head = result[:max_chars * 2 // 3]
            tail = result[-max_chars // 3:]
            result = f"{head}\n...({len(result)} total chars)...\n{tail}"

        self.ctx.add_message({
            "role": "tool",
            "content": result,
            "tool_call_id": tc.id,
        })
        self._last_tool_sig = {sig}
        self._last_tool_result[sig] = result
        # Evict oldest entries to prevent unbounded memory growth
        while len(self._last_tool_result) > self._MAX_RESULT_CACHE:
            oldest = next(iter(self._last_tool_result))
            del self._last_tool_result[oldest]

    @staticmethod
    def _context_args(tc: ToolCall) -> dict:
        """Strip inline heredoc data from context — the data is already on disk.
        All other argument content is preserved intact for accuracy.
        """
        args = {}
        for k, v in tc.arguments.items():
            if isinstance(v, str):
                heredoc = v.find('<<')
                if heredoc >= 0:
                    v = v[:heredoc].strip() + '  # (heredoc body stripped, content written to file)'
            args[k] = v
        return args

    def _merge_tool_calls(self, existing: list[ToolCall], new: ToolCall) -> list[ToolCall]:
        """Merge streaming tool call fragments."""
        found = False
        for i, tc in enumerate(existing):
            if tc.id == new.id:
                existing[i] = ToolCall(
                    id=tc.id,
                    name=tc.name or new.name,
                    arguments={**tc.arguments, **new.arguments} if new.arguments else tc.arguments,
                )
                found = True
                break
        if not found:
            existing.append(new)
        return existing
