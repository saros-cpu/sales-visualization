param(
    [string]$Start = "",
    [string]$End = "",
    [switch]$FailOnIssue
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "audit_retail_density_mass.py"

$argsList = @()
if ($Start) {
    $argsList += @("--start", $Start)
}
if ($End) {
    $argsList += @("--end", $End)
}
if ($FailOnIssue) {
    $argsList += "--fail-on-issue"
}

Push-Location $repoRoot
try {
    & python $scriptPath @argsList
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
