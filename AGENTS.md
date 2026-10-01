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

- Current released client version: `5.6.5`.
- Current release code commit: `2d8b84b` / tag `v5.6.4`（零售/批发外运菜单标签区分——「外运」→「零售外运」/「批发外运」中俄双语，含零售外运实收统计页随版发布）；previous release was `v5.6.3`（自用油页统计条跟随车牌筛选，桌面端+Web 端共用 `summarizeSelfUseRecords`；壁纸线同步修CTY-22重复标点）（站点地图/壁纸/Web 端油库名称与编号三系统统一，D-0X 总部/D-0X CTY-22/D-0X REG-08，替换旧称「DemoDepotNorth/DemoDepotSouth」）；wallpaper engine `v0.2.9`（提交 `eb4ed0f`：修正 0.2.8 运行时前置检查误报“缺少环境”的假阴性——改为查注册表+多路径磁盘探测，并把检查移到宿主进程启动处避免播放子进程退出导致白屏），已推进至 `v0.2.21`（0.2.13–0.2.21：系统 WebView2 运行时收敛、库存面板过滤/滚动修复、WH_MOUSE_LL 全局滚轮钩子、库存口径 >60% 隐藏/<10% 罐底油 0 天/10–60% 可售天数、站点名本地化、打包烧 key 且自动更新重部署到 %APPDATA%\sales-wallpaper-engine；配套后端 per-shop 索引+30min TTL 缓存性能修复 `cdd1e83`、可售天数 `47883ec`、卸载脚本 `8bb6ce0`），最新为 `v0.2.24`（修复STN-63重复标点：兜底油库去重改为油库编号/坐标/名称任一命中，并重建 2026-08-21 之后未再构建的前端资源与离线兜底 `business_points.json`，新增 code 字段）；再往前 v5.5.2（`513258a`：数据录入发货单位乱码字面量修复、BilingualName showRaw 判定提取纯函数+测试护栏、版本链文档同步）、v5.5.1（`36115a9`：称重审核纯俄文原始名重复显示根治）、v5.5.0（`0568a36`：采购查询/数据录入明细维护双语显示统一）、v5.4.2（`a3bd703`：BilingualName 中文文本比较根治）、v5.4.1（`3b7ca26`：中文主行相等判定）、v5.4.0（`e102b10`：双语两行显示/列宽自适应/居中/录入回车焦点/采购查询/明细保存 500/乱码根因修复）。注意：v5.2.0（`a8f0b40`）/v5.3.0（`7cb50ff`）原始提交为悬空对象（孤儿分支整理所致），其内容已并入 master 链（`db31927`/`b853522` 等），对应 tag `v5.2.0`/`v5.3.0` 为追溯兜底，非 HEAD 祖先。
- Production public entry: `https://sales.example.com/`.
- Production backup entry details are kept only in `docs/配置文档.md`.
- Backend listens only on `127.0.0.1:8900`.
- Desktop update feed: `https://sales.example.com/download/latest.yml`; fallback endpoint details are kept only in `docs/配置文档.md`.
- Current installer: `SalesDesktop Setup 5.6.5.exe`.
- Current wallpaper package: `SalesWallpaperEngine 0.2.24` via `https://sales.example.com/download/wallpaper-engine/latest.json`. This remains independent from the `SalesDesktop` client version line.
- The old web wallpaper package is retired and removed. Future wallpaper work must use `SalesWallpaperEngine`.
- HTTPS certificate: enabled; certificate paths are kept only in `docs/配置文档.md`. HTTP remains active for compatibility.
- Shared API/report path contracts live in `shared/api-contracts.js`; Web, desktop, and wallpaper callers should add paths there before using them in app-specific wrappers.
- Shared retail display helpers live in `shared/retail-core.js`, and shared assistant frontend helpers live in `shared/assistant-ui.js`; do not duplicate month selection, tons/amount extraction, station name splitting, KPI formatting, assistant table merging, or assistant context helpers in individual pages.
- Web routes are page-level lazy loaded through `frontend/src/App.jsx`; new heavy Web pages should follow that pattern so the first screen does not load every module.
- Current wholesale classification (2025-01-01 source cutover): KPI reads `wholesale_detail_records.classification` stored values; report/uploaded rows (`batch_id IS NOT NULL` and `business_date >= 2025-01-01`) are authoritative, weighing rows (`batch_id IS NULL` or before cutoff) are excluded. Classification is stamped at import by source-file type under three preset authorities: (1) 外购/raw-material procurement files → `procurement` regardless of names; (2) own transfer stations = retail-board catalog (`retail_station_catalog()`) + own_depot only, never polluted `entity_aliases.retail_station` aliases; (3) customers.customer_type decides `local_wholesale` vs `export_wholesale` for sales/transfer files. `processing` (outsourced processing, 52 rows) is kept as its own category even inside procurement files. Never run `recalculate_wholesale_batch` after report import (it re-derives classification from sender/receiver entity types, ignores stored values, and destroys KPI categories). Full rules in `docs/客户名及自有站点名维护.md`. `WHOLESALE_SOURCE_CUTOFF = date(2025,1,1)` in `Sales/wholesale_source_policy.py`.
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
  - Wholesale volume columns (C daily / H monthly / J yearly) are intentionally left blank per business decision on 2026-09-02; do not refill them from `wholesale_detail_records`.
  - Wholesale price columns (D large-customer / E retail) keep their manually maintained values from the `wholesale_briefing_prices` table (product_key = template row 5-11); they are not derived at generation time.
  - Retail price (G) = sales amount in som ÷ tons ÷ `DAILY_BRIEFING_EXCHANGE_RATE` (a hardcoded 87.50, not the live rate table).
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
- `客户名及自有站点名维护.md`: customer standard names, duplicate-name merge rules, wholesale five-way classification (transfer/export/local/procurement/processing), and own station name maintenance. Authoritative reference for classification and entity maintenance.

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
| Customer name, station name, or wholesale classification change (merge, reclassify, register, alias) | `客户名及自有站点名维护.md` (primary); also `数据库表字段说明.md` and `报表口径文档.md` if rules change |

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
Invoke-WebRequest -UseBasicParsing -Uri "https://sales.example.com/download/SalesDesktop%20Setup%205.6.0.exe" -Method Head
Invoke-WebRequest -UseBasicParsing -Uri "https://sales.example.com/download/SalesDesktop%20Setup%205.6.0.exe.blockmap" -Method Head
curl.exe -H "Range: bytes=0-9,20-29" "https://sales.example.com/download/SalesDesktop%20Setup%205.6.0.exe"
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

