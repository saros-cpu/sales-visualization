param(
    [Parameter(Mandatory = $true)]
    [string[]]$Date,
    [string]$UploadedAt = "",
    [switch]$RunSnapshots,
    [switch]$RunAccounting,
    [string]$ReportRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "late_retail_data_maintenance.py"
$defaultReportFolder = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("5q+P5pel6ZSA6YeP5pel5oql"))
if (-not $ReportRoot) {
    $ReportRoot = "D:\$defaultReportFolder"
}

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "late retail data maintenance script not found: $scriptPath"
}

$argsList = @()
foreach ($rawItem in $Date) {
    foreach ($item in ($rawItem -split ",")) {
        $trimmed = $item.Trim()
        if ($trimmed) {
            $argsList += @("--date", $trimmed)
        }
    }
}
if ($UploadedAt) {
    $argsList += @("--uploaded-at", $UploadedAt)
}
if ($ReportRoot) {
    $argsList += @("--report-root", $ReportRoot)
}
if ($RunSnapshots) {
    $argsList += "--run-snapshots"
}
if ($RunAccounting) {
    $argsList += "--run-accounting"
}

Push-Location $repoRoot
try {
    & python $scriptPath @argsList
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
