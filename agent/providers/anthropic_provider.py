"""
Anthropic provider. Uses the anthropic SDK with prompt caching enabled.
"""

import asyncio
import json
from typing import AsyncIterator, Optional
from anthropic import AsyncAnthropic
import httpx
from agent.llm_client import LLMProvider, ToolSchema, ToolCall, ResponseChunk

# Shared defaults — keep in sync with openai_provider
CLIENT_TIMEOUT = 180.0
CONNECT_TIMEOUT = 10.0
POOL_TIMEOUT = 15.0     # Max wait for a connection from the pool


class AnthropicProvider(LLMProvider):
    def __init__(self, api_key: str, api_base: Optional[str] = None, model: str = "claude-sonnet-4-6", max_tokens: int = 32768, thinking_mode: str = "auto"):
        import httpx
        self.model = model
        self.max_tokens = max_tokens
        self._api_key = api_key
        self._api_base = api_base or ""
        self._thinking_mode = thinking_mode
        kwargs = {}
        if api_base:
            kwargs["base_url"] = api_base
        is_official_anthropic = api_base and (
            "anthropic.com" in api_base.lower() or "api.anthropic.com" in api_base.lower()
        )
        if not api_base or is_official_anthropic:
            kwargs["api_key"] = api_key
        else:
            kwargs["auth_token"] = api_key
        kwargs["timeout"] = httpx.Timeout(CLIENT_TIMEOUT, connect=CONNECT_TIMEOUT, pool=POOL_TIMEOUT)
        kwargs["http_client"] = httpx.AsyncClient(
            timeout=kwargs["timeout"],
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=30),
        )
        self.client = AsyncAnthropic(**kwargs)

    async def chat(
        self,
        messages: list[dict],
        tools: list[ToolSchema],
        stream: bool = True,
    ) -> AsyncIterator[ResponseChunk]:
        anthropic_tools = None
        if tools:
            anthropic_tools = []
            for i, t in enumerate(tools):
                tool_def = {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                }
                anthropic_tools.append(tool_def)

        # Extract system prompt, convert messages
        system_parts = []
        chat_messages = []
        i = 0
        while i < len(messages):
            m = messages[i]
            if m["role"] == "system":
                system_parts.append(str(m.get("content", "")))
                i += 1
                continue

            # Merge consecutive tool messages into one user message.
            # Anthropic protocol requires all tool_results after an assistant
            # message with multiple tool_use blocks to be in a single message.
            if m["role"] == "tool":
                tool_blocks = []
                while i < len(messages) and messages[i]["role"] == "tool":
                    tm = messages[i]
                    tool_blocks.append({
                        "type": "tool_result",
                        "tool_use_id": tm.get("tool_call_id", "") or "call_unknown",
                        "content": str(tm.get("content", "")),
                    })
                    i += 1
                chat_messages.append({"role": "user", "content": tool_blocks})
                continue

            chat_messages.append(self._convert_message(m))
            i += 1

        kwargs = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": chat_messages,
            "stream": stream,
        }

        if system_parts:
            system_text = "\n".join(system_parts).strip()
            kwargs["system"] = [{"type": "text", "text": system_text}]
        if anthropic_tools:
            kwargs["tools"] = anthropic_tools

        # Thinking: propagate the user's mode to the API level.
        if self._thinking_mode == "disabled":
            kwargs["thinking"] = {"type": "disabled"}
        elif self._thinking_mode == "enabled":
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": 16384}
        # else "auto": don't send thinking param, model decides

        response = await self.client.messages.create(**kwargs)

        if not stream:
            for block in response.content:
                if block.type == "text":
                    yield ResponseChunk(text=block.text)
                elif block.type == "tool_use":
                    yield ResponseChunk(tool_call=ToolCall(
                        id=block.id, name=block.name, arguments=block.input
                    ))
            yield ResponseChunk(is_done=True, usage={
                "input": response.usage.input_tokens if response.usage else 0,
                "output": response.usage.output_tokens if response.usage else 0,
            })
            return

        # Streaming
        current_block = None
        tool_input_json = ""
        thinking_text = ""
        thinking_sig = ""
        skip_thinking = self._thinking_mode == "disabled"
        import sys, time as _t
        from collections import defaultdict as _dd
        _stream_start = _t.monotonic()
        _event_count = 0
        _last_log = _stream_start
        _event_types = _dd(int)
        try:
            async for event in response:
                _event_count += 1
                _event_types[event.type] += 1
                _now = _t.monotonic()
                if _now - _last_log > 5:
                    etypes = dict(_event_types)
                    print(f"[anthropic] stream: {_event_count} events, elapsed={_now-_stream_start:.1f}s, thinking_mode={self._thinking_mode}, types={etypes}", file=sys.stderr, flush=True)
                    _last_log = _now
                if event.type == "content_block_start":
                    current_block = event.content_block
                    if current_block.type == "tool_use":
                        tool_input_json = ""
                    elif current_block.type == "thinking":
                        thinking_text = ""
                        thinking_sig = ""
                elif event.type == "content_block_delta":
                    delta = event.delta
                    if delta.type == "text_delta":
                        yield ResponseChunk(text=delta.text)
                    elif delta.type == "input_json_delta":
                        tool_input_json += delta.partial_json
                    elif delta.type == "thinking_delta":
                        thinking_text += delta.thinking
                        yield ResponseChunk(thinking=delta.thinking)
                    elif delta.type == "signature_delta":
                        thinking_sig += delta.signature
                elif event.type == "content_block_stop":
                    if current_block and current_block.type == "tool_use":
                        try:
                            args = json.loads(tool_input_json) if tool_input_json else {}
                        except json.JSONDecodeError:
                            args = {"_parse_error": f"JSON truncated ({len(tool_input_json)} chars)"}
                        yield ResponseChunk(tool_call=ToolCall(
                            id=current_block.id, name=current_block.name, arguments=args
                        ))
                    elif current_block and current_block.type == "thinking":
                        # thinking_text was already yielded incrementally via
                        # thinking_delta events. Only pass the signature here
                        # to avoid doubling the text in the engine accumulator.
                        if not skip_thinking and thinking_sig:
                            yield ResponseChunk(thinking_signature=thinking_sig)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            raise RuntimeError(f"LLM streaming failed (model={self.model}): {type(e).__name__}: {e}") from e

        etypes = dict(_event_types)
        # print(f"[anthropic] stream DONE: {_event_count} events, elapsed={_t.monotonic()-_stream_start:.1f}s, thinking_mode={self._thinking_mode}, types={etypes}", file=sys.stderr, flush=True)
        yield ResponseChunk(is_done=True)

    @staticmethod
    def _convert_message(m: dict) -> dict:
        """Convert internal message format to Anthropic format."""
        role = m.get("role", "")

        if role == "tool":
            result_content = m.get("content", "")
            tool_id = m.get("tool_call_id", "") or "call_unknown"
            return {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": str(result_content),
                }]
            }

        # Pass through content that's already in Anthropic format
        content = m.get("content")
        if isinstance(content, list) and any(
            isinstance(b, dict) and b.get("type") in ("tool_result", "tool_use")
            for b in content
        ):
            return {"role": role, "content": content}

        if role == "assistant" and m.get("tool_calls"):
            content_blocks = []
            content = m.get("content")
            if isinstance(content, list):
                for block in content:
                    if block.get("type") == "thinking":
                        tb = {"type": "thinking", "thinking": block.get("thinking", "")}
                        if block.get("signature"):
                            tb["signature"] = block["signature"]
                        content_blocks.append(tb)
                    elif block.get("type") == "text":
                        content_blocks.append({"type": "text", "text": block["text"]})
            elif content:
                content_blocks.append({"type": "text", "text": str(content)})
            for tc in m["tool_calls"]:
                func = tc.get("function", {})
                try:
                    args = json.loads(func.get("arguments", "{}"))
                except (json.JSONDecodeError, TypeError):
                    args = {}
                content_blocks.append({
                    "type": "tool_use",
                    "id": tc.get("id", ""),
                    "name": func.get("name", ""),
                    "input": args if isinstance(args, dict) else {},
                })
            return {"role": "assistant", "content": content_blocks}

        content = m.get("content")
        if isinstance(content, list):
            converted_blocks = []
            for block in content:
                if block.get("type") == "text":
                    converted_blocks.append({"type": "text", "text": block["text"]})
                elif block.get("type") == "thinking":
                    tb = {"type": "thinking", "thinking": block.get("thinking", "")}
                    if block.get("signature"):
                        tb["signature"] = block["signature"]
                    converted_blocks.append(tb)
                elif block.get("type") == "image_url":
                    url = block.get("image_url", {}).get("url", "")
                    if url.startswith("data:"):
                        header, b64data = url.split(",", 1)
                        media_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
                        converted_blocks.append({
                            "type": "image",
                            "source": {"type": "base64", "media_type": media_type, "data": b64data}
                        })
            return {"role": role, "content": converted_blocks}
        if content is None:
            return {**m, "content": ""}
        return m

    def estimate_tokens(self, messages: list[dict]) -> int:
        total = 0
        for m in messages:
            content = m.get("content", "")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        total += len(str(block.get("text", ""))) // 4
            else:
                total += len(str(content)) // 4
        return total
