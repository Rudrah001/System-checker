#!/usr/bin/env python3
"""
system_check_poster_api.py
- Runs a local system check and POSTS the result JSON to a central API endpoint.
- Removes direct MongoDB writes from the EXE; the API is responsible for DB persistence.
- Keeps retry, debug, local error log behavior.
"""
import subprocess
import json
import platform
import requests
from datetime import datetime
import sys
from dotenv import load_dotenv
import traceback
import os
import argparse
import socket
import uuid
import time
import hashlib

# -------------------------------
# Helper: base directory & log path (works for frozen exe)
# -------------------------------

load_dotenv()

def exe_base_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = exe_base_dir()
LOCAL_ERROR_LOG = os.path.join(BASE_DIR, "system_check_error.log")

# -------------------------------
# Configuration
# -------------------------------
# Default endpoint (can be overridden via --server)
SYSTEM_CHECK_URL = "https://talenttalks.vlinkinfo.com/api/system_check/submit"

# ================= CONFIG DEFAULTS =================
DEFAULT_TIMEOUT = 6  # seconds for network requests
MAX_RETRIES = 3
RETRY_BACKOFF = 2  # seconds multiplier
# ===================================================


def _run_cmd(cmd, fallback=""):
    try:
        out = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL)
        return out.decode(errors="ignore").strip()
    except Exception:
        return fallback


def is_rdp_session():
    try:
        out = _run_cmd('query session')
        if out and ("rdp" in out.lower() or "remote" in out.lower()):
            return True
        ps = 'powershell "(Get-WmiObject Win32_LogonSession | Where-Object { $_.LogonType -eq 10 }).Count"'
        out2 = _run_cmd(ps, fallback="0")
        if out2.isdigit() and int(out2) > 0:
            return True
    except Exception:
        pass
    return False


def check_virtual_machine():
    try:
        ps = 'powershell "Get-WmiObject Win32_ComputerSystem | Select-Object -Property Manufacturer, Model | ConvertTo-Json"'
        out = _run_cmd(ps, fallback="")
        if not out:
            return False
        data = json.loads(out)
        if isinstance(data, list):
            data = data[0] if data else {}
        manuf = str(data.get("Manufacturer", "")).lower()
        model = str(data.get("Model", "")).lower()
        vm_signs = ["virtual", "vmware", "qemu", "virtualbox", "hyper-v", "kvm", "microsoft corporation", "xen"]
        combined = manuf + " " + model
        return any(sign in combined for sign in vm_signs)
    except Exception:
        return False


def get_monitor_count():
    try:
        ps = 'powershell "Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams | Measure-Object | Select -ExpandProperty Count"'
        out = _run_cmd(ps, fallback="0")
        if out.isdigit():
            return int(out)
    except Exception:
        pass
    return 0


def get_input_devices():
    result = {
        "keyboard_count": 0,
        "keyboard_names": [],
        "mouse_count": 0,
        "mouse_names": []
    }
    try:
        ps_kb = 'powershell "Get-WmiObject Win32_Keyboard | Select-Object -ExpandProperty Name | Where-Object { $_ -ne $null }"'
        kb_out = _run_cmd(ps_kb, fallback="")
        kb_lines = [l.strip() for l in kb_out.splitlines() if l.strip()]
        kb_norm = [k.lower() for k in kb_lines]
        kb_set = list(dict.fromkeys(kb_norm))
        result["keyboard_count"] = len(kb_set)
        result["keyboard_names"] = kb_set

        ps_mouse = (
            'powershell "Get-WmiObject Win32_PointingDevice | '
            "Where-Object { $_.Name -and ($_.Name -notlike '*touchpad*') -and ($_.Name -notlike '*trackpad*') "
            "-and ($_.PNPDeviceID -match 'USB|VID|HID|BTH') -and ($_.PNPDeviceID -notmatch 'ACPI|ELAN|SYNAPTICS|I2C') } | "
            'Select-Object Name,PNPDeviceID | ConvertTo-Json -Compress"'
        )
        mouse_out = _run_cmd(ps_mouse, fallback="")

        mouse_by_pnp = []
        mouse_names = []
        if mouse_out:
            try:
                mdata = json.loads(mouse_out)
                if isinstance(mdata, dict):
                    mdata = [mdata]
                for item in mdata:
                    name = str(item.get('Name', '')).strip()
                    pnp = str(item.get('PNPDeviceID', '')).strip()
                    if pnp and pnp not in mouse_by_pnp:
                        mouse_by_pnp.append(pnp)
                        mouse_names.append(name.lower())
            except Exception:
                mouse_lines = [l.strip() for l in mouse_out.splitlines() if l.strip()]
                for line in mouse_lines:
                    if '||' in line:
                        parts = line.split('||')
                        if len(parts) >= 2:
                            name = parts[0].strip()
                            pnp = parts[1].strip()
                            if pnp and pnp not in mouse_by_pnp:
                                mouse_by_pnp.append(pnp)
                                mouse_names.append(name.lower())

        result["mouse_count"] = len(mouse_by_pnp)
        result["mouse_names"] = list(dict.fromkeys(mouse_names))

    except Exception as e:
        print("⚠️ Error detecting input devices:", e, file=sys.stderr)
        traceback.print_exc()

    return result


