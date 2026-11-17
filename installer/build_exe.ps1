$ErrorActionPreference='Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
python -m pip install -r native_checker\requirements.txt pyinstaller
# Keep the console visible for development diagnostics and invalid URL errors.
python -m PyInstaller --noconfirm --clean --onefile --name SystemChecker --paths $root --collect-all websockets native_checker\main.py
if (-not (Test-Path "$root\dist\SystemChecker.exe")) { throw 'PyInstaller completed without dist\SystemChecker.exe' }
Write-Host "Built $root\dist\SystemChecker.exe"
