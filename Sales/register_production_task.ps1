$ErrorActionPreference = "Stop"

$TaskName = "SalesVisualizationProduction"
$TaskPath = "\SalesVisualization\"
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonwExe = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $PythonwExe) {
    $PythonwExe = "C:\Users\User\AppData\Local\Programs\Python\Python313\pythonw.exe"
}
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$Action = New-ScheduledTaskAction `
  -Execute $PythonwExe `
  -Argument "run_production.py" `
  -WorkingDirectory $AppRoot

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -TaskPath $TaskPath `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Settings $Settings `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath

Write-Host "Registered and started $TaskPath$TaskName"
