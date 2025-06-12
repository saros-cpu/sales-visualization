$ErrorActionPreference = "SilentlyContinue"

$taskPath = "\SalesVisualization\"
$taskName = "SalesVisualizationProduction"

Stop-ScheduledTask -TaskPath $taskPath -TaskName $taskName
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName
Start-Sleep -Seconds 18

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8900/api/health" -TimeoutSec 30 | Out-Null
} catch {
}
