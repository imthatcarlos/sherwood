"""Thread-safe ring buffer of <sherwood-event> blocks to inject into the LLM's next turn."""
from __future__ import annotations

import threading
from collections import deque

DEFAULT_MAX = 200


class EventBuffer:
    def __init__(self, maxlen: int = DEFAULT_MAX) -> None:
        self._q: deque[str] = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def push(self, block: str) -> None:
        with self._lock:
            self._q.append(block)

    def drain(self) -> list[str]:
        with self._lock:
            items = list(self._q)
            self._q.clear()
            return items

    def __len__(self) -> int:
        with self._lock:
            return len(self._q)
