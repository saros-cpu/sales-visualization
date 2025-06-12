# register-nginx-task.ps1 - Register Nginx auto-start on boot
# Usage: Run as Administrator
#   powershell -ExecutionPolicy Bypass -File register-nginx-task.ps1

$ErrorActionPreference = "Stop"

$taskName = "Nginx-SalesViz"
$nginxExe = "D:\nginx\nginx-1.26.3\nginx.exe"
$nginxDir = "D:\nginx\nginx-1.26.3"

Write-Host "=== Register Nginx Auto-Start ==="

# Remove existing task if any
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task '$taskName' ..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Create task
$action = New-ScheduledTaskAction -Execute $nginxExe -WorkingDirectory $nginxDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Nginx reverse proxy for SalesVisualization platform"

# Also start the task now (if not already running)
$proc = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "Starting Nginx now ..."
    Start-Process -FilePath $nginxExe -WorkingDirectory $nginxDir -WindowStyle Hidden
    Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "Task '$taskName' registered successfully."
Write-Host "Nginx will auto-start on system boot."
