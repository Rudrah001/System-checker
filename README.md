# System Check POC

An independent FastAPI + React + Windows native-checker demonstration. The React app creates an in-memory demo session and holds its random capability token only in memory. It requests a single-use, expiring pairing code and opens `systemchecker://start?code=...`. The installed checker validates only that URL, connects directly to the configured FastAPI WebSocket, consumes the pairing code, then receives a separate native credential for reconnects. The backend forwards authenticated updates to the separately authenticated frontend socket. No browser-to-native localhost channel and no localhost WebSocket server are created.

## Run locally (Windows PowerShell)

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt -r native_checker\requirements.txt pytest
$env:PYTHONPATH = (Get-Location).Path
uvicorn backend.app.main:app --reload --port 8000
```

In another PowerShell window:

```powershell
cd frontend
npm install
npm run dev
```

For source-mode testing, use a code obtained from the dashboard:

```powershell
$env:PYTHONPATH = (Get-Location).Path
python -m native_checker.main 'systemchecker://start?code=PASTE_CODE'
```

In Vite development mode, **Generate Git Bash Fallback** displays a one-time
Git Bash command using the actual pairing code returned by the backend. It is a
fallback only; **Start System Check** always requests Windows to open the custom
protocol URL. Copy the fallback before it expires; do not substitute the session
ID. The fallback UI is deliberately absent from production builds:

```bash
cd /c/Projects/system-check-poc
export PYTHONPATH="$PWD"
python -m native_checker.main 'systemchecker://start?code=ACTUAL_PAIRING_CODE'
```

Run tests with `pytest -q`. The native check is Windows-only; on unsupported systems its commands fail safely and the result is `UNKNOWN`.

## Package and install

### Build and register for local development

The EXE has a visible console deliberately, so URL parsing/authentication errors
are diagnosable during development. It defaults to
`ws://127.0.0.1:8000/ws/native`; the protocol URL can never select a backend.

```powershell
# From C:\Projects\system-check-poc
powershell -ExecutionPolicy Bypass -File .\installer\build_exe.ps1
Test-Path .\dist\SystemChecker.exe
powershell -ExecutionPolicy Bypass -File .\installer\register_protocol.ps1
reg query "HKCU\Software\Classes\systemchecker\shell\open\command"
```

The queried command must be equivalent to:

```text
"C:\Projects\system-check-poc\dist\SystemChecker.exe" "%1"
```

This writes only the current-user `HKCU\Software\Classes\systemchecker` key;
administrator access is not required. To remove it:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\unregister_protocol.ps1
```

For a normal installer, compile `installer\installer.iss` with Inno Setup:

```powershell
ISCC .\installer\installer.iss
```

For an external deployment, create `config.local.json` next to the installed
EXE with a trusted exact endpoint, for example
`{"backend_ws_url":"wss://checks.example.com/ws/native"}`. URL parameters
cannot override it. Production needs HTTPS/WSS, persistence/rate-limits/audit
logs, a real frontend authentication model, credential revocation, and code
signing.

### Automatic protocol test

1. Start FastAPI at `127.0.0.1:8000` and Vite.
2. Build/register the EXE with the commands above.
3. Refresh the React page, create a demo interview, then click **Start System
   Check**.
4. Approve the browser's external-application prompt. The browser opens
   `systemchecker://start?code=<one-time-code>`; Windows supplies the complete
   URL as the EXE's single argument.
5. Wait for the dashboard's backend-originated state to become `CONNECTED` and
   for the first result. Opening the URL alone is not treated as success.
6. Close the EXE and verify `DISCONNECTED`; click Retry launch for a fresh code.

### Troubleshooting

- `Invalid, expired, or used pairing credential`: generate a fresh pairing code;
  session IDs are not pairing codes and rejected credentials intentionally exit.
- No browser prompt: verify the registry query above, verify the EXE path exists,
  then re-register after rebuilding.
- EXE cannot reach the backend: confirm FastAPI is listening at
  `http://127.0.0.1:8000` and the configured WebSocket endpoint is
  `ws://127.0.0.1:8000/ws/native`.
- Vite fallback: use **Generate Git Bash Fallback** only in development; it
  creates a separate one-time pairing code and never appears in a production
  bundle.

## Demo checklist

1. Create a demo interview; copy the shown random session ID if desired.
2. Start System Check and approve the external-app browser prompt.
3. Confirm the dashboard changes to `CONNECTED` only after server authentication; the first valid complete scan is `PASS`.
4. Add a monitor or launch a recognized remote tool (AnyDesk/TeamViewer/VNC) and wait five seconds for `FAIL` (manual hardware/process test).
5. Close the checker and observe disconnected/stale state; old results are never connection-current.
6. Retry launch to issue a new pairing code and reconnect. Reusing, expiring, or altering a code is rejected.
7. Mocked test verifies a command failure produces `UNKNOWN`, rather than a false pass.

## Reference review notes

All supplied source files and both archive manifests were inspected without executing the bundled EXE/BAT. `system_check 1.py` and `system_check_poster_mongo 1.py` have the broadest detection coverage (monitors, keyboards, mice, VM, RDP, and remote tools); the EXE reference only checks RDP/VM. Reference versions use HTTP POST, pass arbitrary interview IDs, employ `shell=True`, and commonly turn command errors into `False`/zero, which can create incorrect `PASS` results. This POC keeps the monitoring scope only, reports failures as `UNKNOWN`, and uses pairing credentials instead of a supplied interview ID. Counts are device-instance heuristics: Windows does not reliably map friendly keyboard names to distinct physical keyboards, and VM matching is heuristic.

## Validation scope

Automated tests cover pairing single-use/expiration, session-ID rejection,
native WebSocket pairing, protocol parsing, rejected-authentication no-retry,
and safe unknown outcomes. This POC was also built with PyInstaller, registered
under HKCU, and launched through the registered protocol against the local
backend; the resulting live Windows scan and disconnect state were observed.
Browser-specific external-application confirmation, React click-to-browser
protocol invocation, Inno Setup compilation, and any hardware policy scenario
other than the local scan still require manual verification in the target browser
and installation environment.
