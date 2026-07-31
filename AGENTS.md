# Project Memory

This repository is the Sales Visualization production project at `D:\SalesVisualization`.
Future agents, tools, and maintainers must treat this file as the project memory and operating contract.

## Core Rules

- `C:\SNC_OFFICE` is the original retail software source directory. It is strictly read-only. Do not modify, rename, delete, overwrite, or generate temporary files there.
- If a DLL from the original retail software must be decompiled, copy it to an approved D: drive analysis directory first. Only decompile the copied file.
- If original retail database validation is needed, connect to `ocw` only with the project-approved read-only account. Do not use write accounts or execute write/DDL SQL against `ocw`.
- `docs/*.md`, config files, `.env`, secrets, report exports, compare outputs, snapshots, backups, and generated installers must not be committed unless the user explicitly changes that policy.
- `report_compare_outputs/` contains business report comparison data. Keep or archive locally; do not commit it.
- For code discovery, use CodeGraph first when `.codegraph/` exists, then use `rg` for strings, configs, docs, and generated files.
- Do not rewrite finished report logic by taste. Report changes require original software report number, source SQL/path, sample period, comparison result, and documented conclusion.

## Current Baseline

- Current released client version: `5.4.0`.
- Current release code commit: tag `v5.4.0`（版本号 5.3.0 → 5.4.0，含 5.3.0 之后全部修复：双语两行显示、列宽自适应/居中、录入回车焦点、采购查询、明细保存 500、乱码根因修复）；previous release was `v5.3.0`.
- Production public entry: `https://sales.example.com/`.
- Production backup entry details are kept only in `docs/配置文档.md`.
- Backend listens only on `127.0.0.1:8900`.
- Desktop update feed: `https://sales.example.com/download/latest.yml`; fallback endpoint details are kept only in `docs/配置文档.md`.
- Current installer: `SalesDesktop Setup 5.4.0.exe`.
- Current wallpaper package: `SalesWallpaperEngine 0.2.5` via `https://sales.example.com/download/wallpaper-engine/latest.json`. This remains independent from the `SalesDesktop` client version line.
- The old web wallpaper package is retired and removed. Future wallpaper work must use `SalesWallpaperEngine`.
- HTTPS certificate: enabled; certificate paths are kept only in `docs/配置文档.md`. HTTP remains active for compatibility.
- Shared API/report path contracts live in `shared/api-contracts.js`; Web, desktop, and wallpaper callers should add paths there before using them in app-specific wrappers.
- Shared retail display helpers live in `shared/retail-core.js`, and shared assistant frontend helpers live in `shared/assistant-ui.js`; do not duplicate month selection, tons/amount extraction, station name splitting, KPI formatting, assistant table merging, or assistant context helpers in individual pages.
- Web routes are page-level lazy loaded through `frontend/src/App.jsx`; new heavy Web pages should follow that pattern so the first screen does not load every module.
- Current 5.1.0 wholesale rule: wholesale, procurement, outsourced processing, and own transfer use one unified classification model. Sender example/oil-gas company to customer is wholesale, customer to example/oil-gas company is procurement, customer to customer is outsourced processing, and own transfer must resolve to a retail-board owned station/depot. Business reporting uses weighing-generated details before `2026-06-01` and uploaded/manual details from `2026-06-01`; query/export/auto-generation clamp weighing details to `2026-05-31` and earlier (`WHOLESALE_WEIGHING_END_DATE` in `Sales/wholesale_source_policy.py`); do not infer missing LPG tank-area totals from LPG product rows because the tank area can also load AI-80/AI-92 and reports cannot reliably identify tank-area source.
- Wholesale detail query/export (5.1.0): filter options come from `/api/v2/wholesale/details/filter-options` and `/api/v2/weighing/filter-options`; bilingual export `/api/v2/wholesale/details/export` renders Chinese+Russian two-line cells; customer/sender/receiver/product names resolve to standard names via customer maintenance and aliases.

## Report Boundaries

