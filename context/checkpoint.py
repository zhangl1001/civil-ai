"""
Checkpoint management - supports undo/redo for agent sessions.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Checkpoint:
    id: str
    messages_snapshot: list[dict]
    description: str
    created_at: datetime = field(default_factory=datetime.now)
    summary_snapshot: str = ""  # captures context manager's _summary at checkpoint time


class CheckpointManager:
    def __init__(self, max_checkpoints: int = 20):
        self.checkpoints: list[Checkpoint] = []
        self.max_checkpoints = max_checkpoints
        self._current_index: int = -1
        self._checkpoint_counter: int = 0

    def save(self, messages: list[dict], description: str = "", summary: str = "") -> Checkpoint:
        """Create a checkpoint from current messages and summary.

        If called after undo, discards the redo branch (standard undo/redo behavior).
        """
        # Discard redo branch — any checkpoints after _current_index are unreachable
        if self._current_index < len(self.checkpoints) - 1:
            self.checkpoints = self.checkpoints[: self._current_index + 1]

        self._checkpoint_counter += 1
        cp = Checkpoint(
            id=f"ckpt-{self._checkpoint_counter}",
            messages_snapshot=[dict(m) for m in messages],
            description=description,
            summary_snapshot=summary,
        )
        self.checkpoints.append(cp)
        self._current_index = len(self.checkpoints) - 1

        # Evict oldest if over limit
        if len(self.checkpoints) > self.max_checkpoints:
            self.checkpoints.pop(0)
            self._current_index -= 1

        return cp

    def undo(self, steps: int = 1) -> Optional[Checkpoint]:
        """Go back N checkpoints. Returns the checkpoint to restore to."""
        target = self._current_index - steps
        if target < 0:
            return None
        self._current_index = target
        return self.checkpoints[self._current_index]

    def redo(self, steps: int = 1) -> Optional[Checkpoint]:
        """Go forward N checkpoints. Returns the checkpoint to restore to."""
        target = self._current_index + steps
        if target >= len(self.checkpoints):
            return None
        self._current_index = target
        return self.checkpoints[self._current_index]

    def list_checkpoints(self) -> list[dict]:
        """List all checkpoints with descriptions."""
        return [
            {"id": cp.id, "description": cp.description, "created_at": cp.created_at.isoformat()}
            for cp in self.checkpoints
        ]
