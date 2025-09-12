$ErrorActionPreference = "Stop"

$TaskName = "SalesVisualizationProduction"
$TaskPath = "\SalesVisualization\"
$Port = 8900
$AppDir = "D:\SalesVisualization\Sales"
$StartScript = Join-Path $AppDir "start_production.ps1"
$PowerShellExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $PowerShellExe) {
    $PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
}

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
    Write-Warning "Scheduled task did not leave port $Port listening; starting production bootstrap silently."
    Start-Process `
        -FilePath $PowerShellExe `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`"" `
        -WorkingDirectory $AppDir `
        -WindowStyle Hidden
    Start-Sleep -Seconds 20
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
}

if (-not $listeners) {
    throw "Production service failed to start on port $Port."
}

Write-Host "Restarted $TaskPath$TaskName"