- Retail daily report:
  - For Chinese management.
  - Detail sheets should use the same data source as original report 84, but this project groups a complete natural day. One day may correspond to multiple original 84 shift reports.
  - Summary sheet compares to original report 254.
  - Data must match; format does not need to match the original software.
  - Public download filename is `加油站{中文月份}日销表{生成日期}.xlsx`, while internal storage stays under `OilStation/exports/monthly/{year}/` with indexed relative paths.
- Daily briefing report:
  - For Chinese management.
  - Matches the desktop template layout named `ProductTeam销售日报表YYYY.MM.DD.xlsx`; runtime generation should not depend on a user desktop file being present.
  - Report date is the selected briefing date; daily retail data uses the previous day, and monthly/yearly retail totals run through the previous day.
  - Only retail filling is implemented for now. Wholesale columns are intentionally left blank.
  - Diesel variants such as diesel, -10 diesel, and -35 diesel must be grouped under the diesel口径.
  - Retail tons must keep 3 decimal places and match retail snapshot/AI口径: daily from the day snapshot, month from the matching monthly snapshot, year from the yearly resource snapshot; do not round each product/day to 2 decimals before totaling.
- Self-use oil report:
  - For Chinese management.
  - Compares to original report 24.
  - Data must match; format may follow Chinese management habits.
  - Current fixed logic is report24-only: `selling.BasePaymentTypeKey=2 AND selling.DerivedPaymentTypeKey=2`.
  - Driver/plate comes from `change_log.GuideKey=590336` joined by `ShopKey + PersonShopKey`.
  - Volume, amount, and mass come from `selling.Volume`, `selling.ShopCost`, and `selling.Mass`.
  - Do not use project plate mapping, generator special cases, `person.Name` fallback, or density fallback for self-use final output.
- Kyrgyz accounting handover report:
  - For local Kyrgyz/finance handover.
  - Must match original report 84 completely: data, layout, fields, order, merged cells, styles, and file behavior.
  - Do not apply Chinese retail daily report layout to this report.
- Profit accounting reports:
  - For Chinese management.
  - Monthly and yearly profit accounting use retail daily/monthly snapshot station and fuel naming as the sales source; sales amount, sales volume, tons, diesel sales amount, and diesel volume must come from the same retail report/snapshot口径.
  - 2026 January-July purchase prices use the confirmed monthly files under `D:\每月加油站业绩考核类表单\2026年`; do not re-infer or overwrite them by taste.
  - Water/electric/network/security and payroll costs are full-month for normally operating stations and prorated by actual operating days only for newly opened stations.
  - Loss cannot be carried backward without data; do not fabricate historical loss values.

## Living Documents

The project documentation directory is `D:\SalesVisualization\docs`. These documents are local maintenance records and are gitignored.

Current documentation set:

- `技术方案文档.md`: architecture, modules, data links, security boundaries.
- `实施计划文档.md`: build, release, deploy, operations, validation.
- `配置文档.md`: real local accounts, ports, services, tasks, secret locations. Do not commit.
- `报表口径文档.md`: original software report numbers, SQL/data source, report boundaries.
- `API接口调用手册.md`: API prefixes, endpoints, auth, downloads, client wrappers.
- `维护交接手册.md`: handover guide for future tools/people.
- `代码知识图谱说明.md`: CodeGraph state, commands, query templates.
- `关键调用链清单.md`: important frontend -> API -> backend -> data/report chains.
- `数据库表字段说明.md`: `ocw` and `sales_visualization` table purposes and key fields.
- `报表验数记录.md`: report comparison batches, sample periods, difference counts, conclusions.
- `发布版本台账.md`: versions, commits, installers, blockmaps, deployment and validation status.
- `生产故障处理手册.md`: production troubleshooting runbooks.
- `销售板块可视化平台项目进展与验收报告.md`: acceptance scope, validation results, remaining work.

## Continuous Documentation Maintenance Contract

When making changes, update documents according to this matrix:

