from backend.app.session_manager import SessionManager
def test_pairing_is_single_use():
    manager=SessionManager(); session=manager.create(); code,_=manager.issue_pairing(session)
    assert manager.consume_pairing(code) is session
    assert manager.consume_pairing(code) is None
