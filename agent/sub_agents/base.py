"""
Expert sub-agent base class.
A lightweight agent with its own context, system prompt, and whitelisted tools.
The main agent spawns these via the spawn_expert tool to parallelize work.
"""

import asyncio
import atexit
import inspect
import json
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional
from agent.llm_client import LLMProvider, ToolSchema, ToolCall
from agent.tool_registry import ToolRegistry, Tool
from context.manager import ContextManager


# No turn limit — experts run until completion, guarded by per-turn LLM_TIMEOUT (180s)
# and overall EXPERT_STALE_TIMEOUT (300s) from spawn_expert.
MAX_TURNS = 999
TOOL_TIMEOUT = 120       # Per-tool execution timeout (seconds)
LLM_TIMEOUT = 180        # Per-turn LLM call timeout (seconds)
LLM_MAX_RETRIES = 2      # Max retry attempts per LLM call (2 retries = 3 total attempts)
LLM_MAX_CONSECUTIVE_FAILURES = 5  # Stop expert after this many consecutive LLM failures
# No wall-clock timeout — experts run until MAX_TURNS or task completion.
# Per-operation timeouts (LLM_TIMEOUT, TOOL_TIMEOUT) prevent individual hangs.


@dataclass
class ExpertToolResult:
    """Structured result of a single tool execution within an expert."""
    name: str       # tool name, e.g. "write_file"
    success: bool   # did this tool invocation succeed?
    summary: str    # first 100 chars of tool output
    category: str = ""  # "output" for tools that produce persistent output
    path: str = ""      # output file path, captured from tool arguments


@dataclass
class ExpertRunResult:
    """Return value of ExpertAgent.run().

    text: full text output for injection into main agent context (same format as before).
    tool_results: structured per-tool success/failure — for display only, NOT used for
                  success detection. The expert succeeds when the model finishes naturally
                  (no more tool calls) AND produced at least one successful output.
    _force_failure: set True when expert is killed by external constraint (timeout, LLM down,
                    max turns). Also True if model finished without producing output.
    """
    text: str
    tool_results: list[ExpertToolResult] = field(default_factory=list)
    _force_failure: bool = field(default=False, repr=False)

    @property
    def success(self) -> bool:
        return not self._force_failure

def _get_thinking_turns() -> int:
    try:
        from cli.settings import load_settings
        return load_settings().model.expert_thinking_turns
    except Exception:
        return 2

# Module-level shared thread pool — all experts share one pool to avoid
# creating ThreadPoolExecutor(8) per expert instance.
_shared_executor: Optional[ThreadPoolExecutor] = None


def _get_shared_executor() -> ThreadPoolExecutor:
    global _shared_executor
    if _shared_executor is None:
        _shared_executor = ThreadPoolExecutor(max_workers=8)
        atexit.register(_shared_executor.shutdown, wait=False)
    return _shared_executor


