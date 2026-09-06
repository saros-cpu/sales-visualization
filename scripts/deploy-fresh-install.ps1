# 全新部署辅助脚本（幂等，默认 -DryRun，配套 docs/项目完整部署方案.md）
# 用法示例： powershell -ExecutionPolicy Bypass -File scripts/deploy-fresh-install.ps1 -DryRun
param(
  [switch]$DryRun = $true,          # 默认只打印将要执行的步骤
  [switch]$RunMigrations,           # 执行 schema+migrations（需 mysql 客户端与 .env 凭据）
  [switch]$RunBackend,              # 安装依赖并启动 run_production.py
  [string]$NginxWebRoot = ""        # 指定时同步 frontend/dist
)
$ErrorActionPreference = "Stop"
$RepoRoot = if ($PSScriptRoot -like "*\scripts") { Split-Path $PSScriptRoot -Parent } else { $PSScriptRoot }
Write-Host "[deploy-fresh-install] RepoRoot=$RepoRoot DryRun=$DryRun"

function Invoke-Step {
  param([string]$Name, [scriptblock]$Body)
  Write-Host "`n==> $Name"
  if ($DryRun) { Write-Host "    (DryRun 跳过执行)" ; return }
  & $Body
}

Invoke-Step "1. 环境自检 (python/node/mysql/nginx)" {
  python --version
  node --version
  mysql --version
  nginx -v
}

Invoke-Step "2. 后端依赖安装 (pip install -r requirements.txt)" {
  Push-Location "$RepoRoot\Sales"
  python -m pip install -r requirements.txt
  Pop-Location
}

if ($RunMigrations) {
  Invoke-Step "3. 数据库初始化: schema.sql + migrations 003~010" {
    # 凭据来自 Sales/.env；此步骤需 mysql 客户端可用
    $envFile = "$RepoRoot\Sales\.env"
    if (-not (Test-Path $envFile)) { throw "缺少 $envFile（请先按部署方案配置）" }
    # 手动执行（示例）：
    #   mysql -usales_app -p sales_visualization < Sales\schema.sql
    #   Get-ChildItem Sales\migrations\*.sql | Sort-Object Name | ForEach-Object { mysql -usales_app -p sales_visualization < $_.FullName }
    Write-Host "    （示例命令见 docs/项目完整部署方案.md §3，凭据从 .env 读取后自行执行）"
  }
}

if ($RunBackend) {
  Invoke-Step "4. 启动生产服务 (run_production.py, waitress 127.0.0.1:8900)" {
    Push-Location "$RepoRoot\Sales"
    Start-Process -FilePath python -ArgumentList "run_production.py" -WorkingDirectory (Get-Location) -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8900/api/health" -TimeoutSec 5
    if (-not $h.ok) { throw "健康检查失败" }
    Write-Host "    健康检查通过: $($h | ConvertTo-Json -Compress)"
    Pop-Location
  }
}

if ($NginxWebRoot -and (Test-Path "$RepoRoot\frontend\dist")) {
  Invoke-Step "5. 同步 Web dist -> $NginxWebRoot" {
    robocopy "$RepoRoot\frontend\dist" $NginxWebRoot /MIR /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -ge 8) { throw "robocopy 失败 (exit=$LASTEXITCODE)" }
  }
}

Invoke-Step "6. 验证清单提示" {
  Write-Host "  按 docs/项目完整部署方案.md §9 逐项验证，并回填发布台账。"
}
Write-Host "`n[deploy-fresh-install] 完成（$(@{ $true='DryRun'; $false='实际执行' }[$DryRun])）"
