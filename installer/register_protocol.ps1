param(
    [string]$ExecutablePath = "$PSScriptRoot\..\dist\SystemChecker.exe",
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$ExecutablePath = [System.IO.Path]::GetFullPath($ExecutablePath)
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { throw "SystemChecker executable not found: $ExecutablePath" }
$commandKey = 'HKCU:\Software\Classes\systemchecker\shell\open\command'
$existing = (Get-ItemProperty -Path $commandKey -Name '(Default)' -ErrorAction SilentlyContinue).'(Default)'
$expected = ('"{0}" "%1"' -f $ExecutablePath)
if ($existing -and $existing -ne $expected -and -not $Force) {
    throw "systemchecker:// is registered to '$existing'. Re-run with -Force only if you intend to replace it."
}
$key='HKCU:\Software\Classes\systemchecker'; New-Item $key -Force | Out-Null
New-ItemProperty $key -Name '(Default)' -Value 'URL:System Checker Protocol' -Force | Out-Null
New-ItemProperty $key -Name 'URL Protocol' -Value '' -Force | Out-Null
New-Item "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty "$key\shell\open\command" -Name '(Default)' -Value $expected
Write-Host "Registered systemchecker:// for current user: $ExecutablePath"
