$ErrorActionPreference = "Stop"

$TaskName = "SalesVisualizationProduction"
$TaskPath = "\SalesVisualization\"
$Port = 8900
$PythonExe = "C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe"
$AppDir = "D:\SalesVisualization\Sales"
$AppEntry = "run_production.py"

Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
    if ($listener.OwningProcess) {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 1

Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
Start-Sleep -Seconds 20

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listeners) {
    Write-Warning "Scheduled task did not leave port $Port listening; starting production process directly."
    Start-Process -FilePath $PythonExe -ArgumentList $AppEntry -WorkingDirectory $AppDir -WindowStyle Hidden
    Start-Sleep -Seconds 20
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
}

if (-not $listeners) {
    throw "Production service failed to start on port $Port."
}

Write-Host "Restarted $TaskPath$TaskName"
