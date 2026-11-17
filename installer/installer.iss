[Setup]
AppName=System Checker POC
AppVersion=1.0
DefaultDirName={localappdata}\SystemCheckerPOC
PrivilegesRequired=lowest
UninstallDisplayName=System Checker POC
[Files]
Source: "..\dist\SystemChecker.exe"; DestDir: "{app}"; Flags: ignoreversion
[Registry]
Root: HKCU; Subkey: "Software\Classes\systemchecker"; ValueType: string; ValueName: ""; ValueData: "URL:System Checker Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\systemchecker"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\systemchecker\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\SystemChecker.exe"" ""%1"""