class ExpertAgent:
    """A specialized sub-agent that executes one task and returns results.

    Timeout model:
    - Each tool execution: capped at TOOL_TIMEOUT (120s). Hanging tools return error.
    - Each LLM call: capped at LLM_TIMEOUT (180s). Stuck generation returns error.
    - No wall-clock total timeout — expert runs until MAX_TURNS or task completion.
    """

    # Per-tool result size limits. Must match engine._TOOL_RESULT_LIMITS.
    _TOOL_RESULT_LIMITS = {
        "read_file": 12000,
        "analyze_code": 8000,
        "parse_openapi": 8000,
    }
    _DEFAULT_RESULT_LIMIT = 3000

    def __init__(
        self,
        name: str,
        system_prompt: str,
        tools: list[str],
        llm: LLMProvider,
        tool_registry,  # SkillRegistry (or ToolRegistry for filtered views)
        executor: Optional[ThreadPoolExecutor] = None,
        on_progress: Optional[Callable] = None,
    ):
        self.name = name
        self.system_prompt = system_prompt
        self.tool_names = tools
        self.llm = llm
        self.full_registry = tool_registry
        self.ctx = ContextManager(keep_thinking_turns=_get_thinking_turns())
        self._executor = executor or _get_shared_executor()
        self.on_progress = on_progress
        self._tool_results: list[ExpertToolResult] = []

    def _filtered_registry(self) -> ToolRegistry:
        reg = ToolRegistry()
        for name in self.tool_names:
            tool = self.full_registry.get(name)
            if tool:
                reg.register(tool)
        return reg

    async def run(self, task: str) -> ExpertRunResult:
        """Execute the task. No wall-clock timeout — runs until MAX_TURNS or completion."""
        self._tool_results = []
        return await self._run(task)

    async def _run(self, task: str) -> ExpertRunResult:
        """Execute the task and return accumulated results."""
        import time as _t
        _t0 = _t.monotonic()
        print(f"[EXPERT_START {_t0:.3f}] {self.name}: _run entered, setting up context", flush=True)
        self.ctx.add_message({"role": "system", "content": self.system_prompt})
        self.ctx.add_message({"role": "user", "content": task})

        tools = self._filtered_registry()
        _t1 = _t.monotonic()
        print(f"[EXPERT_READY {_t1:.3f}] {self.name}: context+tools ready ({_t1-_t0:.2f}s), first LLM call starting", flush=True)
        all_output: list[str] = []
        loop = asyncio.get_event_loop()
        consecutive_llm_failures = 0

        for turn in range(MAX_TURNS):
            _turn_start = _t.monotonic()
            try:
                messages = self.ctx.get_messages()
                tool_schemas = [t.to_schema() for t in tools.list_all()]

                tool_calls_acc: list[ToolCall] = []
                text_buffer = ""
                thinking_text = ""
                thinking_signature = ""

                # LLM call with retry for transient errors
                llm_ok = False
                for llm_attempt in range(LLM_MAX_RETRIES + 1):  # original + up to 3 retries
                    try:
                        async def _chat():
                            nonlocal tool_calls_acc, text_buffer, thinking_text, thinking_signature
                            _chunk_count = 0
                            import time as _tc
                            _chat_start = _tc.monotonic()
                            async for chunk in self.llm.chat(
                                messages=messages,
                                tools=tool_schemas,
                                stream=True,
                            ):
                                _chunk_count += 1
                                if chunk.tool_call:
                                    _now = _tc.monotonic()
                                    print(f"[expert.{self.name}] chunk#{_chunk_count}: tool_call={chunk.tool_call.name}, elapsed={_now-_chat_start:.1f}s, total_acc={len(tool_calls_acc)+1}", flush=True)
                                    tool_calls_acc = self._merge(tool_calls_acc, chunk.tool_call)
                                if chunk.text:
                                    text_buffer += chunk.text
                                # Accumulate thinking — DeepSeek requires thinking blocks
                                # to be passed back in conversation history.
                                if chunk.thinking:
                                    thinking_text += chunk.thinking
                                    if chunk.thinking_signature:
                                        thinking_signature = chunk.thinking_signature
                                if _chunk_count % 500 == 0:
                                    _now = _tc.monotonic()
                                    print(f"[expert.{self.name}] chunk#{_chunk_count}: text_len={len(text_buffer)}, thinking_len={len(thinking_text)}, tools={len(tool_calls_acc)}, elapsed={_now-_chat_start:.1f}s", flush=True)
                            _now = _tc.monotonic()
                            print(f"[expert.{self.name}] _chat DONE: chunks={_chunk_count}, tools={len(tool_calls_acc)}, text={len(text_buffer)}, thinking={len(thinking_text)}, elapsed={_now-_chat_start:.1f}s", flush=True)
                        await asyncio.wait_for(_chat(), timeout=LLM_TIMEOUT)
                        llm_ok = True
                        break
                    except asyncio.TimeoutError:
                        # Timeout is transient — retry with backoff
                        all_output.append(f"[{self.name}] LLM 超时 turn {turn}, 重试 ({llm_attempt + 1}/{LLM_MAX_RETRIES})")
                        if llm_attempt < LLM_MAX_RETRIES:
                            await asyncio.sleep(2 ** llm_attempt)
                            continue
                        break
                    except Exception as e:
                        err = str(e)
                        from agent.engine import _is_transient_error
                        if _is_transient_error(err) and llm_attempt < LLM_MAX_RETRIES:
                            wait = 2 ** llm_attempt
                            await asyncio.sleep(wait)
                            continue
                        all_output.append(f"[{self.name}] LLM 错误 turn {turn}: {err[:200]}")
                        break

                if not llm_ok and not tool_calls_acc:
                    consecutive_llm_failures += 1
                    if consecutive_llm_failures >= LLM_MAX_CONSECUTIVE_FAILURES:
                        return ExpertRunResult(
                            text=f"LLM API 连续失败 {consecutive_llm_failures} 次，已停止专家任务",
                            tool_results=self._tool_results,
                            _force_failure=True,
                        )
                    continue  # retry next turn
                consecutive_llm_failures = 0

                if not tool_calls_acc:
                    if thinking_text or text_buffer.strip():
                        content = []
                        if thinking_text:
                            content.append({"type": "thinking", "thinking": thinking_text, "signature": thinking_signature})
                        if text_buffer.strip():
                            content.append({"type": "text", "text": text_buffer})
                        all_output.append(text_buffer.strip())
                        self.ctx.add_message({"role": "assistant", "content": content})
                    text = "\n".join(all_output) if all_output else "(no output)"
                    return ExpertRunResult(text=text, tool_results=self._tool_results)

                # Cap tool calls
                if len(tool_calls_acc) > 10:
                    tool_calls_acc = tool_calls_acc[:10]

                # Save ONE assistant message with ALL tool calls
                # Build content blocks: thinking + text (tool_use handled via tool_calls field)
                content_blocks = []
                if thinking_text:
                    content_blocks.append({"type": "thinking", "thinking": thinking_text, "signature": thinking_signature})
                if text_buffer.strip():
                    content_blocks.append({"type": "text", "text": text_buffer})

                # Use tool_calls field (OpenAI format) — the provider strips unused fields
                msg = {
                    "role": "assistant",
                    "content": content_blocks if content_blocks else None,
                }
                if tool_calls_acc:
                    msg["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(self._context_args(tc), ensure_ascii=False)}
                        }
                        for tc in tool_calls_acc
                    ]
                self.ctx.add_message(msg)

                # Execute tools IN PARALLEL with per-tool timeout.
                # Async tools run directly in event loop; sync tools use shared thread pool.
                async def _exec_one(tc: ToolCall) -> ExpertToolResult:
                    if self.on_progress:
                        self.on_progress({"type": "tool_start", "name": tc.name, "args": tc.arguments})
                    success = True
                    try:
                        tool = tools.get(tc.name)
                        if tool and inspect.iscoroutinefunction(tool.func):
                            raw = await asyncio.wait_for(
                                tool.func(**tc.arguments),
                                timeout=TOOL_TIMEOUT,
                            )
                            result = str(raw) if raw is not None else "done"
                        else:
                            result = await asyncio.wait_for(
                                loop.run_in_executor(
                                    self._executor, tools.execute, tc.name, tc.arguments
                                ),
                                timeout=TOOL_TIMEOUT,
                            )
                    except asyncio.TimeoutError:
                        result = f"Timeout: tool '{tc.name}' exceeded {TOOL_TIMEOUT}s limit"
                        success = False
                    except Exception as e:
                        result = f"Error: tool execution failed: {e}"
                        success = False
                    # Tool protocol: return strings starting with "Error:" signal failure
                    if success and isinstance(result, str) and result.startswith("Error:"):
                        success = False
                    if self.on_progress:
                        self.on_progress({"type": "tool_result", "name": tc.name, "result": str(result)[:200]})
                    tool_obj = tools.get(tc.name)
                    tool_cat = tool_obj.category if tool_obj else ""
                    # Extract output file path from tool arguments for output-category tools.
                    # Different tools use different arg names — check all known variants.
                    tool_path = ""
                    if tool_cat == "output":
                        args = tc.arguments or {}
                        for key in ("path", "output", "output_path", "target", "filepath"):
                            if key in args and isinstance(args[key], str):
                                tool_path = args[key]
                                break
                    return ExpertToolResult(
                        name=tc.name,
                        success=success,
                        summary=str(result)[:100],
                        category=tool_cat,
                        path=tool_path,
                    ), tc, str(result) if result is not None else "done"

                tasks = [_exec_one(tc) for tc in tool_calls_acc]
                exec_results = await asyncio.gather(*tasks)

                for tr, tc, result in exec_results:
                    self._tool_results.append(tr)
                    result_str = str(result) if result is not None else "done"
                    all_output.append(f"[{tc.name}]: {result_str[:500]}")
                    limit = self._TOOL_RESULT_LIMITS.get(tc.name, self._DEFAULT_RESULT_LIMIT)
                    if len(result_str) > limit:
                        head = result_str[:limit * 2 // 3]
                        tail = result_str[-limit // 3:]
                        result_str = f"{head}\n...({len(result_str)} total chars)...\n{tail}"
                    self.ctx.add_message({
                        "role": "tool",
                        "content": result_str,
                        "tool_call_id": tc.id,
                    })

            except Exception as e:
                all_output.append(f"[{self.name}] Turn {turn} error: {e}")
                continue

        text = "\n".join(all_output) or "(max turns reached)"
        return ExpertRunResult(text=text, tool_results=self._tool_results, _force_failure=True)

    @staticmethod
    def _context_args(tc: ToolCall) -> dict:
        """Strip inline heredoc data from context — the data is already on disk."""
        args = {}
        for k, v in tc.arguments.items():
            if isinstance(v, str):
                heredoc = v.find('<<')
                if heredoc >= 0:
                    v = v[:heredoc].strip() + '  # (heredoc body stripped, content written to file)'
            args[k] = v
        return args

    @staticmethod
    def _merge(existing: list[ToolCall], new: ToolCall) -> list[ToolCall]:
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