| Change type | Documents to update |
| --- | --- |
| Release, deployment, version bump, installer update | `发布版本台账.md`, `实施计划文档.md`, `销售板块可视化平台项目进展与验收报告.md`, `README.md` |
| Desktop client version change | `SalesDesktop/src/version.ts`, `SalesDesktop/package.json`, `SalesDesktop/package-lock.json`, `发布版本台账.md`, `README.md` |
| Report logic or report format change | `报表口径文档.md`, `报表验数记录.md`, `关键调用链清单.md`; also `API接口调用手册.md` if endpoints change |
| Original retail software report research | `报表口径文档.md`, `数据库表字段说明.md` if new tables/fields are identified |
| API route, auth, download, or client wrapper change | `API接口调用手册.md`, `关键调用链清单.md`, and `技术方案文档.md` if architecture changes |
| Database table or field change | `数据库表字段说明.md`; also `API接口调用手册.md` and `报表口径文档.md` if affected |
| Config, service, account, port, certificate, task change | `配置文档.md`, `实施计划文档.md`; also `技术方案文档.md` if topology changes |
| Production incident or workaround | `生产故障处理手册.md`; if released as a fix, also `发布版本台账.md` and acceptance report |
| CodeGraph/index/tooling change | `代码知识图谱说明.md`, `维护交接手册.md` |
| Major flow change across frontend/backend/tasks/reports | `关键调用链清单.md`, `技术方案文档.md`, relevant API/report/database docs |

Minimum rule: if the change would confuse a future maintainer who only reads the docs, update the matching document in the same work session.

## Standard Verification

Before release or after non-trivial code changes, run the checks appropriate to the touched area:

```powershell
cd D:\SalesVisualization
git diff --check
python -B -m compileall -q Sales OilStation
python -m unittest discover -s Sales/tests

cd D:\SalesVisualization\SalesDesktop
npm run typecheck
npm test
npm run build

cd D:\SalesVisualization\frontend
npm test
npm run build

cd D:\SalesVisualization
powershell -ExecutionPolicy Bypass -File .\scripts\preflight-release.ps1
```

For production deployment:

```powershell
cd D:\SalesVisualization
powershell -ExecutionPolicy Bypass -File .\deploy-production.ps1
powershell -ExecutionPolicy Bypass -File .\Sales\restart_production_task.ps1
```

For desktop auto-update verification:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://sales.example.com/download/latest.yml"
Invoke-WebRequest -UseBasicParsing -Uri "https://sales.example.com/download/SalesDesktop%20Setup%205.1.0.exe" -Method Head
Invoke-WebRequest -UseBasicParsing -Uri "https://sales.example.com/download/SalesDesktop%20Setup%205.1.0.exe.blockmap" -Method Head
curl.exe -H "Range: bytes=0-9,20-29" "https://sales.example.com/download/SalesDesktop%20Setup%205.1.0.exe"
```

## CodeGraph Memory

Current CodeGraph baseline:

- Files: `395`
- Nodes: `10,132`
- Edges: `34,126`
- DB size: `58.13 MB`
- Status: `Index is up to date`

Use these common queries:

```powershell
codegraph status
codegraph explore "self-use report24-only"
codegraph explore "retail range report 254"
codegraph explore "accounting handover report 84"
codegraph explore "profit accounting snapshots purchase prices"
codegraph explore "shared API contracts desktop wrappers"
codegraph explore "knowledge attachments reindex"
codegraph explore "electron-updater latest.yml download"
```

## Git Hygiene

- Be careful with `git add -A`; it can accidentally stage public docs or generated outputs if ignore rules change.
- Expected local-only paths include `docs/*.md`, `report_compare_outputs/`, `.codegraph/`, `.code-review-graph/`, `SalesDesktop/download/`, `SalesDesktop/release_build/`, `OilStation/exports/`, `Sales/exports/`, caches, logs, and backups.
- Never revert user changes unless explicitly requested.
- Do not use destructive Git commands such as `git reset --hard` or `git checkout --` without explicit user instruction.

## Handoff Reminder

When finishing a change, report:

- What changed.
- Which documents were updated.
- Which checks were run.
- Whether anything was not run.
- Whether there are uncommitted tracked files.
- Whether any local-only outputs remain, especially report comparison files.
