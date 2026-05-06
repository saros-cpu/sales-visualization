param(
    [string]$SalesRoot = "D:\SalesVisualization\Sales",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$pythonCode = @'
import json
import sys
from pathlib import Path

sales_root = Path(r"__SALES_ROOT__")
if str(sales_root) not in sys.path:
    sys.path.insert(0, str(sales_root))

from routes_assistant import assistant_project_coverage_status

status = assistant_project_coverage_status()
print(json.dumps(status, ensure_ascii=False, indent=2, default=str))
if status.get("status") != "ok":
    sys.exit(2)
'@

$resolvedSalesRoot = (Resolve-Path -LiteralPath $SalesRoot).Path
$pythonCode = $pythonCode.Replace("__SALES_ROOT__", $resolvedSalesRoot.Replace("\", "\\"))

$scriptPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "assistant_coverage_$([guid]::NewGuid().ToString('N')).py")
[System.IO.File]::WriteAllText($scriptPath, $pythonCode, [System.Text.UTF8Encoding]::new($false))
try {
    if ($OutputPath) {
        python $scriptPath | Tee-Object -FilePath $OutputPath
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } else {
        python $scriptPath
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
} finally {
    Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
}
