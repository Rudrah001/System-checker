param([string]$ExecutablePath = "$PSScriptRoot\..\dist\SystemChecker.exe")
$ErrorActionPreference = 'Stop'
$ExecutablePath = [System.IO.Path]::GetFullPath($ExecutablePath)
$expected = ('"{0}" "%1"' -f $ExecutablePath)
$key = 'HKCU:\Software\Classes\systemchecker\shell\open\command'
$current = (Get-ItemProperty -Path $key -Name '(Default)' -ErrorAction SilentlyContinue).'(Default)'
if ($current -eq $expected) {
    Remove-Item 'HKCU:\Software\Classes\systemchecker' -Recurse -Force
    Write-Host "Removed development systemchecker:// registration for $ExecutablePath"
} elseif ($current) {
    Write-Warning "Registration points elsewhere and was preserved: $current"
} else {
    Write-Host 'No systemchecker:// registration found.'
}
