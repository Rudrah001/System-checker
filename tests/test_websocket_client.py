import asyncio
import json
from native_checker import websocket_client

class RejectedSocket:
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return None
    async def send(self, _): return None
    async def recv(self): return json.dumps({'type': 'error', 'message': 'Invalid, expired, or used pairing credential'})

def test_invalid_pairing_does_not_retry_indefinitely(monkeypatch, capsys):
    attempts = 0
    def connect(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        return RejectedSocket()
    monkeypatch.setattr(websocket_client.websockets, 'connect', connect)
    assert asyncio.run(websocket_client.run('ws://example/ws/native', 'a' * 24, 5)) is False
    assert attempts == 1
    assert 'Request a new pairing code' in capsys.readouterr().out
