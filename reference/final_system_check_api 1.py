# system_check_api.py
from fastapi import FastAPI, HTTPException, Request, Response, Query
from fastapi.responses import FileResponse, PlainTextResponse
from pathlib import Path
import shutil
import uuid
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from datetime import datetime
from pymongo import MongoClient
import os
import platform
import subprocess
import json

# -------------------------------
# Configuration
# -------------------------------
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017")
EMAIL_USER = os.getenv("EMAIL_USERNAME")
EMAIL_PASS = os.getenv("EMAIL_PASSWORD")
# DIST_DIR = os.getenv("DIST_DIR", "dist")  # folder containing system_check.exe
# BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")  # used for generated URLs

# Dynamically compute the dist folder path based on this file's location
BASE_DIR = Path(__file__).parent.resolve()
DIST_DIR = BASE_DIR / "dist"

client = MongoClient(MONGO_URI)
db = client["via_db"]
system_check_collection = db["system_check_logs"]
SYSTEM_CHECK_MODE = os.getenv("SYSTEM_CHECK_MODE", "local").lower()

# -------------------------------
# FastAPI app
# -------------------------------
app = FastAPI(title="System Security Check API")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    ts = datetime.utcnow().isoformat() + "Z"
    client_host = request.client.host if request.client else "unknown"
    print(f"[{ts}] Incoming: {request.method} {request.url.path} from {client_host}")
    try:
        response = await call_next(request)
        print(f"[{ts}] Responded: {response.status_code}")
        return response
    except Exception as e:
        print(f"[{ts}] Error: {e}")
        raise

# -------------------------------
# Pydantic models
# -------------------------------
class SystemCheckPayload(BaseModel):
    session_id: str
    metadata: Dict[str, Any] = {}
    result: Dict[str, Any] = {}

class CheckStatusResponse(BaseModel):
    found: bool
    status: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    message: Optional[str] = None

# -------------------------------
# System check helper functions
# -------------------------------
def detect_remote_tools():
    tools = []
    known = ["anydesk", "teamviewer", "vnc", "rustdesk", "ultraviewer", "chrome remote desktop"]
    try:
        if platform.system() == "Windows":
            result = subprocess.run(["tasklist"], capture_output=True, text=True)
        else:
            result = subprocess.run(["ps", "aux"], capture_output=True, text=True)

        txt = result.stdout.lower().replace(" ", "")
        for t in known:
            if t.replace(" ", "") in txt:
                tools.append(t)
    except:
        pass
    return tools


def check_multiple_monitors():
    try:
        sys_name = platform.system()
        if sys_name == "Windows":
            cmd = [
                "powershell", "-Command",
                "(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams).Count"
            ]
            out = subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
            return out.isdigit() and int(out) > 1

        elif sys_name == "Darwin":
            out = subprocess.run(["system_profiler", "SPDisplaysDataType"], capture_output=True, text=True)
            return out.stdout.lower().count("display") > 1

        elif sys_name == "Linux":
            out = subprocess.run(["xrandr", "--listmonitors"], capture_output=True, text=True)
            return "Monitors: 1" not in out.stdout
    except:
        return False
    return False


def count_devices(device_type: str):
    try:
        sys_name = platform.system()
        if sys_name == "Windows":
            cmd = [
                "powershell", "-Command",
                f"Get-PnpDevice -Class {device_type} | Select-Object Status, FriendlyName"
            ]
            out = subprocess.run(cmd, capture_output=True, text=True).stdout.splitlines()
            lines = [l.strip() for l in out if l.strip()]
            if len(lines) > 2:
                names = lines[2:]
            else:
                names = lines

            if device_type.lower() == "mouse":
                return len([l for l in names if "ok" in l.lower() and "touchpad" not in l.lower()])
            if device_type.lower() == "keyboard":
                return len([l for l in names if "ok" in l.lower() and "internal" not in l.lower()])

        elif sys_name == "Linux":
            out = subprocess.run(["xinput", "list"], capture_output=True, text=True).stdout.lower().splitlines()
            if device_type.lower() == "mouse":
                return len([l for l in out if "mouse" in l and "touchpad" not in l])
            if device_type.lower() == "keyboard":
                return len([l for l in out if "keyboard" in l])

        elif sys_name == "Darwin":
            txt = subprocess.run(["system_profiler", "SPUSBDataType"], capture_output=True, text=True).stdout.lower()
            return txt.count(device_type.lower())
    except:
        return 0
    return 0


