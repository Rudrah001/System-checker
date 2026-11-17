from dataclasses import dataclass
import json, os, sys
from urllib.parse import urlparse

@dataclass(frozen=True)
class Config:
    # Local-only development default. Deployment must set a trusted WSS value.
    backend_ws_url: str = os.getenv('SYSTEM_CHECK_BACKEND_WS', 'ws://127.0.0.1:8000/ws/native')
    interval_seconds: int = 5

def load_config() -> Config:
    # A frozen EXE needs its externally managed config next to the executable,
    # not inside PyInstaller's temporary extraction directory.
    base_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(__file__)
    path = os.path.join(base_dir, 'config.local.json')
    if not os.path.exists(path): return Config()
    with open(path, encoding='utf-8') as source: data = json.load(source)
    url = data.get('backend_ws_url')
    parsed = urlparse(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme not in ('ws', 'wss') or not parsed.hostname or parsed.path != '/ws/native' or parsed.query or parsed.fragment:
        raise ValueError('Invalid trusted backend_ws_url; expected ws(s)://host/ws/native')
    return Config(backend_ws_url=url, interval_seconds=int(data.get('interval_seconds', 5)))
