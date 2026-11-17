from native_checker.protocol_handler import parse_launch_url
from backend.app.session_manager import SessionManager
from backend.app.main import app
from datetime import timedelta
from fastapi.testclient import TestClient
from backend.app.session_manager import now
import pytest
def test_url_parsing(): assert parse_launch_url('systemchecker://start?code=abcdefghijklmnopqrst') == 'abcdefghijklmnopqrst'
@pytest.mark.parametrize('url',['http://start?code=abcdefghijklmnopqrst','systemchecker://evil?code=abcdefghijklmnopqrst','systemchecker://start?code=x'])
def test_bad_urls_rejected(url):
    with pytest.raises(ValueError): parse_launch_url(url)

def test_session_id_cannot_be_consumed_as_a_pairing_code():
    manager = SessionManager()
    session = manager.create()
    assert manager.consume_pairing(session.id) is None

def test_valid_pairing_code_can_be_consumed_once():
    manager = SessionManager()
    session = manager.create()
    code, _ = manager.issue_pairing(session)
    assert manager.consume_pairing(code) is session
    assert manager.consume_pairing(code) is None

def test_expired_pairing_code_is_rejected():
    manager = SessionManager()
    session = manager.create()
    code, _ = manager.issue_pairing(session)
    session.pairing_expires_at = now() - timedelta(seconds=1)
    assert manager.consume_pairing(code) is None

def test_valid_pairing_code_authenticates_native_websocket():
    with TestClient(app) as client:
        created = client.post('/api/sessions').json()
        pairing = client.post(f"/api/sessions/{created['session_id']}/pairing", params={'token': created['frontend_token']}).json()
        with client.websocket_connect('/ws/native') as socket:
            socket.send_json({'type': 'pair', 'code': pairing['code']})
            authenticated = socket.receive_json()
    assert authenticated['type'] == 'authenticated'
    assert authenticated['session_id'] == created['session_id']
