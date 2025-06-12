$ErrorActionPreference = "Stop"

$TaskName = "SalesVisualizationProduction"
$TaskPath = "\SalesVisualization\"
$Port = 8900

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

Write-Host "Restarted $TaskPath$TaskName"
