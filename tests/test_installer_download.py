from pathlib import Path
from fastapi.testclient import TestClient
from backend.app import main


def test_installer_download_serves_fixed_artifact():
    with TestClient(main.app) as client:
        response = client.get('/api/download/system-checker')
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('application/vnd.microsoft.portable-executable')
    assert 'attachment; filename="SystemCheckerSetup.exe"' in response.headers['content-disposition']
    assert response.content[:2] == b'MZ'


def test_installer_download_reports_missing_artifact(monkeypatch):
    monkeypatch.setattr(main, 'INSTALLER_PATH', Path('C:/not-a-real-installer/SystemCheckerSetup.exe'))
    with TestClient(main.app) as client:
        response = client.get('/api/download/system-checker')
    assert response.status_code == 503
    assert response.json()['detail'] == 'System Checker installer is not currently available. Please contact support.'