## Internal Dashboards (price-watch)

- `screen_key=price-watch` is an **internal** screen: `/dashboards/price-watch` requires login and a department whitelist (market sales department + management; admin always passes). Undocumented visitors are redirected to `/dashboards/price-watch/login`. The public wholesale board (`price-board`) stays login-free.
- Visibility lives in `dashboard_screens.visibility` (`public` | `internal`) plus `allowed_departments` (comma-separated department names). Do **not** create a separate route prefix; nginx needs no change.
- Data lives in dedicated tables `price_watch_*` (brands / stations / quotes / own_prices / ceilings / runs), never in `dashboard_screens.data_json`.
- **Comparison rule**: competitor feeds publish the *board price* (Цена на стеле); anything derived from our DB is the *average transacted price* (contains discounts and contract prices). Never subtract one from the other. Our board price is maintained separately by station reports + HQ review.
- Collection runs on the Windows tasks `PriceWatchCollectMorning` (daily 08:00, full) and `PriceWatchCollectAfternoon` (daily 14:00, prices only) via `scripts/refresh_price_watch.py`.
- Design and source-probe details: `docs/零售价格对比平台策划方案.md`, `docs/零售价格对比平台_价格获取渠道实测与策略.md`, `docs/零售价格对比平台_App逆向实测.md`.

## Handoff Reminder

When finishing a change, report:

- What changed.
- Which documents were updated.
- Which checks were run.
- Whether anything was not run.
- Whether there are uncommitted tracked files.
- Whether any local-only outputs remain, especially report comparison files.
