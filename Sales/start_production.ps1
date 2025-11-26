$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PreferredPythonExe = "C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe"
$PreferredPythonwExe = "C:\Users\User\AppData\Local\Programs\Python\Python313\pythonw.exe"
$PythonExe = if (Test-Path $PreferredPythonExe) {
    $PreferredPythonExe
} else {
    (Get-Command python.exe -ErrorAction Stop).Source
}
$PythonwExe = if (Test-Path $PreferredPythonwExe) {
    $PreferredPythonwExe
} else {
    (Get-Command pythonw.exe -ErrorAction Stop).Source
}
$LogDir = Join-Path $AppRoot "logs"
$LogFile = Join-Path $LogDir "production.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $AppRoot

$env:PYTHONUNBUFFERED = "1"
$env:SALES_HOST = if ($env:SALES_HOST) { $env:SALES_HOST } else { "127.0.0.1" }
$env:SALES_PORT = if ($env:SALES_PORT) { $env:SALES_PORT } else { "8900" }

$ExistingListener = Get-NetTCPConnection -LocalPort ([int]$env:SALES_PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ExistingListener) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Sales Visualization already listening on $($env:SALES_HOST):$($env:SALES_PORT), pid=$($ExistingListener.OwningProcess)" |
    Out-File -FilePath $LogFile -Append -Encoding utf8
  exit 0
}

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Sales Visualization silently on $($env:SALES_HOST):$($env:SALES_PORT)" |
  Out-File -FilePath $LogFile -Append -Encoding utf8

$Process = Start-Process -FilePath $PythonwExe -ArgumentList "run_production.py" -WorkingDirectory $AppRoot -WindowStyle Hidden -PassThru
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Started background process pid=$($Process.Id)" |
  Out-File -FilePath $LogFile -Append -Encoding utf8

Start-Sleep -Seconds 3
$StartedListener = Get-NetTCPConnection -LocalPort ([int]$env:SALES_PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $StartedListener) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Background start did not bind port yet; fallback to hidden python.exe" |
    Out-File -FilePath $LogFile -Append -Encoding utf8
  Start-Process -FilePath $PythonExe -ArgumentList "run_production.py" -WorkingDirectory $AppRoot -WindowStyle Hidden | Out-Null
}
