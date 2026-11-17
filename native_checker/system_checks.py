from __future__ import annotations
from datetime import datetime, timezone
import json, platform, subprocess

def _ps(script: str) -> object:
    completed = subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command', script], capture_output=True, text=True, timeout=8, check=True)
    output = completed.stdout.strip()
    return json.loads(output) if output else None
def _one(value): return value if isinstance(value, dict) else (value[0] if isinstance(value, list) and value else {})
def collect() -> dict:
    errors: dict[str,str] = {}; data: dict = {'timestamp':datetime.now(timezone.utc).isoformat(), 'os':f'{platform.system()} {platform.release()}', 'remote_access_tools':[], 'failure_reasons':[]}
    try: data['monitor_count'] = int(_ps("@(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams).Count | ConvertTo-Json -Compress"))
    except Exception as e: data['monitor_count']=None; errors['monitors']=str(e)
    try:
        keyboards = _ps("@(Get-CimInstance Win32_Keyboard | Where-Object {$_.PNPDeviceID} | Select-Object -Expand PNPDeviceID | Sort-Object -Unique) | ConvertTo-Json -Compress"); data['keyboard_count']=len(keyboards if isinstance(keyboards,list) else ([keyboards] if keyboards else []))
    except Exception as e: data['keyboard_count']=None; errors['keyboards']=str(e)
    try:
        mice = _ps("@(Get-CimInstance Win32_PointingDevice | Where-Object {$_.PNPDeviceID -and $_.PNPDeviceID -match 'USB|HID|BTH'} | Select-Object -Expand PNPDeviceID | Sort-Object -Unique) | ConvertTo-Json -Compress"); data['mouse_count']=len(mice if isinstance(mice,list) else ([mice] if mice else []))
    except Exception as e: data['mouse_count']=None; errors['mice']=str(e)
    try: data['is_rdp'] = bool(_ps("@(Get-CimInstance Win32_LogonSession | Where-Object {$_.LogonType -eq 10}).Count | ConvertTo-Json -Compress"))
    except Exception as e: data['is_rdp']=None; errors['rdp']=str(e)
    try:
        computer=_one(_ps("Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress")); combined=(str(computer.get('Manufacturer',''))+' '+str(computer.get('Model',''))).lower(); data['virtual_machine']=any(x in combined for x in ('vmware','virtualbox','qemu','xen','kvm','hyper-v'))
    except Exception as e: data['virtual_machine']=None; errors['virtual_machine']=str(e)
    try:
        processes=_ps("@(Get-Process | Select-Object -Expand ProcessName) | ConvertTo-Json -Compress") or []; processes=' '.join(processes if isinstance(processes,list) else [processes]).lower(); known={'anydesk':'AnyDesk','teamviewer':'TeamViewer','tightvnc':'TightVNC','ultravnc':'UltraVNC','vncserver':'VNC'}; data['remote_access_tools']=[name for key,name in known.items() if key in processes]
    except Exception as e: errors['remote_access']=str(e)
    violations=[]
    for key,label in [('monitor_count','Multiple monitors'),('keyboard_count','Multiple keyboard device instances'),('mouse_count','Multiple mouse device instances')]:
        if isinstance(data[key],int) and data[key]>1: violations.append(f'{label} ({data[key]})')
    if data['is_rdp'] is True: violations.append('RDP session detected')
    if data['virtual_machine'] is True: violations.append('Virtual-machine heuristic matched')
    if data['remote_access_tools']: violations.append('Remote-access tools: '+', '.join(data['remote_access_tools']))
    data['check_errors']=errors; data['failure_reasons']=violations
    data['status']='UNKNOWN' if errors else ('FAIL' if violations else 'PASS')
    return data
