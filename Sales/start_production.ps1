$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = "C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe"
$LogDir = Join-Path $AppRoot "logs"
$LogFile = Join-Path $LogDir "production.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $AppRoot

$env:PYTHONUNBUFFERED = "1"
$env:SALES_HOST = if ($env:SALES_HOST) { $env:SALES_HOST } else { "0.0.0.0" }
$env:SALES_PORT = if ($env:SALES_PORT) { $env:SALES_PORT } else { "8900" }

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Sales Visualization on $($env:SALES_HOST):$($env:SALES_PORT)" |
  Out-File -FilePath $LogFile -Append -Encoding utf8

& $PythonExe "run_production.py"
