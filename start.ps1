$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (!(Test-Path '.venv\Scripts\python.exe')) { throw 'Run setup.ps1 first.' }
$env:PYTHONPATH = $root
$env:CAMPUS_DATA_DIR = Join-Path $root 'data'
$backend = Start-Process -FilePath (Join-Path $root '.venv\Scripts\python.exe') -ArgumentList '-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8765' -WorkingDirectory $root -PassThru
try { npm.cmd run dev } finally { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
