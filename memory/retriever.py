"""
Memory retriever - selects the most relevant memories for current context.
"""

from typing import Optional
from memory.store import MemoryStore, Memory, MemoryType


class MemoryRetriever:
    def __init__(self, store: MemoryStore):
        self.store = store

    async def retrieve(self, query: str, top_k: int = 5) -> list[Memory]:
        """Retrieve relevant memories for a given query."""
        all_memories = self.store.recall(query=query, top_k=top_k)

        # Prioritize: user > project > pattern > feedback
        priority_order = [MemoryType.USER, MemoryType.PROJECT, MemoryType.PATTERN, MemoryType.FEEDBACK]
        all_memories.sort(key=lambda m: priority_order.index(m.type) if m.type in priority_order else 99)

        return all_memories[:top_k]

    def get_user_context(self) -> str:
        """Get user-related memories for system prompt injection."""
        return self.store.get_context_injection(query="user preference role")
