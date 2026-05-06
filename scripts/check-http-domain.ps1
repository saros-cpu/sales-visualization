param(
    [string]$BaseUrl = "http://sales.example.com"
)

$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
$targets = @(
    @{ Name = "home"; Url = "$base/" },
    @{ Name = "apiHealth"; Url = "$base/api/health" },
    @{ Name = "latestYml"; Url = "$base/download/latest.yml" }
)

$results = @()
foreach ($target in $targets) {
    $started = Get-Date
    try {
        $response = Invoke-WebRequest -Uri $target.Url -UseBasicParsing -TimeoutSec 20
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

$failed = @($results | Where-Object { $_.Status -ne "ok" })
[PSCustomObject]@{
    Status = if ($failed.Count) { "failed" } else { "ok" }
    BaseUrl = $base
    SslCheck = "skipped_until_certificate_is_ready"
    Results = $results
} | ConvertTo-Json -Depth 4

if ($failed.Count) {
    exit 1
}
