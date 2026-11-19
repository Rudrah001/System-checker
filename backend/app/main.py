from __future__ import annotations
import asyncio, logging, secrets
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from .config import settings
from .models import NativeResult, PairingResponse, SessionStatus
from .session_manager import sessions
from .websocket_manager import websockets

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
log = logging.getLogger('system-check')
PROJECT_ROOT = Path(__file__).resolve().parents[2]
INSTALLER_PATH = PROJECT_ROOT / 'installer-output' / 'SystemCheckerSetup.exe'
INSTALLER_FILENAME = 'SystemCheckerSetup.exe'
app = FastAPI(title='System Check POC')
app.add_middleware(
    CORSMiddleware,
    # Vite chooses the next free port (5173, 5174, …), so allow only loopback
    # origins at any local development port rather than a single fragile port.
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.on_event('startup')
async def start_stale_monitor():
    async def watch():
        while True:
            for session in list(sessions.sessions.values()):
                current = sessions.connection_state(session)
                if session.last_announced_state != current:
                    session.last_announced_state = current
                    await websockets.publish(session.id, {'type':'status','data':snapshot(session).model_dump(mode='json')})
            await asyncio.sleep(1)
    asyncio.create_task(watch())

def require_frontend(session_id: str, token: str | None):
    session = sessions.get(session_id)
    if not session or not token or not secrets.compare_digest(session.frontend_token, token): raise HTTPException(403, 'Invalid session capability')
    return session
def snapshot(session):
    return SessionStatus(session_id=session.id, native_connection=sessions.connection_state(session), latest_result=session.result, created_at=session.created_at, paired_at=session.paired_at, last_seen_at=session.last_seen_at)

@app.post('/api/sessions')
async def create_session():
    s = sessions.create(); log.info('session_created id=%s', s.id)
    return {'session_id': s.id, 'frontend_token': s.frontend_token, 'created_at': s.created_at}

@app.get('/api/download/system-checker')
async def download_system_checker():
    """Serve the fixed local-POC installer; no client path is accepted."""
    if not INSTALLER_PATH.is_file():
        raise HTTPException(status_code=503, detail='System Checker installer is not currently available. Please contact support.')
    return FileResponse(
        path=INSTALLER_PATH,
        media_type='application/vnd.microsoft.portable-executable',
        filename=INSTALLER_FILENAME,
        headers={'Cache-Control': 'no-store'},
    )
@app.post('/api/sessions/{session_id}/pairing', response_model=PairingResponse)
async def pairing(session_id: str, token: str):
    s = require_frontend(session_id, token); code, expires = sessions.issue_pairing(s); return PairingResponse(code=code, expires_at=expires)
@app.get('/api/sessions/{session_id}/status', response_model=SessionStatus)
async def get_status(session_id: str, token: str): return snapshot(require_frontend(session_id, token))

@app.websocket('/ws/interview/{session_id}')
async def interview_ws(ws: WebSocket, session_id: str, token: str):
    try: s = require_frontend(session_id, token)
    except HTTPException: await ws.close(code=status.WS_1008_POLICY_VIOLATION); return
    await ws.accept(); await websockets.add(session_id, ws); await ws.send_json({'type':'status','data':snapshot(s).model_dump(mode='json')})
    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    finally: websockets.remove(session_id, ws)

@app.websocket('/ws/native')
async def native_ws(ws: WebSocket):
    await ws.accept(); session = None; connection_id = None
    try:
        auth = await asyncio.wait_for(ws.receive_json(), timeout=10)
        if auth.get('type') == 'pair' and isinstance(auth.get('code'), str): session = sessions.consume_pairing(auth['code'])
        elif auth.get('type') == 'resume' and isinstance(auth.get('native_token'), str):
            candidate = sessions.get(auth.get('session_id', ''))
            if candidate and candidate.native_token and secrets.compare_digest(candidate.native_token, auth['native_token']): session = candidate
        if not session: await ws.send_json({'type':'error','message':'Invalid, expired, or used pairing credential'}); await ws.close(code=1008); return
        connection_id = secrets.token_urlsafe(12); session.active_connection_id = connection_id; session.last_seen_at = datetime.now(timezone.utc); session.last_announced_state = 'CONNECTED'; await ws.send_json({'type':'authenticated','session_id':session.id,'native_token':session.native_token}); await websockets.publish(session.id, {'type':'status','data':snapshot(session).model_dump(mode='json')})
        while True:
            message = await ws.receive_json(); session.last_seen_at = datetime.now(timezone.utc)
            if message.get('type') == 'result':
                session.result = NativeResult.model_validate(message.get('data', {})); await websockets.publish(session.id, {'type':'status','data':snapshot(session).model_dump(mode='json')})
            elif message.get('type') == 'heartbeat': await websockets.publish(session.id, {'type':'status','data':snapshot(session).model_dump(mode='json')})
    except (WebSocketDisconnect, asyncio.TimeoutError): pass
    finally:
        if session and session.active_connection_id == connection_id:
            session.last_seen_at = None; session.last_announced_state = 'DISCONNECTED'
            await websockets.publish(session.id, {'type':'status','data':snapshot(session).model_dump(mode='json')})
