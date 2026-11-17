#!/usr/bin/env python3
"""
Simplified system_check_poster.py
- EXE collects system info
- Sends JSON payload to backend API
- Does NOT write directly to MongoDB
- Triggered by .bat with interview_id
"""
import subprocess
import json
import platform
import requests
from datetime import datetime
import sys
import argparse
import socket
import uuid
import hashlib
import time
import traceback

# ================= CONFIG =================
DEFAULT_TIMEOUT = 6  # seconds for network requests
MAX_RETRIES = 3
RETRY_BACKOFF = 2  # seconds multiplier

# ---------------- Helpers ----------------
def _run_cmd(cmd, fallback=""):
    try:
        out = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL)
        return out.decode(errors="ignore").strip()
    except Exception:
        return fallback

def is_rdp_session():
    try:
        out = _run_cmd('query session')
        return bool(out and ("rdp" in out.lower() or "remote" in out.lower()))
    except Exception:
        return False

def check_virtual_machine():
    try:
        ps = 'powershell "Get-WmiObject Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json"'
        out = _run_cmd(ps, fallback="")
        if not out:
            return False
        data = json.loads(out)
        if isinstance(data, list):
            data = data[0] if data else {}
        combined = (data.get("Manufacturer","") + " " + data.get("Model","")).lower()
        vm_signs = ["virtual", "vmware", "qemu", "virtualbox", "hyper-v", "kvm", "xen"]
        return any(sign in combined for sign in vm_signs)
    except Exception:
        return False

def run_system_check():
    result = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "os": f"{platform.system()} {platform.release()}",
        "is_rdp": is_rdp_session(),
        "virtual_machine": check_virtual_machine(),
        "status": "UNKNOWN"
    }
    fail_condition = result["is_rdp"] or result["virtual_machine"]
    result["status"] = "FAIL" if fail_condition else "PASS"
    reasons = []
    if result["is_rdp"]:
        reasons.append("RDP session detected")
    if result["virtual_machine"]:
        reasons.append("Running inside virtual machine")
    result["reasons"] = reasons
    return result

def make_run_metadata(agent_id=None, interview_id=None):
    host = socket.gethostname()
    machine_fingerprint = hashlib.sha256(host.encode() + str(uuid.getnode()).encode()).hexdigest()[:32]
    run_id = str(uuid.uuid4())
    return {
        "agent_id": agent_id or f"agent-{machine_fingerprint}",
        "host": host,
        "machine_fingerprint": machine_fingerprint,
        "run_id": run_id,
        "interview_id": interview_id,
        "ran_at": datetime.utcnow().isoformat() + "Z"
    }

def _send_with_retries(url, json_payload, headers, timeout=DEFAULT_TIMEOUT):
    backoff = 1
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(url, json=json_payload, headers=headers, timeout=timeout)
            return {"ok": True, "status_code": resp.status_code, "text": resp.text}
        except requests.RequestException as e:
            print(f"POST attempt {attempt} failed: {e}", file=sys.stderr)
            time.sleep(backoff)
            backoff *= RETRY_BACKOFF
    return {"ok": False, "error": "all attempts failed"}

def send_to_server(server_url, payload, auth_token=None):
    if not server_url:
        return {"skipped": True, "reason": "SERVER_URL not provided"}
    headers = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}" if not auth_token.lower().startswith("bearer") else auth_token
    return _send_with_retries(server_url, payload, headers)

# ================= Main =================
def main(argv=None):
    parser = argparse.ArgumentParser(description="System check poster (send JSON to backend API)")
    parser.add_argument("--interview-id", required=True, type=str, help="Interview session ID")
    parser.add_argument("--server", required=True, type=str, help="Backend API URL")
    parser.add_argument("--agent", type=str, help="Agent ID")
    parser.add_argument("--token", type=str, help="Bearer token for API")
    args = parser.parse_args(argv) if argv else parser.parse_args()

    print("🔹 Interview ID:", args.interview_id)
    print("🔹 Running system check...")

    result = run_system_check()
    meta = make_run_metadata(agent_id=args.agent, interview_id=args.interview_id)
    payload = {"metadata": meta, "result": result}

    print(f"📡 Sending payload to {args.server} ...")
    response = send_to_server(args.server, payload, auth_token=args.token)

    if response.get("ok"):
        print("✅ Server response:", response.get("status_code"))
    else:
        print("❌ Failed to send:", response)

    print(json.dumps({
        "interview_id": args.interview_id,
        "status": result.get("status"),
        "timestamp": result.get("timestamp")
    }, indent=2))

if __name__ == "__main__":
    main()
