$ErrorActionPreference = "Stop"

$TaskPath = "\SalesVisualization\"
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonwExe = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $PythonwExe) {
    $PythonwExe = "C:\Users\User\AppData\Local\Programs\Python\Python313\pythonw.exe"
}
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Register-SalesDailyTask {
  param(
    [string]$TaskName,
    [string]$TaskArgument,
    [string]$Time
  )

  $Action = New-ScheduledTaskAction `
    -Execute $PythonwExe `
    -Argument "daily_maintenance.py --task $TaskArgument" `
    -WorkingDirectory $AppRoot

  $Trigger = New-ScheduledTaskTrigger -Daily -At $Time
  $Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
  $Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable

  Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath $TaskPath `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Force | Out-Null
}

Register-SalesDailyTask -TaskName "SalesVisualizationDailyExchangeRates" -TaskArgument "exchange_rates" -Time "07:30"
Register-SalesDailyTask -TaskName "SalesVisualizationDailyMarketWatch" -TaskArgument "market_watch" -Time "07:30"
Register-SalesDailyTask -TaskName "SalesVisualizationDailyRetailSnapshots" -TaskArgument "retail_snapshots" -Time "08:30"
Register-SalesDailyTask -TaskName "SalesVisualizationDailyRetailAccountingReports" -TaskArgument "retail_accounting_reports" -Time "08:45"

Write-Host "Registered daily automation tasks under $TaskPath"
