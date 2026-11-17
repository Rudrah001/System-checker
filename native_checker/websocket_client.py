from __future__ import annotations
import asyncio
import json
import websockets
from native_checker.system_checks import collect


class AuthenticationError(Exception):
    """A non-recoverable pairing or resume credential failure."""


async def run(url: str, pairing_code: str, interval: int) -> bool:
    """Monitor until stopped; retry transport failures but not rejected credentials."""
    credential: dict[str, str] = {'type': 'pair', 'code': pairing_code}
    delay = 1
    while True:
        try:
            async with websockets.connect(url, open_timeout=10, ping_interval=10, ping_timeout=10) as ws:
                await ws.send(json.dumps(credential))
                response = json.loads(await ws.recv())
                if response.get('type') != 'authenticated':
                    raise AuthenticationError(response.get('message', 'Authentication failed'))
                # Preserve this server-issued credential for legitimate reconnects.
                credential = {'type': 'resume', 'session_id': response['session_id'], 'native_token': response['native_token']}
                delay = 1
                while True:
                    await ws.send(json.dumps({'type': 'result', 'data': collect()}))
                    await asyncio.sleep(interval)
                    await ws.send(json.dumps({'type': 'heartbeat'}))
        except KeyboardInterrupt:
            return True
        except AuthenticationError as exc:
            print(f'Authentication failed: {exc}. Request a new pairing code and launch again.')
            return False
        except Exception as exc:
            print(f'Connection error: {exc}; retrying in {delay}s')
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)
