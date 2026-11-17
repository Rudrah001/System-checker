from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import secrets
from .config import settings
from .models import NativeResult

def now() -> datetime: return datetime.now(timezone.utc)

@dataclass
class Session:
    id: str
    frontend_token: str
    created_at: datetime = field(default_factory=now)
    pairing_code: str | None = None
    pairing_expires_at: datetime | None = None
    native_token: str | None = None
    paired_at: datetime | None = None
    last_seen_at: datetime | None = None
    result: NativeResult | None = None
    last_announced_state: str | None = None
    active_connection_id: str | None = None

class SessionManager:
    def __init__(self) -> None: self.sessions: dict[str, Session] = {}
    def create(self) -> Session:
        session = Session(secrets.token_urlsafe(18), secrets.token_urlsafe(32)); self.sessions[session.id] = session; return session
    def get(self, session_id: str) -> Session | None: return self.sessions.get(session_id)
    def issue_pairing(self, session: Session) -> tuple[str, datetime]:
        code = secrets.token_urlsafe(24); expires = now() + timedelta(seconds=settings.pairing_ttl_seconds)
        session.pairing_code, session.pairing_expires_at = code, expires; return code, expires
    def consume_pairing(self, code: str) -> Session | None:
        for session in self.sessions.values():
            if session.pairing_code and secrets.compare_digest(session.pairing_code, code) and session.pairing_expires_at and now() < session.pairing_expires_at:
                session.pairing_code = None; session.pairing_expires_at = None; session.native_token = secrets.token_urlsafe(32); session.paired_at = now(); return session
        return None
    def connection_state(self, session: Session) -> str:
        if not session.last_seen_at: return 'DISCONNECTED'
        return 'STALE' if (now() - session.last_seen_at).total_seconds() > settings.stale_after_seconds else 'CONNECTED'

sessions = SessionManager()
