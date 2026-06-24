param(
    [string]$BaseUrl = "https://sales.example.com"
)

$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
$targets = @(
    @{ Name = "home"; Url = "$base/" },
    @{ Name = "apiHealth"; Url = "$base/api/health" },
    @{ Name = "latestYml"; Url = "$base/download/latest.yml" }
)

$results = @()
$hstsHeader = ""
foreach ($target in $targets) {
    $started = Get-Date
    try {
        $response = Invoke-WebRequest -Uri $target.Url -UseBasicParsing -TimeoutSec 20
        if ($target.Name -eq "home") {
            $hstsHeader = [string]$response.Headers["Strict-Transport-Security"]
        }
        $results += [PSCustomObject]@{
            Name = $target.Name
            Url = $target.Url
            Status = "ok"
            StatusCode = [int]$response.StatusCode
            DurationMs = [int]((Get-Date) - $started).TotalMilliseconds
        }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        $results += [PSCustomObject]@{
            Name = $target.Name
            Url = $target.Url
            Status = "failed"
            StatusCode = $statusCode
            Error = $_.Exception.Message
            DurationMs = [int]((Get-Date) - $started).TotalMilliseconds
        }
    }
}

$isHttps = $base.StartsWith("https://", [StringComparison]::OrdinalIgnoreCase)
$hstsOk = -not $isHttps -or ($hstsHeader -match "max-age=31536000" -and $hstsHeader -match "includeSubDomains")
$failed = @($results | Where-Object { $_.Status -ne "ok" })
[PSCustomObject]@{
    Status = if ($failed.Count -or -not $hstsOk) { "failed" } else { "ok" }
    BaseUrl = $base
    SslCheck = if ($isHttps) { "enabled" } else { "http_compatibility" }
    Hsts = if ($isHttps) { $hstsHeader } else { "not_required_for_http_compatibility" }
    Results = $results
} | ConvertTo-Json -Depth 4

if ($failed.Count -or -not $hstsOk) {
    exit 1
}
