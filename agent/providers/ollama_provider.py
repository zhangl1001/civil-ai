"""
Ollama provider. Uses OpenAI-compatible API at http://localhost:11434/v1.
No thinking parameter — Ollama models handle reasoning inline.
"""

import json
from typing import AsyncIterator, Optional
import httpx
from openai import AsyncOpenAI
from agent.llm_client import LLMProvider, ToolSchema, ToolCall, ResponseChunk

CLIENT_TIMEOUT = 180.0
CONNECT_TIMEOUT = 10.0


class OllamaProvider(LLMProvider):
    def __init__(self, api_key: str = "", api_base: str = "http://localhost:11434/v1", model: str = "qwen2.5:7b", max_tokens: int = 32768, thinking_mode: str = "disabled"):
        self.model = model
        self.max_tokens = max_tokens
        self._api_key = api_key or "ollama"
        self._api_base = api_base or "http://localhost:11434/v1"
        self._thinking_mode = "disabled"  # Ollama doesn't support thinking param
        self.client = AsyncOpenAI(
            api_key=self._api_key,
            base_url=self._api_base,
            http_client=httpx.AsyncClient(
                timeout=httpx.Timeout(CLIENT_TIMEOUT, connect=CONNECT_TIMEOUT),
                limits=httpx.Limits(max_keepalive_connections=5, max_connections=20),
            ),
        )

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

        # No extra_body — Ollama doesn't support thinking/reasoning params
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=openai_tools,
            stream=stream,
            max_tokens=self.max_tokens,
        )

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
            yield ResponseChunk(is_done=True, usage={
                "input": response.usage.prompt_tokens if response.usage else 0,
                "output": response.usage.completion_tokens if response.usage else 0,
            })
            return

        tool_calls_acc: dict[int, dict] = {}
        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            if not delta:
                continue

            if delta.content:
                yield ResponseChunk(text=delta.content)

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
                            args = {"_parse_error": f"JSON truncated ({len(tc_data['arguments'])} chars). Preview: {preview}"}
                        yield ResponseChunk(tool_call=ToolCall(
                            id=tc_data["id"], name=tc_data["name"], arguments=args
                        ))

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
