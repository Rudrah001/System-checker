from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field

Status = Literal['PASS', 'FAIL', 'UNKNOWN']

class PairingResponse(BaseModel):
    code: str
    expires_at: datetime

class NativeResult(BaseModel):
    timestamp: datetime
    os: str
    monitor_count: int | None = None
    keyboard_count: int | None = None
    mouse_count: int | None = None
    is_rdp: bool | None = None
    virtual_machine: bool | None = None
    remote_access_tools: list[str] = Field(default_factory=list)
    check_errors: dict[str, str] = Field(default_factory=dict)
    status: Status
    failure_reasons: list[str] = Field(default_factory=list)

class SessionStatus(BaseModel):
    session_id: str
    native_connection: Literal['CONNECTED', 'DISCONNECTED', 'STALE']
    latest_result: NativeResult | None
    created_at: datetime
    paired_at: datetime | None
    last_seen_at: datetime | None
