param([switch]$WithASR)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (!(Test-Path '.venv\Scripts\python.exe')) { if (!(Test-Path '.tools\bin\uv.exe')) { python -m pip install --target .tools uv }; $env:UV_PYTHON_INSTALL_DIR = Join-Path $root '.tools\python'; .\.tools\bin\uv.exe venv --python 3.11 .venv }
$req = if ($WithASR) { 'backend\requirements-asr.txt' } else { 'backend\requirements.txt' }
$env:UV_CACHE_DIR = Join-Path $root '.tools\cache'
.\.tools\bin\uv.exe pip install --python .venv\Scripts\python.exe -r $req
if (!(Test-Path 'node_modules')) { npm.cmd install --no-audit --no-fund }
Write-Host 'Setup complete. Run .\start.ps1'
