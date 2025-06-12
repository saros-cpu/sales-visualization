# test-nginx.ps1 - Quick test of Nginx deployment

Write-Host "=== Nginx Deployment Test ==="
Write-Host ""

# 1. Homepage
Write-Host "[1] GET http://localhost (React SPA) ..."
try {
    $r = Invoke-WebRequest -Uri "http://localhost" -UseBasicParsing -TimeoutSec 5
    Write-Host "  Status: $($r.StatusCode)"
    Write-Host "  Content length: $($r.Content.Length) bytes"
    if ($r.Content -match "<div id=`"root`">") {
        Write-Host "  React root element: FOUND"
    } else {
        Write-Host "  React root element: NOT FOUND (check dist/index.html)"
    }
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)"
}

# 2. API health
Write-Host ""
Write-Host "[2] GET http://localhost/api/health ..."
try {
    $r = Invoke-WebRequest -Uri "http://localhost/api/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "  Status: $($r.StatusCode)"
    Write-Host "  Response: $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))"
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)"
}

# 3. Static JS file
Write-Host ""
Write-Host "[3] GET static JS asset ..."
try {
    $jsFiles = Get-ChildItem "D:\SalesVisualization\frontend\dist\assets\*.js" | Select-Object -First 1
    $jsName = $jsFiles.Name
    $r = Invoke-WebRequest -Uri "http://localhost/assets/$jsName" -UseBasicParsing -TimeoutSec 5
    Write-Host "  Status: $($r.StatusCode)"
    Write-Host "  Content length: $($r.Content.Length) bytes"
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)"
}

# 4. Retail-app legacy route
Write-Host ""
Write-Host "[4] GET http://localhost/retail-app/dashboard.html ..."
try {
    $r = Invoke-WebRequest -Uri "http://localhost/retail-app/dashboard.html" -UseBasicParsing -TimeoutSec 5
    Write-Host "  Status: $($r.StatusCode)"
    Write-Host "  Content length: $($r.Content.Length) bytes"
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)"
}

# 5. SPA route (deep link)
Write-Host ""
Write-Host "[5] GET http://localhost/retail (SPA deep link) ..."
try {
    $r = Invoke-WebRequest -Uri "http://localhost/retail" -UseBasicParsing -TimeoutSec 5
    Write-Host "  Status: $($r.StatusCode)"
    Write-Host "  Content length: $($r.Content.Length) bytes"
    if ($r.Content -match "<div id=`"root`">") {
        Write-Host "  SPA fallback: OK"
    }
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)"
}

# 6. Nginx process
Write-Host ""
Write-Host "[6] Nginx process status ..."
$proc = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "  Running (PIDs: $($proc.Id -join ', '))"
} else {
    Write-Host "  NOT RUNNING"
}

Write-Host ""
Write-Host "=== Test Complete ==="
