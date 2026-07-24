"""
Context compressor - summarizes old messages to save token space.
Trims verbose tool results and summarizes conversation turns.
"""
from __future__ import annotations

MAX_TOOL_RESULT_CHARS = 2000  # Keep head + tail to preserve both context and results


def _strip_thinking_from_messages(messages: list[dict]) -> list[dict]:
    """Remove thinking blocks from all assistant messages before compression.
    Thinking is only useful for the current turn — historical thinking wastes tokens."""
    result = []
    for msg in messages:
        if msg.get("role") == "assistant" and isinstance(msg.get("content"), list):
            cleaned = [b for b in msg["content"]
                       if not (isinstance(b, dict) and b.get("type") == "thinking")]
            if cleaned:
                result.append({**msg, "content": cleaned})
            else:
                result.append({**msg, "content": [{"type": "text", "text": "(thinking removed)"}]})
        else:
            result.append(msg)
    return result

def _trim_message(m: dict) -> dict:
    """Trim a single message to remove noise while keeping signal."""
    role = m.get("role", "")
    content = m.get("content", "")

    if role == "tool":
        text = str(content)
        if len(text) > MAX_TOOL_RESULT_CHARS:
            head = text[:MAX_TOOL_RESULT_CHARS * 2 // 3]
            tail = text[-MAX_TOOL_RESULT_CHARS // 3:]
            text = head + f"\n...({len(text)} total)...\n" + tail
        return {"role": role, "content": text, "tool_call_id": m.get("tool_call_id", "")}

    if role == "assistant" and m.get("tool_calls"):
        trimmed_calls = []
        for tc in m["tool_calls"]:
            func = tc.get("function", {})
            args = str(func.get("arguments", ""))
            if len(args) > 500:
                args = args[:500] + "..."
            trimmed_calls.append({
                "id": tc.get("id", ""),
                "type": "function",
                "function": {"name": func.get("name", ""), "arguments": args},
            })
        text = str(content) if content else ""
        if len(text) > 1000:
            text = text[:1000] + "..."
        return {"role": role, "content": text or None, "tool_calls": trimmed_calls}

    # User/assistant text: keep as-is, but preserve more context
    if isinstance(content, str) and len(content) > 4000:
        if role == "user":
            content = content[:5000] + "..."  # Preserve more of user requests
        else:
            content = content[:4000] + "..."
    return {"role": role, "content": content}


class ContextCompressor:
    """Compresses old messages into a summary to stay within token limits.
    Progressive splitting: full ×2, then turn-boundary split at 2/4/8/16 parts.
    Chunks carry forward the previous summary as bridging context, preserving continuity."""

    async def compress(self, messages: list[dict], llm_client) -> str:
        if not messages:
            return ""

        # Strip thinking blocks — they're huge and only useful for current turn
        messages = _strip_thinking_from_messages(messages)

        # Phase 1: try full compression (up to 2 attempts)
        for _ in range(2):
            result = await self._compress_full(messages, llm_client)
            if result:
                return result

        # Phase 2: progressive turn-boundary split — 2, 4, 8, 16 parts
        for parts in (2, 4, 8, 16):
            chunks = self._split_at_turns(messages, parts)
            if len(chunks) <= 1:
                break
            result = await self._compress_with_bridge(chunks, llm_client)
            if result:
                return result

        return self.fallback_compress(messages)

    def _split_at_turns(self, messages: list[dict], target_parts: int) -> list[list[dict]]:
        """Split messages at user-message boundaries, never cutting mid-turn.
        A turn = user message + all assistant/tool responses that follow until next user msg."""
        if not messages:
            return []

        # Find all turn boundaries (indices where a user message starts)
        boundaries = []
        for i, m in enumerate(messages):
            if m.get("role") == "user" and i > 0:
                boundaries.append(i)

        if not boundaries or len(boundaries) + 1 <= target_parts:
            # Not enough turns to split at target granularity.
            # Chunk at safe boundaries (user messages) to avoid cutting
            # tool_use/tool_result pairs — which causes API 400 errors.
            chunk_size = max(1, len(messages) // target_parts)
            chunks = []
            start = 0
            while start < len(messages):
                end = min(start + chunk_size, len(messages))
                if end < len(messages):
                    safe = end
                    while safe > start and messages[safe - 1].get("role") not in ("user",):
                        safe -= 1
                    if safe > start:
                        end = safe
                chunks.append(messages[start:end])
                start = end
            return chunks if len(chunks) > 1 else [messages]

        # Pick boundary indices that divide turns evenly
        total_turns = len(boundaries) + 1
        step = max(1, total_turns // target_parts)
        picked = [boundaries[i * step - 1] for i in range(1, target_parts) if i * step - 1 < len(boundaries)]

        chunks = []
        start = 0
        for p in picked:
            chunks.append(messages[start:p])
            start = p
        chunks.append(messages[start:])
        return [c for c in chunks if c]

    async def _compress_full(self, messages: list[dict], llm_client) -> str | None:
        """Single-pass compression. Returns None on failure."""
        trimmed = [_trim_message(m) for m in messages]
        lines = []
        for m in trimmed:
            role = m["role"]
            content = str(m.get("content", ""))
            if not content.strip():
                tcs = m.get("tool_calls", [])
                if tcs:
                    names = [tc.get("function", {}).get("name", "?") for tc in tcs]
                    lines.append(f"[{role}]: called {', '.join(names)}")
                continue
            lines.append(f"[{role}]: {content[:600]}")

        conversation_text = "\n".join(lines[-80:])

        summary_prompt = [
            {"role": "system", "content": (
                "Summarize the conversation below in a structured format. Output XML:\n"
                "<analysis>bullet points of key facts</analysis>\n"
                "<summary>\n"
                "  <request>All user requests and intents (verbatim where possible)</request>\n"
                "  <concepts>Key technical concepts discussed</concepts>\n"
                "  <files>Files examined, modified, or created</files>\n"
                "  <errors>Errors encountered and fixes applied</errors>\n"
                "  <user_messages>ALL user messages (non-tool-result)</user_messages>\n"
                "  <pending>Tasks explicitly requested but not yet done</pending>\n"
                "  <current>What the agent was doing immediately before this summary</current>\n"
                "</summary>\n"
                "Only the <summary> will be kept. Be specific — include file paths, module names, counts."
            )},
            {"role": "user", "content": conversation_text},
        ]

        try:
            result = []
            async for chunk in llm_client.chat(messages=summary_prompt, tools=[], stream=True):
                if chunk.text:
                    result.append(chunk.text)
            raw = "".join(result).strip()
            if raw:
                import re
                m = re.search(r'<summary>(.*?)</summary>', raw, re.DOTALL)
                return m.group(1).strip() if m else raw
        except Exception:
            pass
        return None

    async def _compress_with_bridge(self, chunks: list[list[dict]], llm_client) -> str | None:
        """Compress chunks sequentially, each building on the previous summary.
        This preserves narrative continuity — later chunks see what happened earlier."""

        def _build_chunk_text(chunk: list[dict]) -> str:
            trimmed = [_trim_message(m) for m in chunk]
            lines = []
            for m in trimmed:
                role = m["role"]
                content = str(m.get("content", ""))
                if not content.strip():
                    tcs = m.get("tool_calls", [])
                    if tcs:
                        names = [tc.get("function", {}).get("name", "?") for tc in tcs]
                        lines.append(f"[{role}]: called {', '.join(names)}")
                    continue
                lines.append(f"[{role}]: {content[:300]}")
            return "\n".join(lines)

        bridge = ""
        summaries = []
        total = len(chunks)

        for ci, chunk in enumerate(chunks):
            chunk_text = _build_chunk_text(chunk)
            if bridge:
                chunk_text = f"[Earlier summary]\n{bridge}\n\n[Current segment]\n{chunk_text}"

            chunk_prompt = [
                {"role": "system", "content": (
                    f"Summarize conversation segment {ci + 1}/{total}. "
                    "If earlier summary is provided, use it as context — do NOT repeat it, "
                    "only add NEW information from the current segment. "
                    "List: user requests, files, tools, errors, decisions. 3-5 sentences. English."
                )},
                {"role": "user", "content": chunk_text},
            ]

            try:
                result = []
                async for chunk_resp in llm_client.chat(messages=chunk_prompt, tools=[], stream=True):
                    if chunk_resp.text:
                        result.append(chunk_resp.text)
                text = "".join(result).strip()
                if not text:
                    return None
                summaries.append(text)
                bridge = text  # carry forward as context for next chunk
            except Exception:
                return None

        if len(summaries) <= 1:
            return summaries[0] if summaries else None

        # Merge all sequential summaries into one coherent summary
        return "\n".join(f"[{i + 1}/{total}] {s}" for i, s in enumerate(summaries))

    def fallback_compress(self, messages: list[dict]) -> str:
        """Rule-based summary when LLM compression isn't available."""
        messages = _strip_thinking_from_messages(messages)
        if not messages:
            return ""

        user_msgs = []
        tool_calls = set()
        errors = []

        for m in messages:
            role = m.get("role", "")
            content = str(m.get("content", ""))
            if role == "user" and content.strip():
                user_msgs.append(content[:100])
            if role == "assistant" and m.get("tool_calls"):
                for tc in m["tool_calls"]:
                    tool_calls.add(tc.get("function", {}).get("name", ""))
            if role == "tool" and "error" in content.lower():
                errors.append(content[:80])

        parts = []
        if user_msgs:
            parts.append(f"User: {'; '.join(user_msgs[-3:])}")
        if tool_calls:
            parts.append(f"Tools: {', '.join(sorted(tool_calls)[:8])}")
        if errors:
            parts.append(f"Errors: {'; '.join(errors[-2:])}")

        n_turns = len([m for m in messages if m.get("role") == "user"])
        return f"[{n_turns} turns] " + " | ".join(parts) if parts else f"{n_turns} prior turns."
