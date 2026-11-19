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

### Candidate installer download flow

For this local POC, FastAPI serves the already-built fixed installer at
`GET /api/download/system-checker`. The React page shows **Download System
Checker for Windows** before a session is created and after one is created.
The browser downloads `SystemCheckerSetup.exe`; it never installs or executes
the file automatically.

Candidate steps:

1. Click **Download System Checker for Windows**.
2. Open `SystemCheckerSetup.exe` from the browser download list and finish the
   one-time Windows installation.
3. Return to the interview page and click **Start System Check**.
4. Approve the browser external-application prompt if shown.

The browser cannot reliably identify a missing custom-protocol handler. After
Start System Check, the UI waits 12 seconds for the backend-authenticated native
WebSocket connection; if it does not appear, it offers a download/install and
retry explanation. Opening the URL is never treated as a successful connection.

### Browser-only monitor demonstration

The dashboard also includes **Check Monitors in Browser**, independent from the
native checker. It invokes the browser Window Management API only after the
candidate clicks it, requests display permission, and reports `PASS` for one
browser-visible screen, `FAIL` for more than one, or `UNKNOWN` for an
unsupported API, non-secure context, denied permission, or other error. After a
successful check, it listens for browser `screenschange` events and refreshes
the displayed count when available displays change.

Use Chrome or Edge on `localhost` (or HTTPS) for manual testing. Browser
results can exclude mirrored displays and are not equivalent to native OS-level
device detection; they never change the native interview policy or its result.

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

### Build the one-time Windows installer

The installer packages the already-built `dist\SystemChecker.exe` and the
local-POC trusted configuration (`ws://127.0.0.1:8000/ws/native`). It is a
per-user installer and defaults to `%LOCALAPPDATA%\SystemCheckerPOC`; it does
not require administrator privileges.

Install Inno Setup, then compile from the project root. This workstation uses
Inno Setup 7; substitute the versioned installation directory if yours differs:

```powershell
& 'C:\Program Files\Inno Setup 7\ISCC.exe' .\installer\installer.iss
Test-Path .\installer-output\SystemCheckerSetup.exe
```

The output is `installer-output\SystemCheckerSetup.exe`. Before the installer
replaces an existing `systemchecker://` handler, it displays that handler and
asks for confirmation. It installs this protocol command:

```text
"%LOCALAPPDATA%\SystemCheckerPOC\SystemChecker.exe" "%1"
```

The installer removes the entire protocol key during uninstall only if that
command still points to its own installed EXE. If another application later
owns the protocol, the installer leaves the other registration untouched.

### Install, verify, and recover

1. Run `installer-output\SystemCheckerSetup.exe` as the current user and
   accept the existing-handler replacement prompt only if expected.
2. Confirm the installed files and association:

   ```powershell
   Test-Path "$env:LOCALAPPDATA\SystemCheckerPOC\SystemChecker.exe"
   reg query "HKCU\Software\Classes\systemchecker\shell\open\command"
   ```

3. Start FastAPI/Vite, create a demo session, click **Start System Check**, and
   approve the browser prompt. Verify `CONNECTED`, a live result, then close
   the EXE and verify `DISCONNECTED`. Retry launch to test a fresh pairing code.
4. Uninstall from Windows **Installed apps** / the generated uninstaller. Verify
   the installed EXE is removed, the protocol key is removed only when owned by
   this installer, and `dist\SystemChecker.exe` remains untouched.

The development association recorded before installer testing points to:

```text
"C:\Projects\system-check-poc\dist\SystemChecker.exe" "%1"
```

To restore it after uninstall or a failed install, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\register_protocol.ps1
reg query "HKCU\Software\Classes\systemchecker\shell\open\command"
```

If the protocol currently belongs to a different handler, the development
registration script refuses to replace it without explicit acknowledgement:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\register_protocol.ps1 -Force
```

`unregister_protocol.ps1` also removes only the development registration when
its command matches the expected `dist` EXE; it preserves another handler.

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

## Production limitation

`SystemCheckerSetup.exe` in this repository targets a loopback development
backend and is not suitable for remote candidates. A real deployment needs a
remotely reachable WSS endpoint deployed in trusted configuration, code signing,
credential lifecycle controls, and a production security review.

The local download endpoint is intentionally unauthenticated for this POC and
serves one fixed local file only. A production installer distribution should use
authenticated application access or trusted static hosting/CDN with release
integrity controls; it must not expose arbitrary filesystem downloads.

## Validation scope

Automated tests cover pairing single-use/expiration, session-ID rejection,
native WebSocket pairing, protocol parsing, rejected-authentication no-retry,
and safe unknown outcomes. This POC was also built with PyInstaller, registered
under HKCU, and launched through the registered protocol against the local
backend; the resulting live Windows scan and disconnect state were observed.
Browser-specific external-application confirmation, React click-to-browser
protocol invocation, Inno Setup compilation/installer UI/uninstaller, and any
hardware policy scenario other than the local scan still require manual
verification in the target browser and installation environment.