def detect_remote_tools():
    known_tools = {
        "teamviewer": "TeamViewer",
        "anydesk": "AnyDesk",
        "tightvnc": "TightVNC",
        "ultravnc": "UltraVNC",
        "vncserver": "VNC",
        "mstsc": "mstsc"
    }
    found = []
    try:
        ps = 'powershell "Get-Process | Select-Object -ExpandProperty ProcessName"'
        out = _run_cmd(ps, fallback="").lower()
        if out:
            procs = set([p.strip() for p in out.splitlines() if p.strip()])
            for key, display in known_tools.items():
                if key.lower() in " ".join(procs):
                    found.append(display)
    except Exception:
        pass
    return found


def run_system_check():
    result = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "os": f"{platform.system()} {platform.release()}",
        "remote_access_tools": [],
        "is_rdp": False,
        "virtual_machine": False,
        "monitor_count": 0,
        "multiple_monitors": False,
        "keyboard_count": 0,
        "keyboard_names": [],
        "multiple_keyboards": False,
        "mouse_count": 0,
        "mouse_names": [],
        "multiple_mice": False,
        "status": "UNKNOWN"
    }

    try:
        result["is_rdp"] = is_rdp_session()
    except Exception:
        result["is_rdp"] = False

    try:
        result["virtual_machine"] = check_virtual_machine()
    except Exception:
        result["virtual_machine"] = False

    try:
        tools = detect_remote_tools()
        result["remote_access_tools"] = tools
    except Exception:
        result["remote_access_tools"] = []

    try:
        monitor_count = get_monitor_count()
        result["monitor_count"] = monitor_count
        result["multiple_monitors"] = monitor_count > 1
    except Exception:
        result["monitor_count"] = 0
        result["multiple_monitors"] = False

    try:
        devs = get_input_devices()
        result["keyboard_count"] = devs.get("keyboard_count", 0)
        result["keyboard_names"] = devs.get("keyboard_names", [])
        result["multiple_keyboards"] = result["keyboard_count"] > 1

        result["mouse_count"] = devs.get("mouse_count", 0)
        result["mouse_names"] = devs.get("mouse_names", [])
        result["multiple_mice"] = result["mouse_count"] > 1
    except Exception:
        pass

    fail_condition = (
        result["is_rdp"]
        or result["virtual_machine"]
        or bool(result["remote_access_tools"])
        or result["multiple_monitors"]
        or result["multiple_keyboards"]
        or result["multiple_mice"]
    )

    result["status"] = "FAIL" if fail_condition else "PASS"

    reasons = []
    if result["is_rdp"]:
        reasons.append("RDP session detected")
    if result["virtual_machine"]:
        reasons.append("Running inside virtual machine")
    if result["remote_access_tools"]:
        reasons.append(f"Remote tools running: {result['remote_access_tools']}")
    if result["multiple_monitors"]:
        reasons.append(f"Multiple monitors ({result['monitor_count']})")
    if result["multiple_keyboards"]:
        reasons.append(f"Multiple keyboards ({result['keyboard_count']})")
    if result["multiple_mice"]:
        reasons.append(f"Multiple mice ({result['mouse_count']})")

    result["reasons"] = reasons

    minimal = {
        "timestamp": result["timestamp"],
        "remote_access_tools": result["remote_access_tools"],
        "is_rdp": result["is_rdp"],
        "multiple_monitors": result["multiple_monitors"],
        "multiple_keyboards": result["multiple_keyboards"],
        "multiple_mice": result["multiple_mice"],
        "virtual_machine": result["virtual_machine"],
        "status": result["status"],
        "reasons": reasons
    }

    return minimal


