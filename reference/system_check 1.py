#!/usr/bin/env python3
"""
Complete Windows system security check script.
- Detects RDP sessions, VM, multiple monitors, multiple keyboards/mice (deduplicated by name),
  and common remote-access tools (process names).
- Produces JSON report, saves locally, and posts to SERVER_URL (if configured).
"""

import subprocess
import json
import platform
import requests
from datetime import datetime
import sys
import traceback

# ================= CONFIG =================
SERVER_URL = "https://your-server.com/api/system-check"  # Replace with your API endpoint or keep empty to skip send
REQUEST_TIMEOUT = 5  # seconds for POST
# ==========================================

# ---------------- Helper: run shell and decode ----------------
def _run_cmd(cmd, fallback=""):
    try:
        out = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL)
        return out.decode(errors="ignore").strip()
    except Exception:
        return fallback

# ---------------- RDP detection ----------------
def is_rdp_session():
    """
    Detect RDP by attempting multiple reliable Windows queries:
    - query session (text contains 'rdp-tcp' or 'remote')
    - Win32_LogonSession of type 10 (remote interactive) via PowerShell
    """
    try:
        # Try query session
        out = _run_cmd('query session')
        if out:
            if "rdp" in out.lower() or "remote" in out.lower():
                return True

        # Fallback: count logon sessions with LogonType 10 (RemoteInteractive)
        ps = 'powershell "(Get-WmiObject Win32_LogonSession | Where-Object { $_.LogonType -eq 10 }).Count"'
        out2 = _run_cmd(ps, fallback="0")
        if out2.isdigit() and int(out2) > 0:
            return True
    except Exception:
        pass
    return False

# ---------------- Virtual Machine detection ----------------
def check_virtual_machine():
    """
    Uses WMI to read Model and Manufacturer and checks for typical VM strings.
    """
    try:
        ps = 'powershell "Get-WmiObject Win32_ComputerSystem | Select-Object -Property Manufacturer, Model | ConvertTo-Json"'
        out = _run_cmd(ps, fallback="")
        if not out:
            return False
        data = json.loads(out)
        # data can be dict or list depending on results
        if isinstance(data, list):
            data = data[0] if data else {}
        manuf = str(data.get("Manufacturer", "")).lower()
        model = str(data.get("Model", "")).lower()
        vm_signs = ["virtual", "vmware", "qemu", "virtualbox", "hyper-v", "kvm", "microsoft corporation", "xen"]
        combined = manuf + " " + model
        return any(sign in combined for sign in vm_signs)
    except Exception:
        return False

# ---------------- Monitor detection ----------------
def get_monitor_count():
    """
    Returns number of monitors detected via WMI class.
    """
    try:
        ps = 'powershell "Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams | Measure-Object | Select -ExpandProperty Count"'
        out = _run_cmd(ps, fallback="0")
        if out.isdigit():
            return int(out)
    except Exception:
        pass
    return 0

# ---------------- Input device detection (names + dedup) ----------------
def get_input_devices():
    """
    Returns dict with:
      - keyboard_count, keyboard_names (list)
      - mouse_count, mouse_names (list)
    Deduplicates by normalized name and filters out touchpads/trackpads for mice.
    """
    result = {
        "keyboard_count": 0,
        "keyboard_names": [],
        "mouse_count": 0,
        "mouse_names": []
    }

    try:
        # Keyboards: get Names
        ps_kb = 'powershell "Get-WmiObject Win32_Keyboard | Select-Object -ExpandProperty Name | Where-Object { $_ -ne $null }"'
        kb_out = _run_cmd(ps_kb, fallback="")
        kb_lines = [l.strip() for l in kb_out.splitlines() if l.strip()]
        kb_norm = []
        for k in kb_lines:
            lower = k.lower()
            # normalize some generic naming (optional): remove serials inside parentheses, trim
            # but keep the main name for debugging
            kb_norm.append(lower)
        kb_set = list(dict.fromkeys(kb_norm))  # preserve order, deduplicate
        result["keyboard_count"] = len(kb_set)
        result["keyboard_names"] = kb_set

        # Mice: get Name + PNPDeviceID, filter out common internal touchpad IDs
        # and include likely external identifiers (USB/VID/HID/BTH). We dedupe
        # by PNPDeviceID (unique hardware instance) to avoid collapsing
        # multiple external devices that share the same generic Name
        # (e.g. "HID-compliant mouse").
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
                # fallback: parse lines if JSON failed
                mouse_lines = [l.strip() for l in mouse_out.splitlines() if l.strip()]
                for line in mouse_lines:
                    # try to split 'Name' and 'PNPDeviceID' if present
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
        # debug print
        print("⚠️ Error detecting input devices:", e, file=sys.stderr)
        traceback.print_exc()

    return result

