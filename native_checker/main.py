import asyncio, sys
from native_checker.config import load_config
from native_checker.protocol_handler import parse_launch_url
from native_checker.websocket_client import run

def main() -> int:
    if len(sys.argv) != 2: print('Usage: SystemChecker.exe systemchecker://start?code=...'); return 2
    try: code=parse_launch_url(sys.argv[1]); config=load_config()
    except ValueError as exc: print(f'Launch rejected: {exc}'); return 2
    return 0 if asyncio.run(run(config.backend_ws_url, code, config.interval_seconds)) else 3
if __name__ == '__main__': raise SystemExit(main())
