from __future__ import annotations
from collections import defaultdict
from fastapi import WebSocket

class WebSocketManager:
    def __init__(self) -> None: self.frontends: dict[str, set[WebSocket]] = defaultdict(set)
    async def add(self, session_id: str, ws: WebSocket) -> None: self.frontends[session_id].add(ws)
    def remove(self, session_id: str, ws: WebSocket) -> None: self.frontends[session_id].discard(ws)
    async def publish(self, session_id: str, event: dict) -> None:
        dead = []
        for ws in list(self.frontends[session_id]):
            try: await ws.send_json(event)
            except Exception: dead.append(ws)
        for ws in dead: self.remove(session_id, ws)

websockets = WebSocketManager()
