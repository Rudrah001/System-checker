param([string]$ExecutablePath = "$PSScriptRoot\..\dist\SystemChecker.exe")
$ErrorActionPreference = 'Stop'
$ExecutablePath = [System.IO.Path]::GetFullPath($ExecutablePath)
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { throw "SystemChecker executable not found: $ExecutablePath" }
$key='HKCU:\Software\Classes\systemchecker'; New-Item $key -Force | Out-Null
New-ItemProperty $key -Name '(Default)' -Value 'URL:System Checker Protocol' -Force | Out-Null
New-ItemProperty $key -Name 'URL Protocol' -Value '' -Force | Out-Null
New-Item "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty "$key\shell\open\command" -Name '(Default)' -Value ('"{0}" "%1"' -f $ExecutablePath)
Write-Host "Registered systemchecker:// for current user: $ExecutablePath"
