"""
Session manager — persists session state across restarts.
Saves session state to disk after each turn. Supports resume, list, delete.
"""

import json
import os
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SessionMeta:
    id: str
    name: str                          # Auto-generated from first user message
    model: str
    provider: str
    created_at: str
    updated_at: str
    message_count: int
    summary: str = ""                  # One-line summary of the session


class SessionManager:
    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir
        self.sessions_dir = os.path.join(storage_dir, "sessions")
        os.makedirs(self.sessions_dir, exist_ok=True)
        self._current_id: Optional[str] = None

    # ── Session CRUD ─────────────────────────────────────────

    def create(self, model: str, provider: str, name: str = "") -> SessionMeta:
        session_id = datetime.now().strftime("%Y%m%d-%H%M%S")
        meta = SessionMeta(
            id=session_id,
            name=name or f"Session {session_id}",
            model=model,
            provider=provider,
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
            message_count=0,
        )
        self._save_meta(meta)
        self._save_messages(session_id, [])
        self._current_id = session_id
        return meta

    def save(self, messages: list[dict], summary: str = "", summarized_count: int = 0):
        """Save current session messages and compression state to disk."""
        if not self._current_id:
            return
        self._save_messages(self._current_id, messages)
        # Update meta
        meta = self._load_meta(self._current_id)
        if meta:
            meta.updated_at = datetime.now().isoformat()
            meta.message_count = len(messages)
            meta.summary = summary
            # Auto-name from first user message
            if meta.name.startswith("Session ") and messages:
                first_user = next((m for m in messages if m.get("role") == "user"), None)
                if first_user:
                    content = str(first_user.get("content", ""))[:40]
                    meta.name = content.replace("\n", " ")
            self._save_meta(meta)
        # Save compression state separately
        state_path = self._state_path(self._current_id)
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump({"summary": summary, "summarized_count": summarized_count}, f)

    def load(self, session_id: str) -> tuple[Optional[SessionMeta], list[dict], str, int]:
        """Load session. Returns (meta, messages, compression_summary, summarized_count)."""
        meta = self._load_meta(session_id)
        if not meta:
            return None, [], "", 0
        messages = self._load_messages(session_id)
        self._current_id = session_id
        # Load compression state
        state_path = self._state_path(session_id)
        summary, count = "", 0
        if os.path.exists(state_path):
            try:
                with open(state_path, encoding="utf-8") as f:
                    s = json.load(f)
                summary = s.get("summary", "")
                count = s.get("summarized_count", 0)
            except (json.JSONDecodeError, IOError):
                pass
        return meta, messages, summary, count

    def list_sessions(self, limit: int = 20) -> list[SessionMeta]:
        sessions = []
        for fname in sorted(os.listdir(self.sessions_dir), reverse=True):
            if fname.endswith("_meta.json"):
                sid = fname.replace("_meta.json", "")
                meta = self._load_meta(sid)
                if meta:
                    sessions.append(meta)
                    if len(sessions) >= limit:
                        break
        return sessions

    def delete(self, session_id: str):
        meta_path = self._meta_path(session_id)
        msg_path = self._msg_path(session_id)
        state_path = self._state_path(session_id)
        for p in [meta_path, msg_path, state_path]:
            if os.path.exists(p):
                os.remove(p)
        if self._current_id == session_id:
            self._current_id = None

    def resume(self, session_id: str) -> tuple[Optional[SessionMeta], list[dict]]:
        return self.load(session_id)

    @property
    def current_id(self) -> Optional[str]:
        return self._current_id

    def generate_summary(self, messages: list[dict]) -> str:
        """One-line summary of session content."""
        topics = set()
        for m in messages:
            if m.get("role") == "user":
                content = str(m.get("content", ""))
                for kw in ["登录", "注册", "订单", "支付", "API", "接口", "测试", "用户",
                           "login", "order", "api", "test"]:
                    if kw.lower() in content.lower():
                        topics.add(kw)
        if topics:
            return f"涉及: {', '.join(list(topics)[:5])}"
        return f"{len(messages)} 条消息"

    # ── Internal helpers ─────────────────────────────────────

    def _state_path(self, session_id: str) -> str:
        return os.path.join(self.sessions_dir, f"{session_id}_state.json")

    def _meta_path(self, session_id: str) -> str:
        return os.path.join(self.sessions_dir, f"{session_id}_meta.json")

    def _msg_path(self, session_id: str) -> str:
        return os.path.join(self.sessions_dir, f"{session_id}_messages.json")

    def _save_meta(self, meta: SessionMeta):
        with open(self._meta_path(meta.id), "w", encoding="utf-8") as f:
            json.dump({
                "id": meta.id, "name": meta.name,
                "model": meta.model, "provider": meta.provider,
                "created_at": meta.created_at, "updated_at": meta.updated_at,
                "message_count": meta.message_count, "summary": meta.summary,
            }, f, ensure_ascii=False, indent=2)

    def _load_meta(self, session_id: str) -> Optional[SessionMeta]:
        path = self._meta_path(session_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            return SessionMeta(**d)
        except (json.JSONDecodeError, TypeError):
            return None

    def _save_messages(self, session_id: str, messages: list[dict]):
        with open(self._msg_path(session_id), "w", encoding="utf-8") as f:
            json.dump(messages, f, ensure_ascii=False, indent=2)

    def _load_messages(self, session_id: str) -> list[dict]:
        path = self._msg_path(session_id)
        if not os.path.exists(path):
            return []
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