def _log_error(msg):
    try:
        with open(LOCAL_ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(f"{datetime.utcnow().isoformat()}Z\t{msg}\n")
    except Exception:
        pass


def _send_with_retries(url, json_payload, headers, verify_tls, timeout=DEFAULT_TIMEOUT):
    backoff = 1
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(
                url,
                json=json_payload,
                headers=headers,
                timeout=timeout,
                verify=verify_tls
            )
            return {"ok": True, "status_code": resp.status_code, "text": resp.text}

        except requests.RequestException as e:
            _log_error(
                f"POST attempt {attempt} failed: {e}\n{traceback.format_exc()}"
            )
            time.sleep(backoff)
            backoff *= RETRY_BACKOFF

    return {"ok": False, "error": "all attempts failed"}


def send_to_server(server_url, payload, auth_token=None, verify_tls=True):
    """
    Sends the payload to server_url with retries.
    """
    if not server_url:
        return {"skipped": True, "reason": "SERVER_URL not provided"}

    headers = {"Content-Type": "application/json"}
    if auth_token:
        if auth_token.lower().startswith("bearer "):
            headers["Authorization"] = auth_token
        else:
            headers["Authorization"] = f"Bearer {auth_token}"

    try:
        result = _send_with_retries(server_url, payload, headers, verify_tls)
        return result
    except Exception as e:
        _log_error(f"send_to_server top-level error: {e}\n{traceback.format_exc()}")
        return {"ok": False, "error": str(e)}


def make_run_metadata(agent_id=None):
    """
    Returns metadata including:
     - machine_fingerprint: deterministic short hex for the machine (used for session_id)
     - run_id: unique UUID per run (kept if you still want unique run identifier)
    """
    try:
        host = socket.gethostname()
        # use hostname + mac to create a deterministic fingerprint
        machine_fingerprint = hashlib.sha256(host.encode() + str(uuid.getnode()).encode()).hexdigest()[:32]
    except Exception:
        host = "unknown"
        machine_fingerprint = uuid.uuid4().hex[:32]
    run_id = str(uuid.uuid4())
    return {
        "agent_id": agent_id or f"agent-{machine_fingerprint}",
        "host": host,
        "machine_fingerprint": machine_fingerprint,
        "run_id": run_id,
        "ran_at": datetime.utcnow().isoformat() + "Z"
    }


def make_session_id_from_meta(meta):
    """
    Deterministic session id for a machine.
    Option A: machine-level persistent session id (default)
    """
    return meta.get("machine_fingerprint")


def main(argv=None):
    parser = argparse.ArgumentParser(description="System check poster (POSTs to API)")
    parser.add_argument("--interview-id", required=True, type=str, help="Interview session ID")
    parser.add_argument("--server", help="Override the default server URL")
    parser.add_argument("--agent")
    parser.add_argument("--token")
    parser.add_argument("--no-verify", action="store_true")
    parser.add_argument("--debug", action="store_true")

    args = parser.parse_args(argv) if argv else parser.parse_args()

    print("Interview ID =", args.interview_id)

    SERVER_URL = args.server or SYSTEM_CHECK_URL
    AGENT_ID = args.agent or None
    AUTH_TOKEN = args.token or None
    VERIFY_TLS = not args.no_verify
    debug = args.debug

    if debug:
        print("DEBUG: server_url:", SERVER_URL)

    # ----------------- Run system check -----------------
    print("🔍 Running system check...")
    try:
        result = run_system_check()
    except Exception as e:
        result = {"error": f"system check failed: {e}"}
        _log_error(f"run_system_check exception: {traceback.format_exc()}")

    # ----------------- Prepare metadata -----------------
    meta = make_run_metadata(AGENT_ID)
    meta["interview_id"] = args.interview_id
    session_id = make_session_id_from_meta(meta)

    final_payload = {
        "session_id": session_id,
        "metadata": meta,
        "result": result
    }

    # ----------------- Send to central API -----------------
    print(f"📡 Sending result to {SERVER_URL} ...")
    api_res = send_to_server(SERVER_URL, final_payload, auth_token=AUTH_TOKEN, verify_tls=VERIFY_TLS)

    if api_res.get("skipped"):
        print("ℹ️ Server send skipped:", api_res.get("reason"))
    elif api_res.get("ok"):
        print("✅ API response:", api_res.get("status_code"))
    else:
        print("❌ Failed to send to API:", api_res)
        _log_error(f"Failed to send to API: {api_res}")

    # ----------------- Print summary -----------------
    print(json.dumps({
        "interview_id": args.interview_id,
        "status": result.get("status"),
        "timestamp": result.get("timestamp")
    }, indent=2))


if __name__ == "__main__":
    main()
