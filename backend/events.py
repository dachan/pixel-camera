"""Server-sent-events fan-out.

A tiny thread-safe pub/sub used to push capture events to every open kiosk
page. Each subscriber is a queue drained by an SSE response generator.

Dead-connection cleanup: EventSource clients auto-reconnect, and a dropped
connection is only noticed when a write to it fails — which requires sending
something. The stream therefore emits a keepalive comment whenever no event
arrives within KEEPALIVE_S, so stale subscribers are flushed within seconds
instead of lingering (and buffering every future event) indefinitely.
"""

from __future__ import annotations

import queue
import threading


class SseBroadcaster:
    KEEPALIVE_S = 15

    def __init__(self):
        self._lock = threading.Lock()
        self._queues: list[queue.Queue] = []

    def publish(self, data: str) -> None:
        """Send ``data`` to every currently-subscribed stream."""
        with self._lock:
            subscribers = list(self._queues)
        for q in subscribers:
            q.put(data)

    def stream(self):
        """Generator of SSE-formatted messages for one subscriber.

        Pass directly to a ``Response`` with mimetype ``text/event-stream``.
        Unsubscribes itself when the client disconnects (the generator is
        closed by the server when a write fails).
        """
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._queues.append(q)
        try:
            while True:
                try:
                    yield f"data: {q.get(timeout=self.KEEPALIVE_S)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            with self._lock:
                if q in self._queues:
                    self._queues.remove(q)