def check_virtual_machine():
    try:
        if platform.system() == "Windows":
            txt = subprocess.run(["systeminfo"], capture_output=True, text=True).stdout.lower()
            return any(k in txt for k in ["vmware", "virtualbox", "qemu", "parallels"])
        elif platform.system() == "Darwin":
            txt = subprocess.run(["sysctl", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.lower()
            return any(k in txt for k in ["vmware", "virtualbox", "parallels"])
        elif platform.system() == "Linux":
            txt = subprocess.run(["systemd-detect-virt"], capture_output=True, text=True).stdout.strip().lower()
            return txt not in ["", "none"]
    except:
        return False
    return False


def is_rdp_session():
    try:
        if platform.system() == "Windows":
            return os.environ.get("SESSIONNAME", "").startswith("RDP")
        elif platform.system() == "Darwin":
            out = subprocess.run(["ps", "aux"], capture_output=True, text=True).stdout.lower()
            return "screensharingd" in out
        elif platform.system() == "Linux":
            out = subprocess.run(["who"], capture_output=True, text=True).stdout
            return "(:0)" not in out
    except:
        return False
    return False


def run_system_check(mode=None):
    if mode is None:
        mode = SYSTEM_CHECK_MODE

    result = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "remote_access_tools": detect_remote_tools(),
        "is_rdp": is_rdp_session(),
        "multiple_monitors": check_multiple_monitors(),
        "multiple_keyboards": count_devices("Keyboard") > 1,
        "multiple_mouse": count_devices("Mouse") > 1,
        "virtual_machine": check_virtual_machine(),
        "mode": mode,
    }

    issues = []
    if result["remote_access_tools"]:
        issues.append("Remote access tools detected")
    if mode == "local":
        if result["is_rdp"]:
            issues.append("RDP session detected")
        if result["virtual_machine"]:
            issues.append("Running in VM")

    if result["multiple_monitors"]:
        issues.append("Multiple monitors connected")
    if result["multiple_keyboards"]:
        issues.append("Multiple keyboards connected")
    if result["multiple_mouse"]:
        issues.append("Multiple mouse connected")

    result["status"] = "FAIL" if issues else "PASS"
    result["issues"] = issues
    return result


# -------------------------------
# API endpoints (only one version kept)
# -------------------------------

@app.get("/download-exe")
def download_exe():
    dist_path = Path(DIST_DIR).resolve()
    exe_path = (dist_path / "system_check.exe").resolve()
    print("Checking exe path:", exe_path)  # 🔍 debug
    print("CWD:", os.getcwd())
    print("DIST_DIR exists:", DIST_DIR.exists())
    print("Files in DIST_DIR:", list(DIST_DIR.iterdir()) if DIST_DIR.exists() else "folder missing")
    if not exe_path.exists():
        raise HTTPException(404, "Executable not found")
    return FileResponse(str(exe_path), media_type="application/octet-stream",
                        filename="system_check.exe")



@app.get("/download-system-check-bat")
def download_system_check_bat(interview_id: str = Query(...)):
    safe_id = interview_id.replace("\n", "").replace("\r", "")
    bat = f"""@echo off
"%~dp0system_check.exe" --interview-id "{safe_id}" --debug
pause
"""
    return PlainTextResponse(
        content=bat,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="run_{safe_id}.bat"'}
    )


@app.get("/run")
def system_check_endpoint():
    return run_system_check()


# @app.post("/submit")
# def submit_system_check(payload: SystemCheckPayload):
#     try:
#         now = datetime.utcnow()

#         interview_id = payload.metadata.get("interview_id")
#         if not interview_id:
#             raise HTTPException(400, "interview_id is required in metadata")

#         # Build document
#         doc = {
#             "interview_id": interview_id,
#             "metadata": payload.metadata,
#             "result": payload.result,
#             "server_received_at": now,
#         }

#         # Unique key = interview_id
#         key = {"interview_id": interview_id}

#         # Check if document already exists
#         existing = system_check_collection.find_one(key)

#         # Perform upsert
#         result = system_check_collection.update_one(key, {"$set": doc}, upsert=True)

#         # -------------------------------
#         # Logging
#         # -------------------------------
#         if existing is None:
#             print(f"[SYSTEM CHECK] INSERTED new record for interview_id: {interview_id} at {now}")
#         else:
#             print(f"[SYSTEM CHECK] UPDATED existing record for interview_id: {interview_id} at {now}")

#         return {
#             "status": "success",
#             "interview_id": interview_id
#         }

#     except Exception as e:
#         print(f"[SYSTEM CHECK ERROR] interview_id={payload.metadata.get('interview_id')} -> {e}")
#         raise HTTPException(500, f"DB Error: {e}")




@app.get("/check-status/{interview_id}", response_model=CheckStatusResponse)
def check_status(interview_id: str):
    rec = system_check_collection.find_one({"metadata.interview_id": interview_id})
    if rec:
        return CheckStatusResponse(
            found=True,
            status=rec.get("result", {}).get("status"),
            result=rec.get("result"),
            metadata=rec.get("metadata"),
        )
    return CheckStatusResponse(found=False, message="Not ready")



@app.get("/check-by-interview")
def check_by_interview(interview_id: str = Query(...)):
    rec = system_check_collection.find_one({"metadata.interview_id": interview_id})
    if rec:
        return {
            "found": True,
            "interview_id": interview_id,
            "status": rec.get("result", {}).get("status"),
            "result": rec.get("result"),
            "metadata": rec.get("metadata"),
        }
    return {"found": False, "message": "No record"}



@app.post("/submit")
def system_check_submit(request: SystemCheckPayload):
    """
    New endpoint for EXE tool result submission.
    Does NOT modify or affect existing /submit endpoint.
    """
    try:
        now = datetime.utcnow()

        interview_id = request.metadata.get("interview_id")
        if not interview_id:
            raise HTTPException(400, "interview_id required")

        # 🔄 rename multiple_mice → multiple_mouse
        if "multiple_mice" in request.result:
            request.result["multiple_mouse"] = request.result.pop("multiple_mice")

        # 🔄 fix reasons text: "mice" → "mouse"
        if "reasons" in request.result and isinstance(request.result["reasons"], list):
            fixed_reasons = []
            for reason in request.result["reasons"]:
                if isinstance(reason, str):
                    # Replace "mice" with "mouse" in the text
                    fixed_reason = reason.replace("mice", "mouse").replace("Mice", "Mouse")
                    fixed_reasons.append(fixed_reason)
                else:
                    fixed_reasons.append(reason)
            request.result["reasons"] = fixed_reasons

        # Upsert key for new collection/data path
        key = {"metadata.interview_id": interview_id}

        doc = {
            "session_id": request.session_id,
            "metadata": request.metadata,
            "result": request.result,
            "server_received_at": now,
        }

        system_check_collection.update_one(key, {"$set": doc}, upsert=True)

        return {"status": "success", "message": "System check stored", "interview_id": interview_id}

    except Exception as e:
        print(f"[NEW SYSTEM CHECK ERROR] {e}")
        raise HTTPException(500, f"Error: {e}")



# -------------------------------
# Run server
# -------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    print(f"Starting system_check_api on port {port}")
    uvicorn.run("system_check_api:app", host="0.0.0.0", port=port, reload=True)
