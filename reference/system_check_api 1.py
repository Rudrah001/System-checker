from fastapi import FastAPI, HTTPException
import subprocess
import platform
import json
import os
from datetime import datetime

app = FastAPI(title="System Security Check API")

# ----------------------------------------------
# Helper functions
# ----------------------------------------------


def detect_remote_tools():
    """Detects if any remote-access software is running."""
    tools = []
    known_tools = [
        "anydesk",
        "teamviewer",
        "vnc",
        "rustdesk",
        "ultraviewer",
        "chrome remote desktop",
    ]
    try:
        if platform.system() == "Windows":
            result = subprocess.run(["tasklist"], capture_output=True, text=True)
        else:
            result = subprocess.run(["ps", "aux"], capture_output=True, text=True)

        for tool in known_tools:
            if tool.lower().replace(" ", "") in result.stdout.lower().replace(" ", ""):
                tools.append(tool)
    except Exception as e:
        print("Error checking remote tools:", e)
    return tools


def check_multiple_monitors():
    try:
        sys = platform.system()
        if sys == "Windows":
            result = subprocess.run(
                [
                    "powershell",
                    "-Command",
                    "(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams).Count",
                ],
                capture_output=True,
                text=True,
            )
            count = int(result.stdout.strip()) if result.stdout.strip().isdigit() else 1
            return count > 1

        elif sys == "Darwin":  # macOS
            result = subprocess.run(
                ["system_profiler", "SPDisplaysDataType"],
                capture_output=True,
                text=True,
            )
            return result.stdout.lower().count("display") > 1

        elif sys == "Linux":
            result = subprocess.run(
                ["xrandr", "--listmonitors"], capture_output=True, text=True
            )
            return "Monitors: 1" not in result.stdout

    except Exception:
        return False
    return False


def count_devices(device_type):
    """Count active external devices (mouse, keyboard, etc.) ignoring internal/ghost entries."""
    try:
        sys = platform.system()
        if sys == "Windows":
            cmd = [
                "powershell",
                "-Command",
                f"Get-PnpDevice -Class {device_type} | Select-Object Status, FriendlyName",
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            lines = [
                line.strip() for line in result.stdout.splitlines() if line.strip()
            ]
            names = lines[2:]  # skip headers

            if device_type.lower() == "mouse":
                ok_devices = [
                    line
                    for line in names
                    if "ok" in line.lower()
                    and not any(k in line.lower() for k in ["elan", "touchpad"])
                ]
                return len(ok_devices)

            elif device_type.lower() == "keyboard":
                ok_devices = [
                    line
                    for line in names
                    if "ok" in line.lower()
                    and not any(k in line.lower() for k in ["hid", "internal", "ps/2"])
                ]
                return len(ok_devices)

        elif sys == "Linux":
            result = subprocess.run(["xinput", "list"], capture_output=True, text=True)
            lines = result.stdout.lower().splitlines()
            if device_type.lower() == "mouse":
                return len([l for l in lines if "mouse" in l and "touchpad" not in l])
            if device_type.lower() == "keyboard":
                return len([l for l in lines if "keyboard" in l])

        elif sys == "Darwin":
            result = subprocess.run(
                ["system_profiler", "SPUSBDataType"], capture_output=True, text=True
            )
            text = result.stdout.lower()
            if device_type.lower() == "mouse":
                return text.count("mouse")
            if device_type.lower() == "keyboard":
                return text.count("keyboard")

    except Exception as e:
        print("Device count error:", e)
        return 1


def check_virtual_machine():
    """Detect if system is running inside a virtual machine."""
    try:
        sys = platform.system()

        if sys == "Windows":
            result = subprocess.run(["systeminfo"], capture_output=True, text=True)
            text = result.stdout.lower()

            vm_keywords = ["vmware", "virtualbox", "qemu", "parallels"]
            if any(k in text for k in vm_keywords):
                return True

            if (
                "hyper-v requirements" in text
                and "a hypervisor has been detected" in text
            ):
                return False

            return False

        elif sys == "Darwin":
            result = subprocess.run(
                ["sysctl", "machdep.cpu.brand_string"], capture_output=True, text=True
            )
            text = result.stdout.lower()
            vm_keywords = ["virtualbox", "vmware", "parallels"]
            return any(k in text for k in vm_keywords)

        elif sys == "Linux":
            result = subprocess.run(
                ["systemd-detect-virt"], capture_output=True, text=True
            )
            text = result.stdout.lower().strip()
            return text not in ["", "none"]

    except Exception as e:
        print("VM detection error:", e)
        return False


def is_rdp_session():
    if platform.system() == "Windows":
        return os.environ.get("SESSIONNAME", "").startswith("RDP")
    elif platform.system() == "Darwin":
        result = subprocess.run(["ps", "aux"], capture_output=True, text=True)
        return "screensharingd" in result.stdout.lower()
    elif platform.system() == "Linux":
        result = subprocess.run(["who"], capture_output=True, text=True)
        return "(:0)" not in result.stdout
    return False


# ----------------------------------------------
# Main Endpoint
# ----------------------------------------------


@app.get("/system-check")
def system_check():
    try:
        mode = os.getenv("SYSTEM_CHECK_MODE", "local").lower()  # "local" or "server"

        result = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "remote_access_tools": detect_remote_tools(),
            "is_rdp": is_rdp_session(),
            "multiple_monitors": check_multiple_monitors(),
            "multiple_keyboards": count_devices("Keyboard") > 1,
            "multiple_mice": count_devices("Mouse") > 1,
            "virtual_machine": check_virtual_machine(),
            "mode": mode,
        }

        # Determine final status
        issues = []

        if result["remote_access_tools"]:
            issues.append("Remote access tools detected")

        if mode == "local":  # Strict mode
            if result["is_rdp"]:
                issues.append("RDP session detected")
            if result["virtual_machine"]:
                issues.append("Running inside a VM")
        else:
            # Server mode: log but don't fail
            if result["is_rdp"]:
                print("Warning: RDP session detected (ignored in server mode)")
            if result["virtual_machine"]:
                print("Warning: Virtual machine detected (ignored in server mode)")

        if result["multiple_monitors"]:
            issues.append("Multiple monitors connected")
        if result["multiple_keyboards"]:
            issues.append("Multiple keyboards connected")
        if result["multiple_mice"]:
            issues.append("Multiple mice connected")

        result["status"] = "FAIL" if issues else "PASS"
        result["issues"] = issues

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"System check failed: {e}")
