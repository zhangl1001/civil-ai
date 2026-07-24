"""
Context Manager - manages the conversation context window.
Handles message history, token counting, compression triggers, and checkpoints.
"""

from dataclasses import dataclass, field
from typing import Optional, Callable
from context.compressor import ContextCompressor
from context.checkpoint import CheckpointManager, Checkpoint

KEEP_RECENT_TURNS = 12  # Keep last ~6 real turns (faster, enough continuity)
COMPRESSION_THRESHOLD = 0.7  # Trigger earlier to keep context lean
MAX_SUMMARY_CHARS = 6000  # Cap summary to ~2K tokens; older parts are less relevant.


@dataclass
class ContextManager:
    """Manages the full conversation context for an agent session."""

    messages: list[dict] = field(default_factory=list)
    max_tokens: int = 128000  # Modern models: DeepSeek V4 128K, Qwen 3 128K+
    compressor: ContextCompressor = field(default_factory=ContextCompressor)
    checkpoint_mgr: CheckpointManager = field(default_factory=CheckpointManager)
    keep_thinking_turns: int = 0  # 0 = keep all; N = only last N assistant messages
    _summary: str = ""
    _summarized_count: int = 0  # How many original messages were summarized

    def add_message(self, message: dict):
        """Extract thinking blocks into a private _thinking field.

        Thinking is stored on the message but outside content, so it doesn't
        pollute token counting, compression, or context management. It gets
        merged back in get_messages() only when sending to the LLM — DeepSeek
        requires reasoning_content to be passed back in conversation history.
        """
        if message.get("role") == "assistant" and isinstance(message.get("content"), list):
            thinking = []
            non_thinking = []
            for b in message["content"]:
                if isinstance(b, dict) and b.get("type") == "thinking":
                    thinking.append(b)
                else:
                    non_thinking.append(b)
            if thinking:
                message = dict(message)
                message["_thinking"] = thinking
                message["content"] = non_thinking if non_thinking else [{"type": "text", "text": ""}]
        self.messages.append(message)

    def get_messages(self) -> list[dict]:
        """Get current messages. If summary exists, prepend it.

        Merges thinking blocks from _thinking back into content so DeepSeek
        receives the reasoning_content it requires.
        """
        result = []
        if self._summary:
            result.append({
                "role": "system",
                "content": f"[Previous conversation summary]\n{self._summary}"
            })

        # Truncate stale thinking to a placeholder. DeepSeek requires the
        # reasoning_content field to exist, but the content can be minimal.
        if self.keep_thinking_turns > 0:
            asst_count = 0
            for msg in reversed(self.messages):
                if msg.get("role") == "assistant" and msg.get("_thinking"):
                    asst_count += 1
                    if asst_count > self.keep_thinking_turns:
                        msg["_thinking"] = [{"type": "thinking", "thinking": "[…]"}]

        for msg in self.messages:
            thinking = msg.get("_thinking")
            if thinking and msg.get("role") == "assistant":
                out = {k: v for k, v in msg.items() if k != "_thinking"}
                content = out.get("content")
                if isinstance(content, list):
                    out["content"] = thinking + content
                else:
                    out["content"] = thinking
                result.append(out)
            else:
                result.append({k: v for k, v in msg.items() if k != "_thinking"})
        return result

    def estimate_tokens(self) -> int:
        """Rough token estimation. CJK ~1 char/token, English ~4 chars/token.
        Thinking blocks are stored in _thinking, not content, so they're
        naturally excluded from the token count."""
        total = 0
        for m in self.messages:
            content_raw = m.get("content", "")
            if isinstance(content_raw, list):
                content = str([b for b in content_raw
                              if not (isinstance(b, dict) and b.get("type") == "thinking")])
            else:
                content = str(content_raw)
            # Count CJK characters (higher token density) vs ASCII
            cjk = sum(1 for c in content if '一' <= c <= '鿿' or '　' <= c <= '〿')
            ascii_chars = len(content) - cjk
            total += cjk + (ascii_chars // 3)
            # Count tool_calls arguments — can be large JSON objects
            if m.get("tool_calls"):
                for tc in m["tool_calls"]:
                    args = tc.get("function", {}).get("arguments", "")
                    total += len(args) // 3
        if self._summary:
            total += len(self._summary) // 3
        return total

    def should_compress(self) -> bool:
        """Check if compression is needed."""
        return self.estimate_tokens() > self.max_tokens * COMPRESSION_THRESHOLD

    async def maybe_compress(self, llm_client, force: bool = False) -> bool:
        """Compress old messages if token limit is approaching. Returns True if compressed."""
        if not force and not self.should_compress():
            return False

        non_system = [m for m in self.messages if m["role"] != "system"]
        # Always preserve the last 8 messages — they carry the freshest context
        KEEP_LAST = 8
        if force:
            keep_count = KEEP_LAST
        else:
            keep_count = KEEP_RECENT_TURNS

        if len(non_system) <= keep_count + 2:
            if not force:
                return False
            keep_count = max(0, len(non_system) - 4)

        to_compress = non_system[:-keep_count] if keep_count > 0 else non_system
        to_keep = non_system[-keep_count:] if keep_count > 0 else []

        # --- Protect tool_use/tool_result pairs from being split across the
        # compression boundary. Two cases:
        # 1. to_keep starts with a tool_result → pull back its preceding assistant
        #    message (which holds the tool_use).
        # 2. Any tool_result in to_keep references a tool_call_id from to_compress →
        #    pull back that assistant message + everything between them.
        # Otherwise Anthropic API returns 400: orphaned tool_use_id.

        # Case 1: front-boundary protection
        while to_keep and to_keep[0]["role"] == "tool" and to_compress:
            to_keep.insert(0, to_compress.pop())

        # Case 2: build a set of tool_call_ids still present in to_compress,
        # then scan to_keep for tool_results that reference them.
        if to_compress:
            tool_use_ids_in_compress = set()
            for m in to_compress:
                if m["role"] == "assistant" and m.get("tool_calls"):
                    for tc in m["tool_calls"]:
                        tool_use_ids_in_compress.add(tc["id"])

            if tool_use_ids_in_compress:
                # Find all tool_call_ids referenced by tool_results in to_keep
                referenced_ids = set()
                for m in to_keep:
                    if m["role"] == "tool" and m.get("tool_call_id"):
                        referenced_ids.add(m["tool_call_id"])

                orphan_ids = referenced_ids & tool_use_ids_in_compress
                if orphan_ids:
                    # Find the last assistant message in to_compress that holds
                    # any orphaned tool_use, and move everything from there to
                    # to_keep (preserving order).
                    last_orphan_idx = -1
                    for idx, m in enumerate(to_compress):
                        if m["role"] == "assistant" and m.get("tool_calls"):
                            for tc in m["tool_calls"]:
                                if tc["id"] in orphan_ids:
                                    last_orphan_idx = idx

                    if last_orphan_idx >= 0:
                        to_keep = to_compress[last_orphan_idx:] + to_keep
                        to_compress = to_compress[:last_orphan_idx]

        system_msgs = [m for m in self.messages if m["role"] == "system"]

        try:
            new_summary = await self.compressor.compress(to_compress, llm_client)
        except Exception:
            new_summary = self.compressor.fallback_compress(to_compress)

        if self._summary:
            # Cap old summary before appending — older parts lose detail.
            # Keep last ~4000 chars of old summary + new summary.
            old = self._summary
            if len(old) > MAX_SUMMARY_CHARS:
                old = old[-(MAX_SUMMARY_CHARS - 500):]
                old = "[... older context truncated ...]\n" + old
            self._summary = old + "\n" + new_summary
        else:
            self._summary = new_summary

        # Hard cap: if summary exceeds limit after append, trim the front.
        if len(self._summary) > MAX_SUMMARY_CHARS * 2:
            self._summary = "[... older context truncated ...]\n" + self._summary[-(MAX_SUMMARY_CHARS * 2 - 50):]

        self._summarized_count += len(to_compress)
        self.messages = system_msgs + to_keep

        # If forced, our token estimate was wrong — reduce max_tokens to match reality
        if force:
            current_est = self.estimate_tokens()
            if current_est > 0:
                self.max_tokens = max(current_est + 4096, 16000)

        return True

    # --- Checkpoint shortcuts ---

    def checkpoint(self, description: str = "") -> Checkpoint:
        """Create a checkpoint of current message state."""
        return self.checkpoint_mgr.save(self.messages, description, summary=self._summary)

    def undo(self, steps: int = 1) -> Optional[Checkpoint]:
        cp = self.checkpoint_mgr.undo(steps)
        if cp:
            self.messages = [dict(m) for m in cp.messages_snapshot]
            self._summary = getattr(cp, "summary_snapshot", "")
        return cp

    def redo(self, steps: int = 1) -> Optional[Checkpoint]:
        cp = self.checkpoint_mgr.redo(steps)
        if cp:
            self.messages = [dict(m) for m in cp.messages_snapshot]
            self._summary = getattr(cp, "summary_snapshot", "")
        return cp
