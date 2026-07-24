"""
Memory storage - persistent, file-based memory across sessions.
"""

import json
import os
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


class MemoryType(str, Enum):
    USER = "user"
    FEEDBACK = "feedback"
    PROJECT = "project"
    PATTERN = "pattern"


@dataclass
class Memory:
    id: str
    type: MemoryType
    content: str
    description: str = ""
    created_at: str = ""
    updated_at: str = ""


class MemoryStore:
    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir
        os.makedirs(storage_dir, exist_ok=True)
        self._index_file = os.path.join(storage_dir, "MEMORY.md")
        self._ensure_index()

    def _ensure_index(self):
        if not os.path.exists(self._index_file):
            with open(self._index_file, "w", encoding="utf-8") as f:
                f.write("# Memory\n\n")

    def _memory_path(self, memory_id: str) -> str:
        return os.path.join(self.storage_dir, f"{memory_id}.json")

    def remember(self, type: MemoryType, content: str, description: str = "") -> Memory:
        now = datetime.now().isoformat()
        memory_id = f"{type.value}-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        memory = Memory(
            id=memory_id,
            type=type,
            content=content,
            description=description or self._short_desc(content),
            created_at=now,
            updated_at=now,
        )

        # Write memory file
        with open(self._memory_path(memory_id), "w", encoding="utf-8") as f:
            json.dump({
                "id": memory.id,
                "type": memory.type.value,
                "content": memory.content,
                "description": memory.description,
                "created_at": memory.created_at,
                "updated_at": memory.updated_at,
            }, f, ensure_ascii=False, indent=2)

        # Update index
        with open(self._index_file, "a", encoding="utf-8") as f:
            f.write(f"- [{memory.id}]({memory_id}.json) — {memory.description}\n")

        return memory

    def recall(self, query: str = "", memory_type: Optional[MemoryType] = None, top_k: int = 10) -> list[Memory]:
        """Retrieve memories. Simple keyword match for MVP, upgrade to embeddings later."""
        results = []
        for filename in os.listdir(self.storage_dir):
            if not filename.endswith(".json"):
                continue
            filepath = os.path.join(self.storage_dir, filename)
            try:
                with open(filepath, encoding="utf-8") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, IOError):
                continue

            if memory_type and data.get("type") != memory_type.value:
                continue

            if query:
                content_lower = data.get("content", "").lower()
                desc_lower = data.get("description", "").lower()
                query_lower = query.lower()
                # Simple keyword scoring
                score = 0
                for word in query_lower.split():
                    if word in content_lower:
                        score += 1
                    if word in desc_lower:
                        score += 2
                if score == 0:
                    continue

            results.append(Memory(
                id=data["id"],
                type=MemoryType(data["type"]),
                content=data["content"],
                description=data.get("description", ""),
                created_at=data.get("created_at", ""),
                updated_at=data.get("updated_at", ""),
            ))

        results.sort(key=lambda m: m.updated_at, reverse=True)
        return results[:top_k]

    def forget(self, memory_id: str) -> bool:
        path = self._memory_path(memory_id)
        if os.path.exists(path):
            os.remove(path)
        return True

    def list_by_type(self, memory_type: MemoryType) -> list[Memory]:
        return self.recall(memory_type=memory_type, top_k=100)

    def get_context_injection(self, query: str = "") -> str:
        """Generate a memory summary to inject into the system prompt."""
        memories = self.recall(query=query, top_k=5)
        if not memories:
            return ""

        lines = ["\n[Relevant memories from past sessions]"]
        for m in memories:
            lines.append(f"- [{m.type.value}] {m.description}: {m.content[:200]}")
        return "\n".join(lines)

    @staticmethod
    def _short_desc(content: str) -> str:
        return content[:80].replace("\n", " ") + ("..." if len(content) > 80 else "")
