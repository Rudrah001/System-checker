; Per-user installer for the local System Check POC.  Do not use this build
; for remote candidates: its bundled config points at the local loopback API.
#define AppName "System Checker POC"
#define AppVersion "1.0"
#define AppExeName "SystemChecker.exe"

[Setup]
AppId={{66B356B4-3F87-4EB8-BE3C-86B5C4B8BF3B}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\SystemCheckerPOC
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\installer-output
OutputBaseFilename=SystemCheckerSetup
UninstallDisplayName={#AppName}
Compression=lzma2
SolidCompression=yes

[Files]
Source: "..\dist\SystemChecker.exe"; DestDir: "{app}"; Flags: ignoreversion
; Keep a deliberate deployment-time config on upgrade, but install the local
; POC endpoint on first install.
Source: "config.local.json"; DestDir: "{app}"; DestName: "config.local.json"; Flags: onlyifdoesntexist

[Registry]
; No uninstall-delete flags here. [Code] removes the protocol key only when
; its command still points to this installation, protecting a later handler.
Root: HKCU; Subkey: "Software\Classes\systemchecker"; ValueType: string; ValueName: ""; ValueData: "URL:System Checker Protocol"
Root: HKCU; Subkey: "Software\Classes\systemchecker"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\systemchecker\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

[Code]
const
  ProtocolCommandKey = 'Software\Classes\systemchecker\shell\open\command';

function ExpectedProtocolCommand: String;
begin
  Result := '"' + ExpandConstant('{app}\{#AppExeName}') + '" "%1"';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExistingCommand: String;
begin
  Result := '';
  if RegQueryStringValue(HKCU, ProtocolCommandKey, '', ExistingCommand) and
     (CompareText(ExistingCommand, ExpectedProtocolCommand) <> 0) then begin
    if MsgBox(
      'The systemchecker:// protocol is currently registered to:' + #13#10 +
      ExistingCommand + #13#10 + #13#10 +
      'Installing will replace that current-user association with this installer. Continue?',
      mbConfirmation, MB_YESNO) <> IDYES then begin
      Result := 'Installation cancelled: existing systemchecker:// handler was preserved.';
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  CurrentCommand: String;
begin
  if CurUninstallStep = usPostUninstall then begin
    if RegQueryStringValue(HKCU, ProtocolCommandKey, '', CurrentCommand) and
       (CompareText(CurrentCommand, ExpectedProtocolCommand) = 0) then begin
      RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\systemchecker');
    end;
  end;
end;
