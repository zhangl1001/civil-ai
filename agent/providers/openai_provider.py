"""
OpenAI-compatible provider. Works with DeepSeek, OpenAI, and any
OpenAI-compatible API. Uses the openai SDK.
"""

import asyncio
import json
from typing import AsyncIterator, Optional
from openai import AsyncOpenAI
from agent.llm_client import LLMProvider, ToolSchema, ToolCall, ResponseChunk
import httpx

# Shared defaults — keep in sync with anthropic_provider
CLIENT_TIMEOUT = 180.0
CONNECT_TIMEOUT = 10.0
POOL_TIMEOUT = 15.0


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, api_base: Optional[str] = None, model: str = "deepseek-chat", max_tokens: int = 32768, thinking_mode: str = "auto"):
        self.model = model
        self.max_tokens = max_tokens
        self._api_key = api_key
        self._api_base = api_base or ""
        self._thinking_mode = thinking_mode
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=api_base or "https://api.deepseek.com/v1",
            http_client=httpx.AsyncClient(
                timeout=httpx.Timeout(CLIENT_TIMEOUT, connect=CONNECT_TIMEOUT, pool=POOL_TIMEOUT),
                limits=httpx.Limits(max_keepalive_connections=5, max_connections=20),
            ),
        )

    @staticmethod
    def _strip_thinking(messages: list[dict]) -> list[dict]:
        """Remove thinking blocks from assistant messages before sending to API."""
        result = []
        for m in messages:
            content = m.get("content", "")
            if m.get("role") == "assistant" and isinstance(content, list):
                text_blocks = [b for b in content if b.get("type") != "thinking"]
                if not text_blocks:
                    continue
                result.append({**m, "content": text_blocks})
            else:
                result.append(m)
        return result

    @staticmethod
    def _to_multimodal(messages: list[dict]) -> list[dict]:
        """Convert [image:...] markers in message content to OpenAI multimodal format."""
        import re
        result = []
        for m in messages:
            content = m.get("content", "")
            if not isinstance(content, str) or "[image:" not in content:
                result.append(m)
                continue
            parts = []
            last_end = 0
            for match in re.finditer(r'\[image:(image/\w+);base64,([A-Za-z0-9+/=]+?)\]', content):
                if match.start() > last_end:
                    parts.append({"type": "text", "text": content[last_end:match.start()]})
                parts.append({"type": "image_url", "image_url": {"url": f"data:{match.group(1)};base64,{match.group(2)}"}})
                last_end = match.end()
            if last_end < len(content):
                parts.append({"type": "text", "text": content[last_end:]})
            if not parts:
                result.append(m)
            else:
                result.append({**m, "content": parts if len(parts) > 1 else parts[0]})
        return result

    async def chat(
        self,
        messages: list[dict],
        tools: list[ToolSchema],
        stream: bool = True,
    ) -> AsyncIterator[ResponseChunk]:
        openai_tools = None
        if tools:
            openai_tools = [{
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            } for t in tools]

        # Strip thinking blocks from context — OpenAI-style APIs don't need them.
        messages = self._strip_thinking(messages)
        # Convert image markers to multimodal format for vision models
        messages = self._to_multimodal(messages)

        try:
            extra_body = {}
            if self._thinking_mode == "disabled":
                extra_body["thinking"] = {"type": "disabled"}
            elif self._thinking_mode == "enabled":
                extra_body["thinking"] = {"type": "enabled"}
            # else "auto": don't send thinking param, model decides
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=openai_tools,
                stream=stream,
                max_tokens=self.max_tokens,
                extra_body=extra_body if extra_body else None,
            )
        except Exception as e:
            raise RuntimeError(f"API call failed (model={self.model}, base={self._api_base or 'default'}): {e}") from e

        if not stream:
            choice = response.choices[0]
            if choice.message.tool_calls:
                for tc in choice.message.tool_calls:
                    args = json.loads(tc.function.arguments)
                    yield ResponseChunk(tool_call=ToolCall(
                        id=tc.id, name=tc.function.name, arguments=args
                    ))
            if choice.message.content:
                yield ResponseChunk(text=choice.message.content)
            # Capture reasoning_content in non-streaming mode when thinking is enabled
            if self._thinking_mode == "enabled":
                reasoning = getattr(choice.message, "reasoning_content", None)
                if reasoning:
                    yield ResponseChunk(thinking=reasoning)
            yield ResponseChunk(is_done=True, usage={
                "input": response.usage.prompt_tokens if response.usage else 0,
                "output": response.usage.completion_tokens if response.usage else 0,
            })
            return

        # Streaming
        tool_calls_acc: dict[int, dict] = {}
        try:
            async for chunk in response:
                delta = chunk.choices[0].delta if chunk.choices else None
                if not delta:
                    continue

                if delta.content:
                    yield ResponseChunk(text=delta.content)

                # DeepSeek thinking mode: reasoning text arrives via reasoning_content,
                # not content. Must yield as thinking chunk so the engine captures it.
                if self._thinking_mode == "enabled" and getattr(delta, "reasoning_content", None):
                    yield ResponseChunk(thinking=delta.reasoning_content)

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {"id": tc.id or "", "name": "", "arguments": ""}
                        if tc.id:
                            tool_calls_acc[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                tool_calls_acc[idx]["name"] += tc.function.name
                            if tc.function.arguments:
                                tool_calls_acc[idx]["arguments"] += tc.function.arguments

                if chunk.choices[0].finish_reason:
                    for tc_data in tool_calls_acc.values():
                        if tc_data["name"]:
                            try:
                                args = json.loads(tc_data["arguments"]) if tc_data["arguments"] else {}
                            except json.JSONDecodeError:
                                preview = tc_data["arguments"][:200] if tc_data["arguments"] else "(empty)"
                                args = {"_parse_error": f"JSON truncated ({len(tc_data['arguments'])} chars). Content may exceed max_tokens. Preview: {preview}"}
                            yield ResponseChunk(tool_call=ToolCall(
                                id=tc_data["id"], name=tc_data["name"], arguments=args
                            ))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            raise RuntimeError(f"LLM streaming failed (model={self.model}): {type(e).__name__}: {e}") from e

        yield ResponseChunk(is_done=True)

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