# ---------------- Remote access tools detection ----------------
def detect_remote_tools():
    """
    Look for common remote/control tool process names.
    Returns list of found tool names (from the known list).
    """
    # Note: intentionally excluding 'chrome' / Chrome Remote Desktop to avoid false-positives
    known_tools = {
        "teamviewer": "TeamViewer",
        "anydesk": "AnyDesk",
        "tightvnc": "TightVNC",
        "ultravnc": "UltraVNC",
        "vncserver": "VNC",
        "mstsc": "mstsc"  # mstsc is RDP client — we track RDP separately but mention if found
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

# ---------------- Build and run full check ----------------
def run_system_check():
    """
    Aggregate all checks and return a dictionary (not JSON string).
    Uses strict rules: FAIL if any of the following are true:
      - is_rdp
      - virtual_machine
      - any remote access tool found
      - multiple monitors (>1)
      - multiple keyboards (>1)
      - multiple mice (>1)
    """
    result = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "os": f"{platform.system()} {platform.release()}",
        "browser": "Unknown (detected client-side)",
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

    # run checks
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

    # Strict fail condition (includes monitors and input devices)
    fail_condition = (
        result["is_rdp"]
        or result["virtual_machine"]
        or bool(result["remote_access_tools"])
        or result["multiple_monitors"]
        or result["multiple_keyboards"]
        or result["multiple_mice"]
    )

    result["status"] = "FAIL" if fail_condition else "PASS"

    # Also include a reasons list for clarity
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

    # Return only the minimal set the caller requested (keep internal full result for debug if needed)
    minimal = {
        "timestamp": result["timestamp"],
        "remote_access_tools": result["remote_access_tools"],
        "is_rdp": result["is_rdp"],
        "multiple_monitors": result["multiple_monitors"],
        "multiple_keyboards": result["multiple_keyboards"],
        "multiple_mice": result["multiple_mice"],
        "virtual_machine": result["virtual_machine"],
        "status": result["status"],
    }

    return minimal

# ---------------- Send results to server ----------------
def send_to_server(result_dict):
    if not SERVER_URL:
        print("SERVER_URL not configured. Skipping send.")
        return None
    try:
        resp = requests.post(SERVER_URL, json=result_dict, timeout=REQUEST_TIMEOUT)
        return {"status_code": resp.status_code, "text": resp.text}
    except Exception as e:
        return {"error": str(e)}

# ---------------- Main ----------------
def main():
    print("🔍 Running system check...")
    result = run_system_check()

    # Save locally
    out_file = "system_check_result.json"
    try:
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(f"📝 Result saved to {out_file}")
    except Exception as e:
        print("⚠️ Failed to write result file:", e)

    # Pretty print
    print(json.dumps(result, indent=2))

    # Send to server (if configured)
    send_resp = send_to_server(result)
    if send_resp is None:
        print("ℹ️ Server send skipped (no SERVER_URL).")
    else:
        print("📡 Server response:", send_resp)

if __name__ == "__main__":
    main()
