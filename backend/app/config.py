from dataclasses import dataclass
import os

@dataclass(frozen=True)
class Settings:
    pairing_ttl_seconds: int = int(os.getenv('PAIRING_TTL_SECONDS', '120'))
    stale_after_seconds: int = int(os.getenv('STALE_AFTER_SECONDS', '15'))

settings = Settings()
