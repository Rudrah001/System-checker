from urllib.parse import parse_qs, urlparse
import re

def parse_launch_url(raw: str) -> str:
    parsed = urlparse(raw)
    if parsed.scheme.lower() != 'systemchecker' or parsed.netloc.lower() != 'start' or parsed.path not in ('', '/'):
        raise ValueError('Expected systemchecker://start?code=...')
    values = parse_qs(parsed.query, strict_parsing=True).get('code', [])
    if len(values) != 1 or not re.fullmatch(r'[A-Za-z0-9_-]{20,200}', values[0]): raise ValueError('Invalid pairing code')
    return values[0]
