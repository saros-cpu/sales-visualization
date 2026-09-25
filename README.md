# 销售板块可视化平台

项目根目录：`D:\SalesVisualization`

本项目是公司销售数据可视化总平台，用于统一展示零售、批发与合并统计数据。当前系统由 Nginx 对外提供 HTTPS 域名入口，Flask 后端仅监听本机 `127.0.0.1:8900`；HTTP 域名入口跳转 HTTPS，备用入口细节见配置文档。

## 版本更新记录

### 2026-10-04 (v5.6.4)

- **版本号**：5.6.3 → 5.6.4（patch）。
- **零售/批发「外运」标签区分**：零售板块菜单项由「外运」改为「零售外运」、批发板块由「外运」改为「批发外运」（中文 + 俄文双语同步），解决登录后菜单出现两个同名「外运」项难以区分的问题。仅涉及菜单文案与 i18n，无业务逻辑改动；后端零售外运实收统计页（`/retail/transfer`）与批发外运页（`/wholesale/transfer`）此前已分别独立实现。

### 2026-09-30 (v5.6.3)

- **版本号**：5.6.2 → 5.6.3（patch）。
- **自用油页统计条跟随车牌筛选**：未输入车牌时显示所选时间区间的完整累计；输入车牌后按内容区实际展示的记录实算条数、销量(L)、累计吨位、金额(сом)、质量(kg)，统计条前标注当前车牌，避免「筛选了但汇总不变」的误读。桌面端与 Web 端共用 `shared/retail-core` 的 `summarizeSelfUseRecords`，Web 端顶部 KPI 卡、表尾合计与涉及站点数同步跟随筛选。
- **壁纸线 SalesWallpaperEngine 0.2.24（独立版本线，同步发布）**：修复地图油库重复标点——内置兜底油库常量仍是旧名「DemoDepotSouth」，且去重只按名称（含南方/北方硬编码别名），9-28 改名后与线上新名无法判定为同一油库，导致CTY-22位置叠加两个标点；现改为按油库编号 D-0X / 坐标 / 名称任一命中即判定同一油库，并重建了 2026-08-21 之后未再构建的前端资源（离线兜底 `business_points.json` 同步带出 code）。
- **测试**：桌面端 vitest 全量通过（含新增墙纸去重与自用油实算用例）；Web 端 vitest 通过；客户端类型检查通过。

### 2026-09-28 (v5.6.2)

- **版本号**：5.6.1 → 5.6.2（patch）。
- **油库名称与编号统一（三系统口径对齐）**：桌面端站点地图、壁纸端、Web 端零售/销售看板中的油库显示统一为 **D-0X STN-61（S-62）/ D-0X STN-63（S-64）/ D-0X STN-65（S-66）**，替换旧称「DemoDepotNorth/DemoDepotSouth/Главная нефтебаза」。涉及 `KgzMap.tsx`、`wallpaperData.ts`、`RetailDashboard.jsx`、`DashboardPage.jsx`，以及后端 `DEPOT_COORDS` / `DEPOTS` / 两份 `business_points.json`。
- **顺带**：`wholesale_service.py` 中按名称 key 取油库区域的写法同步改 key（旧 key 会静默回退到默认区域「REG-06」）。
- **测试**：桌面端 vitest 全量 68 项通过；后端 pytest 受影响 3 个文件 107 通过。

### 2026-09-05 (v5.6.1)

- **版本号**：5.6.0 → 5.6.1（patch）。
- **安全加固（客户端）**：站点地图 tooltip 输出统一 HTML 转义（`GlobeMap.js` escapeHtml），站名等业务数据不再直接拼入 innerHTML，杜绝注入风险。
- **服务端同步修复（无需依赖本次升级，重启后端即生效）**：采购/批发标准货名判定根治——直馏汽油（«Дистиллят легкий из нефти и газового конденсата» 直溜汽油）因 `smart_product_code` 关键词判定顺序（НЕФТ 原油先于 НАФТА/直馏汽油）被误显示为原油；调序修复 + 补源文件写法「直溜汽油」关键词，并更正 35 行历史数据 `product_id` 12→23；明细维护、采购查询现统一显示「直馏汽油Прямогонная нафта」。回归测试 `SmartProductCodeTest` 3 例（全量 345 passed）。
- **随本版入库的后端工作（9/4 WIP 收尾，服务端已在运行）**：api.py 单体瘦身 -699 行拆分为 5 个职责模块（assets/wallpaper/retail_legacy/download/health）+ 路由表快照护栏；Web 端 JWT HttpOnly Cookie 三态开关（`SALES_AUTH_COOKIE_MODE`，默认 off 行为零变化，桌面端走 header 不受影响）；AI 助手路由精度增强 + `assistant-log-digest` 日志巡检命令；nginx CSP-Report-Only 试探头。
- **发布**：安装包 `SalesDesktop Setup 5.6.1.exe`，更新 feed `latest.yml` 指向 5.6.1。

### 2026-09-04（站点油罐-油品固化映射，防错分复发）

- **背景**：同日第二项整治。全历史逐罐审计（2024-2026 selling 分年推断稳定性）显示：50 罐全历史单油品、66 罐 2024 曾装他油而 2025 起稳定（真实换装）、仅 SK21 罐2 2025+ 仍多码。且近期全品类调价已集体越过旧价格桶边界（80#≈69>65、92#≈84>78、95#≈92+>83），未固化罐随时会重演液化气式错分。
- **固化映射**：`export_excel.py` 新增 `STATION_TANK_RESOURCE_MAP_PRIMARY`（前置权威 28 条，含全部液化气罐）+ `STATION_TANK_RESOURCE_MAP`（固化兜底 89 条，换装罐带 `2025-01-01` 生效日）；月报/周报 SQL、入库 Python、日表、快照/KPI `report_resource_key_expr`、库存 `infer_balance_resource_key` 全部改由字典驱动。
- **零回归验证**：selling SQL 新旧对账全表 0 差异；report expr 0 差异；日表函数 0 差异；supply 侧仅 SK6 STN-11 2026-07/08 出现真实修正（80# 罐部分入库曾被价格桶误判为 92#、95# 罐部分记录曾被丢弃），已重算 2026-07/08 月报并重建相关周报。
- **校验护栏**：新增 `scripts/validate_tank_map.py`（未登记罐告警 / 价格漂移告警，退出码可接定时任务）；维护流程写入《客户名及自有站点名维护.md》§10。
- **发布边界**：纯后端改动，**不更新客户端版本号、不重新发布安装包**；`REPORT_DATA_VERSION` 追加 `tank-map-pin` 使缓存失效。

### 2026-09-04（零售报表液化气错分 80# 根治，后端热修）

- **根因**：SK19/22/24（STN-37/STN-43/STN-47）液化气罐（RSK=7）销售/入库记录 `ResourceKey=0`，走价格分桶兜底；2026-07-31 液化气调价至 45.9/47.8 越过 `≤45` 阈值后被错判为 АИ-80（RK=102）。2026-08-02 的 `06c3dd8` 只修了 balance 侧，selling/supply 侧遗漏。
- **单一事实源**：`OilStation/export_excel.py` 新增 `selling_inferred_resource_key_sql()`（selling 侧 SQL CASE）与 `infer_supply_resource_key()`（supply 侧 Python），`generator.py` 改为调用这两处，删除约 20 份散落的推断副本；`_infer_resource_code_daily()` 同步含 SK19/22/24 RSK7、SK29 RSK10、SK28 RSK12、SK4 RSK7 → 108 映射。
- **存量修复**：全部 21 个月（2025-01~2026-09）日销表强制重算（含补生成此前缺失的 2026-07）；`REPORT_DATA_VERSION` 追加 `lpg-rsk-infer-fix-20260904`，41 份周报表全部重建；月度快照按月重建（2026-07 小幅补正，年度快照家族随之刷新）——快照增量逻辑只追加新日不回算旧日，工作簿修复后必须手动重建。
- **对账**：月报/周报/月度与年度快照/每日汇报表/利润报表的 СПБТ 值与 DB 逐升一致；液化气入库仅存在于 2026-02/06/07/08 四个月，其余月份空值经 DB 证实为「确无入库」而非丢数。
- **发布边界**：纯后端改动（`OilStation/export_excel.py`、`endpoints/.../export/service/generator.py`、`workbook.py`），SalesDesktop 客户端零改动，**不更新客户端版本号、不重新发布安装包**。

### 2026-09-02（每日汇报表批发量停填，后端热修）

- **业务口径调整**：每日汇报表日/月/年三个批发量列（C/H/J）停止填值，报表只保留汇率、汇报日期、零售量、零售价以及月/年零售量；批发价 D/E 两列继续取 `wholesale_briefing_prices` 手工维护值（会出现有价无量，属预期）。
- **备注精简**：删除第 2 条「柴油无库存，批发未销售；加油站限量销售…」（固定文本、不随实际库存变化），原第 3 条顺延为第 2 条。
- **代码清理**：移除批发量汇总 `_wholesale_briefing_tons` 及其配套映射与分类常量；`_write_daily_briefing_sheet` 相应精简；回归测试断言改为「C/H/J 必须为空」，并新增备注旧文案防回归断言。
- **缓存失效**：模板缓存版本 `daily_briefing_20260824_serial_v3` → `v4`，已存在的旧格式文件在下次下载时校验失配后自动重生成；按业务确认，8/19–9/2 期间的历史文件不批量重建。
- **发布边界**：纯后端改动（`OilStation/.../export/service/daily_briefing.py` + 测试），SalesDesktop 客户端零改动，**不更新客户端版本号、不重新发布安装包**。

### 2026-09-02（零售快照自动任务假失败修复，后端热修）

- **假失败根治**：`refresh_current_snapshots.py` 每日 08:30 零售/自用油/利润快照任务因 `_find_report_workbook_for_ym()`（`OilStation/endpoints/v1/retail/analysis_report/service/common.py`）只扫描 `exports/` 根目录 `*.xlsx`，找不到 2026-08-05 起改存到 `exports/monthly/{year}/` 的当月日销表工作簿（索引记录在 `.monthly_report_index.json`），输出 `skip workbook snapshots` 并以退出码 1 结束，导致 `daily_maintenance.py --task retail_snapshots` 抛 RuntimeError（所有数据步骤实际均成功，属假失败）。
- **修复**：查找逻辑先读 `.monthly_report_index.json`（取 `path`/`file` 拼 `EXPORT_DIR` 并查存在性），命中即返回，未命中再回退原根目录 glob + 标题月份解析；与 `analytics/service/shared.py` 既有索引解析保持一致。
- **验证**：`daily_maintenance.py --task retail_snapshots` 重跑退出码 0，日志 `ok workbook snapshots 2026-09: 加油站九月份日销表01.09.xlsx; day snapshots=1`，`day_01.json` 及当月月快照（monthly/stations/regions/daily）已生成，`retail_snapshots finished with success`；`py_compile`/`compileall` 与 `git diff --check` 通过。
- **发布边界**：本次只部署后端查找逻辑，不更新 `SalesDesktop` 客户端版本号，也不重新发布主客户端安装包。

### 2026-08-24（每日汇报表序号后端热修，已部署）

- **每日汇报表序号修复**：报表中心「每日汇报表」A 列序号由 Excel 行号公式 `=ROW()-2` 改为静态整数 1..7（95#汽油=1 … 液化气=7），根治序号从 3 开始的显示错误；缓存模板版本升级为 `daily_briefing_20260824_serial_v3`，已生成的旧文件在下次下载时自动校验失配并重生成。纯后端修复（`daily_briefing.py` + 回归断言），不改客户端、不动其他报表。
- **部署与线上验证**：已重启生产服务（提交 `eba5ba4`，进程随计划任务重建），并用 admin 账号从公网入口实际下载 `2026-08-10` 旧缓存日报表验证：序号 A5:A11 = [1..7]、小计公式完好、旧文件自动重生成。客户端零改动，外网客户端无需升级（版本保持 `5.6.0`）。

### 2026-08-21（壁纸端 SalesWallpaperEngine 0.2.21 → 0.2.23）

- **库存面板展开态透明化**：展开面板主体背景改为透明并隐藏滚动条（`scrollbar-width:none` + `::-webkit-scrollbar` 隐藏），滚动行为保留，桌面壁纸透出可见。
- **库存面板排版升级**：面板加宽至 360px、行文字 13px、表头 11px，四列网格列宽重排（1fr/0.75fr/0.5fr/0.55fr）+ 表头不换行；中俄文四列表头（站点/油品/液位/预计天数 与 АЗС/Топливо/Уровень/Дней）均完整显示无裁剪。
- **液位百分比一位小数**：库存行液位百分比由整数改为一位小数显示。
- **发布边界**：独立壁纸线发版，主客户端保持 `5.6.0` 不动；typecheck/build 双绿，Playwright 视觉QA（计算样式断言+像素统计透明性验证+表头无重叠检查）通过。

### 2026-08-20（壁纸端 SalesWallpaperEngine 0.2.13 → 0.2.21）

- **WebView2 运行时收敛**：0.2.13–0.2.14 改为优先并最终仅使用系统已安装的 WebView2 Runtime，忽略不完整的本地 `WebView2Runtime` 目录、移除 .NET 等运行时前置检查，根治误报“缺少环境”；0.2.10–0.2.12 为铺垫（去掉 .NET 检查假阴性、支持 Fixed Version 并排运行时、初始化失败回退系统运行时且错误可见）。
- **库存面板修复**：库存面板过滤修复 + 列表可滚动（0.2.15），滚动行为加固（0.2.16）。
- **库存口径升级（可售天数）**：液位 >60% 的油品行隐藏；<10% 视为罐底油按 0 天展示；10–60% 显示按分油品日销推算的可售天数——后端 `47883ec` 从 `ocw.selling` 取各油品日销计算每罐 `daysRemaining`。
- **WH_MOUSE_LL 全局滚轮钩子**：壁纸位于桌面图标层之下时地图滚轮缩放不再失效。
- **站点名本地化**：地图点位站名随壁纸运行时语言显示中文/俄文。
- **打包烧 key 且持久化**：安装包烧入授权 key，安装及每次自动更新都重新部署到 `%APPDATA%\sales-wallpaper-engine`，根治自动更新后 key 丢失导致“授权未通过”。
- **配套后端性能修复**：分站日销查询增加 per-shop 索引 + 30 分钟 TTL 缓存（`cdd1e83`），壁纸授权接口从 40s+ 响应降回客户端超时线内；新增完整卸载脚本 uninstall.ps1（`8bb6ce0`，覆盖安装目录/appdata/启动快捷方式/HKCU Run 残留）。

### 2026-08-17（批发数据治理：报表全量入库 + 客户主数据合并 + 严格重分类）

- **物流报表全量入库**：2025-01~2026-08 共 40 份外购/外运/外销/代加工报表入库并完成去重；`WHOLESALE_SOURCE_CUTOFF` 切换为 `2025-01-01`，KPI 自 2025-01 起以报表上传行为准（称重行保留但被 cutoff 排除）。报表入库后禁止 `recalculate_wholesale_batch`（会按实体类型重算并摧毁 KPI 分类）。
- **严格五分类收口**：按三大预设权威重分类——外购文件全部 `procurement`；外运站点仅认零售板块权威目录（30 站 + 2 油库，去污染别名）；预设出口/本地客户决定 `export/local_wholesale`。已纠正数百行（`CJSC"CUSTOMER-A"` 211 行 出口→本地、`АЗС S-24` 43 行 本地→外运），另有 48 行三组按用户裁定 出口（CUSTOMER-B/CUSTOMER-C/CUSTOMER-D）。
- **客户主数据全量合并**：`customers` 强匹配碰撞键 172 组（387 条）全部合并，删 215 条冗余；宽松键（去 Ь/Ъ/Й 同音）第二轮再合并 7 组；`CUSTOMER-I Групп`=同一家出口批发公司按用户裁定并入 `CUSTOMER-G Оил Групп`（#14146）并翻 6 行。合并后 export+local 客户 1086（local 1004 / export 82 / unknown 19），业务行分类分布逐字节不变。
- **新维护文档**：新增 `docs/客户名及自有站点名维护.md`，覆盖客户标准名、重复名合并规则（strong_key/宽松键/canonical 铁律）、批发五分类逻辑、自有站点名维护（零售目录权威）、合并执行流程与已知坑，作为后续客户/站点/分类维护的权威手册。

### 2026-08-16 (v5.6.0)

- **装卸车明细 Excel 对齐数据查询导出**：报表中心「明细表 Excel」改名为「装卸车明细」，表内格式完全对齐数据查询导出——中俄文双语两行（油品/收发货单位）、列宽自适应、名称标准化（Example全称/外运站点完整名/客户标准名）、冻结首行+自动筛选；产出 4 张表（装卸车明细 + 批发汇总表 + 代加工汇总表 + 外运汇总表），下载文件名同步为 `装卸车明细_{年月}.xlsx`。
- **外运归口以实体为准**：收/发货方实体为零售板块站点或站/库性质自有油库时一律按外运处理（明细显示 АЗС 前缀、汇总归外运表），不受分类字段误标影响；油库显示目录名（S-64）不带 АЗС 前缀；外运汇总表按加油站编号升序排列，无编号油库排最后。
- **entity_aliases 站点别名冲突根治**：9 个站点名曾被误登记为客户别名导致导入分类判批发，已删客户别名、补登站点别名；`lookup_entity` 增加零售板块 catalog 精确匹配兜底（拉丁/西里尔同形归一），新增站点进 catalog 后自动识别为外运，无需别名登记。
- **AI 助手外运站点知识问答**：支持「外运站点有哪些/怎么识别/装卸车明细口径」等问法，30 个零售站点 + 2 座自有油库清单实时取自零售板块 catalog。
- **AI 助手批发问答分类增强**：批发/外运/代加工/采购不混合回答；装车/卸车维度分火车/汽车；每种问答分油品明细 + 合计（批发含金额）。
- **版本号**：5.5.2 → 5.6.0。

### 2026-08-16 (v5.5.2)

- **数据录入发货单位下拉乱码修复**：`TrainEntryPage` 手工录入/明细维护的发货单位下拉 7 个选项 value 与代加工分类判断值为 CP1251 双重编码乱码，纯俄文代加工发货方（CUSTOMER-H/CUSTOMER-F/CUSTOMER-E/CUSTOMER-G/CUSTOMER-J）提交入库仍为乱码、下拉回显匹配失败；已全部还原为正确 UTF-8（Example/油气/代加工公司），「匹配状态」列标题乱码同步修复。
- **BilingualName 判定加测试护栏**：showRaw 判定提取为纯函数 `shouldShowRaw`，新增单测覆盖中文主名相同/俄文词重叠≥50%/不同实体补显等场景；拆分逻辑修复中文主行尾部残留分隔符问题。
- **版本链文档同步**：AGENTS.md 基线 → 5.5.1，README 补 5.4.1/5.4.2/5.5.0/5.5.1 记录，package-lock.json 版本对齐。
- **版本号**：5.5.1 → 5.5.2（提交 `513258a`，tag `v5.5.2`）。

### 2026-08-16 (v5.5.1)

- **称重审核纯俄文原始名重复显示根治**：`BilingualName` showRaw 判定新增俄文词重叠检测——原始名为纯俄文写法（如 `CJSC''ExampleCo Petroleum Company ExampleCo''`）时，提取俄文词（去掉 CJSC/НПЗ 等通用法律词）与标准名俄文词重合 ≥50% 视为同一实体不同写法，不再补显第三行原始名，根治 5.4.2 中文比较对纯俄文原始名失效导致的重复显示。
- **修复权限维护重复 key**：`OrganizationPermissions.tsx` 中英文 moduleNames 重复 key `wholesale_entry`（TS1117）去重，typecheck 恢复通过。
- **版本号**：5.5.0 → 5.5.1（提交 `36115a9`，tag `v5.5.1`）。

### 2026-08-15 (v5.5.0)

- **采购查询/数据录入明细维护双语显示统一**：采购查询油品/发货/收货单位列与数据录入明细维护统一走 `BilingualName` 组件（中文在上、俄文在下两行）；采购查询补充原始名核对（senderRawName/entityRawName），列宽微调（发货 220/收货 240/油品 200）。
- **版本号**：5.4.2 → 5.5.0（提交 `0568a36`，tag `v5.5.0`）。

### 2026-08-15 (v5.4.2)

- **BilingualName 重复显示修复（根治版）**：5.4.1 用「中文主行相等」判定，但手录名中文主行带尾部分隔符（`Example石油公司 /`）与标准名主行不完全相等导致判定失效；改为比较双方提取的中文文本（正则 `[\u4e00-\u9fff]+`），同一实体不同写法（分隔符/引号/俄文拼写差异）一律不再补显灰色小字原始名。
- **版本号**：5.4.1 → 5.4.2（提交 `a3bd703`，tag `v5.4.2`）。

### 2026-08-15 (v5.4.1)

- **BilingualName 重复显示修复（首版）**：批发查询/称重记录中俄双语名称不再重复显示——当原始名与标准名拆分后的中文主名相同（同一实体不同写法）时，不再补显灰色小字原始名，避免「Example石油公司」在一个单元格出现两次。
- **版本号**：5.4.0 → 5.4.1（提交 `3b7ca26`，tag `v5.4.1`）。

### 2026-08-15 (v5.4.0)

- **中俄双语名称统一两行显示**：新增通用组件 `BilingualName`（中文在上、俄文在下），采购查询/批发查询/过磅记录三页统一复用，删除采购页重复拆分逻辑；解决STN-63等新增中文名未两行显示、与「Example」标准不一致的问题。
- **列宽自适应 + 居中**：批发查询与过磅记录移除 `table-layout:fixed`，列宽改像素，俄语全称不再截断；`BilingualName` 俄文行加 `word-break: break-word`，超长串可换行；双语名恢复居中，与表格其他列一致。
- **数据录入回车焦点修复**：`ExcelTable` 按行 id 聚焦、新行追加到表格底部，回车后自动聚焦新行（Excel 习惯）。
- **采购查询修复**：收货方标准名解析、双语换行、表头固定（sticky）。
- **后端修复**：① 明细保存 500（DictCursor 问题）；② 入参清洗层 `clean_str` 接入 `repair_mojibake`，自动还原外部客户端提交中文被双重编码产生的乱码（根治「Example」等中文变乱码）。
- **版本号**：5.3.0 → 5.4.0。

### 2026-08-15 (v5.3.0)

- **权限矩阵补全**：利润核算、管理中心、批发价格页签等硬编码 admin 菜单纳入权限矩阵，新增 profit 模块 4 个权限码（view/cost_update/purchase_price_update/wholesale_price_update）和 management 模块 2 个权限码（view/update），组织权限模块列表补齐 profit/management/wholesale_entry/knowledge/audit_logs/system_health；批发价格维护放开给操作员/销售专员（profit:wholesale_price_update），可维护批发大客户价/散户价；利润成本维护页按角色权限显示可编辑页签，仅授权角色可见批发价格页签。
- **修复**：权限矩阵显示英文字段问题，scopeColumns 改用 moduleLabel() 显示翻译；actionLabels 补充 4 个权限码翻译（cost_update/purchase_price_update/wholesale_price_update/reindex）。
- **版本号**：5.2.0 → 5.3.0。

### 2026-08-15 (v5.2.0)

- **每日汇报表批发量填充**：日/月/年批发量列由空白改为按 `wholesale_detail_records` 实时汇总，口径与批发总览/明细一致（仅 `local_wholesale`/`export_wholesale`/`unknown`，外运/代加工/采购/内部用油不计入），来源边界与 `wholesale_source_policy.py` 一致（`2026-06-01` 前称重生成、此日起上传/手工明细）；油品按 `WHOLESALE_PRODUCT_TO_ROW` 归并到模板行 5-11。
- **每日汇报表批发价改维护值**：批发价（大客户/散户）由模板固定价格改为数据库 `wholesale_briefing_prices` 维护值，未维护的行留空；客户端"利润核算成本维护"新增"批发价格"页签（独立于年月选择器），接口 `GET/PUT /api/v2/profit/wholesale-briefing-prices`，仅管理员，不参与利润计算。
- **发布状态**：已通过 `git diff --check`、后端 `compileall`/298 个 Python 单测（含每日汇报表批发列断言更新）、客户端 typecheck/build；已升版本 `5.2.0`；尚未提交/打包部署，公网 `latest.yml` 仍指向 `5.1.0`。

### 2026-08-15 (v5.1.1)

- **数据录入/合同页下拉权限修复**：火车入库数据录入页油品/收货单位下拉与合同页油品/客户下拉统一改调 `/api/v2/wholesale/details/filter-options`；该接口自 2026-08-15 起仅需登录（`@jwt_required()`），不再要求 `wholesale:view`/`aliases:view`，所有账户（含将来新增角色）默认可见下拉内容，写操作权限不受影响。
- **客户类型字段**：filter-options 的 `companies` 项自 2026-08-15 起携带 `customerType`（`local_wholesale`/`export_wholesale`/`unknown`，非客户实体为空串），数据录入页按此自动识别批发分类。
- **发布状态**：已通过 `git diff --check`、后端 `compileall`/298 个 Python 单测、客户端 typecheck/build；已提交（`8597440`）；已升版本 `5.1.1`；尚未打包部署，公网 `latest.yml` 仍指向 `5.1.0`。

### 2026-08-14 (v5.1.0)

- **批发明细查询引擎重构**：明细查询/汇总/导出统一按业务日期口径，`2026-06-01` 起以上传或手工明细为业务来源，称重生成明细仅取 `2026-05-31` 及以前历史（`wholesale_source_policy.py` 新增 `WHOLESALE_WEIGHING_END_DATE` 与 `clamp_weighing_detail_range`），自动生成与查询导出同口径，不再跨源混用。
- **新增筛选选项接口**：批发查询与称重列表的产品、公司、车号等下拉开项改由后端接口提供（`/api/v2/wholesale/details/filter-options`、`/api/v2/weighing/filter-options`），客户端与 Web 同步接入。
- **新增批发明细双语导出**：`/api/v2/wholesale/details/export` 生成 Excel，油品、公司等名称按中俄文双行单元格展示，支持按公司汇总表，导出文件名随数据源区分。
- **客户/单位标准名称解析**：发货单位、收货单位、油品按客户维护与别名优先显示标准名，中俄文混合名称拆为双语两行；火车入库、批发查询、称重列表同步展示，录入发货单位下拉按主数据维护。
- **客户端下载失败结构化错误**：下载返回白名单拦截、HTTP 状态、取消保存等结构化错误信息，不再静默返回 false。
- **发布状态**：已通过 `git diff --check`、后端 `compileall`/298 个 Python 单测、客户端 typecheck/46 个 Vitest/build/`electron:build`、Web 9 个 Vitest/build；已提交（`b9d98aa`）；已生成并同步 `SalesDesktop Setup 5.1.0.exe`、blockmap 和 `latest.yml`，已部署 Web/后端并重启生产任务；公网 `latest.yml` 指向 `5.1.0`，安装包 HEAD 200/130359951，blockmap HEAD 200/136107，Range 返回 206。

### 2026-08-13 (v5.0.0)

- **批发板块大版本发布**：客户端直接升为 `5.0.0`，本轮把批发总览、批发查询、采购查询、数据录入、基础资料维护和 AI 助手统一到同一套批发业务规则。
- **批发/采购/外运/代加工口径统一**：发货方为Example或油气公司、收货方为客户时按批发并继续区分本地/出口；发货方为客户、收货方为Example或油气公司时按采购；发货方和收货方均为客户时按代加工；外运必须来自零售板块已保存的自有加油站/油库信息。
- **6 月 1 日数据源切换**：`2026-06-01` 前优先使用自动称重数据，但当前缺液化气罐区自动称重源；`2026-06-01` 起使用上传或手工录入的批发明细表，AI 助手日/周/月/年查询同步提示年数据风险，不用 LPG 产品量推算罐区总量。
- **客户端体验补齐**：数据录入拆分上传明细维护和手工录入，表格列宽/居中/满屏区域按明细维护收口；基础资料维护拆分客户归类、外运实体别名和标准名称维护；批发总览 KPI 按客户端与 Web 统一布局。
- **报表与零售同步**：保存完整零售日报时同步生成单日领导版日报；Web 零售动态横向滚动、零售日报停业站说明、批发板块 KPI 和查询筛选同步修正。
- **发布边界**：主客户端/Web/后端按 `5.0.0` 发布；独立壁纸端无代码改动，继续保持 `SalesWallpaperEngine 0.2.5`，不重新打包壁纸端。
- **发布状态**：已通过 `git diff --check`、后端 `compileall`、280 个 Python 单测、AI 助手覆盖 91/91、客户端 typecheck/46 个 Vitest/build/`electron:build`、Web 9 个 Vitest/build、`preflight-release.ps1`；已生成并同步 `SalesDesktop Setup 5.0.0.exe`、blockmap 和 `latest.yml`，已部署 Web/后端并重启生产任务；公网 `latest.yml` 指向 `5.0.0`，安装包 HEAD 200/130361269，blockmap HEAD 200/136148，Range 返回 206；壁纸 `latest.json` 保持 `0.2.5`。

### 2026-08-13 (v4.3.0)

- **批发明细录入重构**：火车入库/数据录入页改为复用 ExcelTable 录入体系，支持回车换行、批量粘贴、草稿和统一保存；新增行保存时按发货/收货单位自动识别外运、采购或待确认分类，直接写入批发明细，不再要求先建负 id 草稿行。
- **批量导入与手动录入**：批发明细录入支持选择 xlsx 文件按单表导入称重过磅明细（服务端 `import_wholesale_single_sheet`），并支持在表格中新增/编辑业务日期、油品、客户单位、分类、重量kg、车号、发货单位、磅单号、备注；分类下拉可选本地批发/出口批发/外运/代加工/采购/待识别，录入页不再使用审核状态。
- **装卸与运输口径修正**：批发总览汽车/火车装车仅统计本地批发、出口批发和外运，汽车/火车卸车仅统计采购；代加工先按收发双方规则识别，再仅按明细表备注列是否出现火车标记判断汽车/火车。
- **权限细化**：新增 `wholesale_entry` 模块与 `wholesale_entry:create`、`wholesale_entry:update` 按钮权限，新增/导入和已有上传明细编辑分别可控；称重自动明细只读，批发查询仅查询展示。
- **发布边界**：主客户端/Web/后端按 `4.3.0` 发布并已部署；独立壁纸端本次作为 `SalesWallpaperEngine 0.2.5` 同步发布，继续独立打包与自动更新，不并入主客户端安装包（`0.2.5` 含 `RuntimeConfig.cs` 语言回退修复 `LanguageMode == "auto" ? Language : LanguageMode`，壁纸端随运行时语言切换地图标注、油库类型与站点状态文案）。
- **发布状态**：已通过 `git diff --check`、后端 `compileall`、客户端 typecheck/build/`electron:build`、壁纸 `build.ps1 -Version 0.2.5 -IncludeKeyPath`；已提交（`cea63d9`，合并 `2282d8f` 批发明细录入与壁纸 `0.2.5` 修复）、已打包、已同步 `/download`、已部署；公网 `latest.yml` 指向 `4.3.0`，壁纸 `latest.json` 指向 `0.2.5`。
- **未打包后续修正**：零售日报生成完整月报时同步保存最新完整日单日领导版；批发业务规则全量覆盖历史称重和上传/手工明细，`unknown` 按业务取数口径降至少量记录，剩余主要为缺发货方历史记录；本项仅本地修复与服务重启验证，未重新打包安装包。

### 2026-08-12 (v4.2.0)

- **地图油库与加油站标注本地化**：新增 `shared/map-labels` 共享模块，统一收口油库类型、站点营业状态与油库/站点名称的中俄吉三语文案；客户端随 i18n 切换、Web 固定中文、壁纸随运行时语言（C# `CultureInfo.CurrentUICulture`）自动切换，三端口径一致。
- **油库类型与站点状态标签收口**：油库类型中文统一为在营/停用/在建，站点营业状态中文统一为在营/停业/装修，俄文统一为 `Работает`/`Остановлен`/`Строится`；桌面客户端吉尔吉斯地图与壁纸地图的点位名称、油库类型与状态标签随语言切换，Web 零售总览与主页地图固定使用中文标签。
- **发布边界**：主客户端/Web/后端按 `4.2.0` 发布并已部署；独立壁纸端单独发布 `SalesWallpaperEngine 0.2.4`，继续独立打包与自动更新，不并入主客户端安装包。
- **发布状态**：已通过 `git diff --check`、后端 `compileall`、客户端 typecheck/45 个 Vitest/build/electron:build、Web 构建与 `preflight-release.ps1`、CodeGraph 同步；已提交、已打包、已同步 `/download`、已部署；公网 `latest.yml` 指向 `4.2.0`，壁纸 `latest.json` 指向 `0.2.4`。

### 2026-08-12 (v4.1.2)

- **4.1.2 客户归类维护修复**：客户端“基础资料维护”新增独立的“批发客户归类”页签，待处理名称可直接维护为批发客户，客户维护只负责 `本地批发 / 出口批发 / 待识别批发`，不再与外运、油库、站点等实体别名混在同一入口；Web 管理端基础资料同步去掉“混合”维护选项，历史 `mixed` 仅按“待识别批发”展示。
- **批发归类口径收口**：称重数据和上传批发报表只能证明属于批发侧业务，不能直接判断本地或出口；本地/出口必须来自 `customers` 客户维护或 `entity_aliases` 的批发客户别名。未维护客户仍计入批发数量，但不分摊到本地/出口，也不提前计算确认金额，统一显示为“待识别批发”。
- **客户维护即时生效**：新增 `/api/v2/aliases/customers` 查询/保存接口；保存客户归类时同步写入客户自身别名并触发上传报表与称重批发记录重算。批发明细自动识别严格按收发双方身份：Example/油气发给客户为本地/出口批发，客户发给Example/油气或自营油库为采购，客户发给客户为代加工，Example/油气发给零售板块已维护的自有加油站/自营油库为外运；外部客户名称里带加油站/油库不自动算外运。
- **客户端单实例保护与品牌副标题**：桌面客户端启动增加单实例锁，重复打开时聚焦已有窗口，避免同一电脑同时运行多个客户端；Web 零售页副标题改为公司简称 `CJSC "ЧПК" «ExampleCo»`，旧 `SIBNEFTEKART` 仅保留在历史归档文件。
- **三端接口契约收口**：新增 `shared/api-contracts.js` / `.d.ts`，把 Web、客户端和壁纸端共用的认证、零售、报表、利润、系统健康、助手、地图和壁纸本机接口路径集中维护；新增报表目录 `ReportCatalog`，客户端下载和 Web 下载不再各自拼接同义路径。
- **零售与助手共享工具**：新增 `shared/retail-core.js` 和 `shared/assistant-ui.js`，三端复用月份选择、吨位/金额读取、KPI 数值格式、站名中俄拆分、排行排序、助手表格合并显示、会话 ID、清屏指令和页面上下文构造等纯函数，减少页面内重复实现。
- **Web 加载速度治理**：Web 主路由改为 `React.lazy + Suspense`，零售、管理、报表、知识库等页面按访问拆分加载；Vite 增加 `react` 手动分包与共享目录别名，首屏不再一次性打进所有页面代码。
- **系统健康兼容统一**：`/api/v2/system/health` 在保留客户端 v2 结构的同时补齐 Web 管理健康页需要的 `checks/cacheRefresh/latestExchange/latestMarket/security/snapshots/logs/tasks` 兼容字段；新增 v2 自动任务读取与执行入口，Web 旧管理健康接口统一走同一组后端数据。
- **壁纸端边界整理**：独立 `SalesWallpaperEngine` 只把本机 loopback 的 `/api/wallpaper/*` 常量化，继续代理后端 `/api/wallpaper/map`，不混入主客户端版本线；本轮不变更壁纸数据口径和公开更新包。
- **发布状态**：本轮作为主客户端 `4.1.2` 发布；壁纸端无业务代码变更，独立公开版本仍为 `SalesWallpaperEngine 0.2.3`。已通过后端编译和 245 个 Python 单测、客户端 typecheck/45 个 Vitest/build/electron:build、Web 9 个 Vitest/build、`preflight-release.ps1`、CodeGraph 同步和线上 latest/installer/blockmap/Range 校验。

### 2026-08-11 (v4.1.0)

- **AI 助手前台展示收敛**：客户端和 Web 端助手不再展示模型、工具数量、7 天质量、负反馈、计划、自检、来源、快照、报表号和知识引用等调试标签；后台仍保留质量、来源和审计字段用于反馈与排查。
- **AI 助手密度口径调整**：`当前密度/密度` 默认返回当前月全站（所有站点汇总）各油品平均密度；只有包含站号、中文站名、俄文站名或站点别名时才返回对应单站密度；明确问当月/当年时按对应期间聚合。答案只展示日期、油品和全站/单站平均密度，不再显示综合加权、销量、质量、吨位或来源，也不按“各站点”逐站展开。
- **AI 助手密度表格显示优化**：密度问答同一日期对应多行油品时，日期列按 `rowSpan` 真正合并显示，客户端和 Web 端不再只在第一行显示日期空白占位。
- **AI 助手停业站点口径修正**：`当前停业站点` 和单站营业状态问答中的停业开始时间按零售日快照倒推，取该站最后一次有销售数据的下一天；只有找不到历史销售日时才回退站点状态维护表时间。
- **AI 助手发送快捷键调整**：客户端和 Web 端助手输入框改为 `Enter` 发送，`Ctrl+Enter` 换行。
- **AI 助手响应速度优化**：客户端和 Web 端默认使用后端规则答案，不再等待 OpenRouter 润色；`station_status`、`density_summary`、`map_location`、`system_health_summary` 等确定性问答即使收到 `useLlm=true` 也走规则快路径，避免“停业站点”等固定答案被模型超时拖慢。
- **AI 助手中式时间问法补齐**：`当月销量/昨日销量/当日销量/上上个月销量/当前年销量` 等常见问法直接由规则层解析，不再回退“最近 7 天”；单问 `昨日销量/今日销量/当日销量` 走零售汇总，只有明确包含“趋势/走势/每日/图”等词时才走趋势工具。
- **AI 助手跨模块口语问法补齐**：新增 `销售前十名`、`按站销售额`、`发电机用油`、`内部用油费用`、`调拨审批到哪了`、`接口慢不慢`、`缓存有没有问题`、`日报任务跑了吗`、`口径文档在哪`、`利润算法怎么写的`、`库存液位` 等常见问法的规则识别，继续复用已有只读工具，不新增写入能力。
- **Web 助手快捷问答跳首页修复**：Web 端按钮统一阻止默认跳转；`/api/v2/auth/status` 在 Session Cookie 恢复登录时同步返回 `accessToken/refreshToken`，避免页面已登录但助手查询 401 后跳登录页再回首页。
- **Web 零售自用油页面**：零售板块新增 `/retail/self-use` 自用油页面，复用原系统报表 24 的 `/api/retail/self-use` 日期区间接口，支持日期范围查询、车牌搜索、记录/油量/吨位/金额/站点汇总、明细排序和 Excel 导出。
- **每日汇报表新版模板**：每日汇报表更新为桌面 `ProductTeam销售日报表模板.xlsx` 的 A:K 版式；日销售区显示批发量、固定批发价、零售量和零售价，批发价沿用模板数值，汇率固定 `87.50`，日零售价按日销售金额 ÷ 日销售吨位 ÷ 87.50 折算为美元/吨；月/年区继续填零售吨位。
- **每日汇报表版式收口**：每日汇报表下载入口会校验模板版本并重生成旧缓存文件；C:K 列在 Excel 中显示宽度统一为 `16`，第 1、2 行有效内容区按一个整体只保留外框线，D9/E9 字体大小与上下单元格一致。
- **停业站报表展示口径**：涉及加油站名称的中文管理报表统一不直接展示 11、12、21 停业站明细；零售日报/区间报表、利润月度文件和自用油导出在 Excel 中隐藏对应明细行并保留底部备注，分析报告按“全部在营站点”展示站点明细。汇总计算不因隐藏展示改动原始统计口径。
- **文档与图谱同步**：本轮同步更新 README、接口调用、报表口径、关键调用链、验数记录、发布台账、验收报告和代码知识图谱说明；CodeGraph 重新确认新增前端页面、组件和后端报表逻辑已纳入索引。
- **发布边界**：主客户端/Web/后端按 4.1.0 发布并已部署；独立壁纸包无代码变更，继续保持 `SalesWallpaperEngine 0.2.3`。

### 2026-08-10 (v4.0.6)

- **每日汇报表下载**：客户端报表中心新增“每日汇报表”，按桌面模板 `ProductTeam销售日报表YYYY.MM.DD.xlsx` 生成；统一走 `/api/export/daily-briefing/<YYYY-MM-DD>` 与 `/download`，日销售取汇报日期前一天，月/年累计截至汇报日期前一日，当前只填加油站零售吨位列；柴油、-10 柴油、-35 柴油等统一归入“柴油”口径，批发列暂不填充。
- **每日汇报表吨位口径修正**：吨位保留 3 位并与零售快照/AI 助手同源；日累计读单日快照，月累计优先读同期间月快照，年累计优先读年度资源快照，禁止按油品或按天先保留 2 位再合计。
- **零售日报命名调整**：整月累计日销表下载文件名为 `加油站{中文月份}日销表{日.月}.xlsx`，例如 `加油站八月份日销表13.08.xlsx`；同步生成的单日零售日报文件名为 `加油站{中文月份}零售日报{月.日}.xlsx`，例如 `加油站八月份零售日报08.13.xlsx`；内部仍保存到 `exports/monthly/{year}/`，索引记录相对路径，避免跨年同月文件互相覆盖。
- **报表中心与 AI 助手补齐**：客户端下载每日汇报表、零售日报时统一使用服务端返回文件名；AI 助手补充每日汇报表下载入口和报表命名口径问答。
- **发布边界**：主客户端/Web/后端按 4.0.6 发布；独立壁纸包仍保持 `SalesWallpaperEngine 0.2.3`。

### 2026-08-10 (v4.0.5)

- **AI 助手数据问答升级**：按“只能回答问题、查询文档、基于已有快照或只读记录回答数据”的边界收紧，零售类销售问答后端携带快照来源、来源类型、更新时间、截止日和质量字段，供审计、反馈和排查使用。
- **敏感信息拦截加固**：账号、密码、密钥、Token、连接串、证书路径、服务器登录方式、内部入口和敏感配置问题会在入口层返回拒答，不进入知识库、业务查询或模型润色。
- **真实业务问法验收**：`assistant_business_eval.json` 扩展到 100 条领导、财务和运营真实问法，覆盖日期、时间、分类、排行、跨业务合计和docs问答组合。
- **数据来源契约验收**：典型 AI 答案新增 `dataSource/sourceKind/snapshotNeed/snapshotPolicy` 断言，防止把快照问题误改成实时查询，或把只读记录类问题误标为快照。
- **发布边界**：主客户端/Web/后端按 4.0.5 发布；独立壁纸包仍保持 `SalesWallpaperEngine 0.2.3`。

### 2026-08-09 (v4.0.4)

- **API 与权限口径统一**：Web、客户端和维护脚本统一使用 `/api/v2/auth/*` 与 `/api/v2/assistant/*`；旧 `/api/auth/*`、旧 `/api/data-assistant/query` 和旧用户权限接口只返回 410 废弃提示，组织权限统一走 `/api/v2/organization/*`。
- **认证状态修复**：`/api/v2/auth/status` 兼容字典游标统计用户数，避免统一接口后登录态检查出现 500。
- **权限边界修复**：利润核算页面、数据接口和 AI 助手 `profit_summary` 统一为管理员专属，普通零售查看权限不能绕过。
- **发布边界**：这是 4.0.3 已发布后的补丁线；主客户端/Web/后端按 4.0.4 发布，独立壁纸包仍保持 `SalesWallpaperEngine 0.2.3`。

### 2026-08-09 (v4.0.3 / SalesWallpaperEngine 0.2.3)

- **客户端版本收口**：主客户端升级为 `SalesDesktop 4.0.3`，承接 2026-08-08 利润核算、KPI 同比环比、长表格满屏滚动、系统健康利润快照检查和数据可视化驾驶舱比较值等全部客户端改动。
- **利润核算发布版**：月度/年度利润核算、成本维护、快照刷新和报表中心下载作为正式发布功能；利润数据仍统一复用 `/api/export/profit/*` 与 `/api/export/profit-year/*`，避免重复接口。
- **AI 助手问答补齐**：助手新增利润核算只读工具和项目覆盖用例，可回答月度/年度利润、成本维护、购油单价、利润快照、报表中心利润下载、系统健康利润摘要和壁纸端 09:00 后补刷策略。
- **AI 助手中式问法增强**：补齐“7月赚了没”“今年亏不亏”“进油价咋填”“哪个站出油最多”“自用油今年用了多少”“系统有没有毛病”等口语表达，并继续覆盖“这月进了多少货”“火车这月进了多少吨”“损耗有没有数据”“最近谁动了数据”等全项目中式问法；项目级覆盖门禁扩展到 90 项。
- **AI 助手只读边界加固**：自检补齐“把购油价改成100”“把汇率设置为7.8”等维护数据修改类问法的动作拒绝，保留“进油价咋填”“利润表能下不”等只读查询不被误伤。
- **壁纸端独立发布**：`SalesWallpaperEngine` 升级为 `0.2.3`，继续独立打包和独立更新；本次包含错过 09:00 刷新窗口后的自动补刷、恢复/解锁刷新信号和库存液位术语统一。
- **打包部署边界**：主客户端安装包、自动更新 feed 与壁纸端 zip/setup/latest.json 分开生成和部署；壁纸端不并入 `SalesDesktop` 主安装包。

### 2026-08-08 (利润核算与壁纸刷新收口)

- **利润核算闭环**：新增月度/年度利润核算数据、下载和快照接口，客户端零售菜单、Web 零售页和报表中心均复用 `/api/export/profit/*` 与 `/api/export/profit-year/*`，不再保留重复同义接口。
- **月度维护数据**：利润核算成本维护支持按月保存 M/N/O/P/Q 成本项和购油单价；2026 年 1-7 月购油价按已确认月度文件固化，维护保存后自动清理对应月度与年度利润快照。
- **利润页展示优化**：月度/年度利润页各 8 个 KPI 按两排四列展示，第一排固定为累计销售额、累计销量、柴油销售额、柴油销量；销售额类显示人民币副值，除薪酬和水电网警外同步显示环比/同比；年度表补齐吨位、汇率和柴油销售字段。
- **接口与加载治理**：利润数据接口默认读取 `profit_report_snapshots`，`refresh=1` 才强制重算；每日 `08:30` 零售快照任务同步刷新当前月利润快照和年度利润总表快照，快速切换年月时使用请求序号保护，旧请求不会覆盖当前页面；客户端与 Web 系统健康均纳入利润快照有效性检查。
- **利润 KPI 微调**：Web 与客户端零售利润页 KPI 恢复左侧数据上下显示，人民币/吨位副值回到主数据下方，右侧仅展示放大的环比/同比；客户端移除底部说明区，KPI 及以上区域固定，站点/年度明细在下方独立滚动并占满剩余页面。
- **客户端列表页满屏显示**：自用油、零售报表、批发查询、过磅列表、损耗、合同和审计日志等查数页面复用利润页的固定上方区域与下方独立滚动表格布局，减少底部空白和外层页面滚动。
- **客户端维护页满屏与健康页补齐**：汇率、物资调拨四个分页面、权限矩阵、利润核算成本维护和系统健康页统一改为上方筛选/KPI/Tab 固定、下方内容区铺满后独立滚动；系统健康页在提醒中心汇总利润快照状态，缓存页按原表格列式展示利润月度/年度快照；购油单价维护在同一油品全站同价时自动合并为“全部站点”一行，只有站点差异时才展开站点明细。
- **经营 KPI 同比环比复用**：客户端公共 KPI 组件支持右侧同比/环比比较项；利润核算页保留放大左右布局，利润核算之外的页面默认使用原 KPI 右侧紧凑布局，不改变卡片尺寸。零售总览、月度、区域、站点、油品等已有可靠比较数据的销售额/销量 KPI 同步展示同比/环比；批发总览和数据可视化驾驶舱的金额、销量、吨数类 KPI 复用接口 `compare` 数据。年度总览环比按“本年累计 vs 少一个月累计”、同比按“上一年同期”计算，系统健康、汇率缺口、物资行数等非经营同比指标不硬造比较值。
- **壁纸每日刷新补刷**：如果电脑在 09:00 前后睡眠、锁屏、断网或 VPN 未恢复，壁纸端会在当天 09:00 后检测是否已成功刷新，失败按 5 分钟节流自动重试；恢复、解锁、控制台重连或远程重连时主动触发刷新检查。
- **库存液位术语统一**：Web、客户端、壁纸和文档统一使用“库存液位/液位百分比”。
- **发布状态**：本地已生成 `SalesWallpaperEngine 0.2.2` zip 与 Setup，并更新本地 `SalesDesktop/download/wallpaper-engine/latest.json`；公网同步需单独执行部署。本次主客户端仍保持 `SalesDesktop 4.0.2`。

### 2026-08-05 (后端快照热修)

- **零售快照新口径**：月度、单日快照必须携带 `stationResources`（按站点按油品销量/金额/质量明细）；带该字段的快照不再回读日销表工作簿修复质量字段（修复门 `retail_repair_payload_mass_from_report`），避免旧工作簿覆盖新口径。
- **日销表文件名规则调整**：零售月度日销表对外下载名为 `加油站{month_cn}日销表{DD.MM}.xlsx`（如 `加油站八月份日销表04.08.xlsx`）；同步保存的单日零售日报名为 `加油站{month_cn}零售日报{MM.DD}.xlsx`（如 `加油站八月份零售日报08.04.xlsx`）；内部保存到 `exports/monthly/{year}/`，`.monthly_report_index.json` 记录相对路径，避免跨年同月互相覆盖。
- **33 个月全量重建**：按新口径从 2023-12 至 2026-08 重建全部 33 个月快照（`backfill_retail_mass_snapshots.py --start 2023-12 --end 2026-08 --force`），年度派生快照 2023-2026 同步重建；全部月份 `needs_refresh=False`，快照内一致性及快照 vs DB 验数通过（仅 2025-08 2 处 0.02/0.05 L 浮点边界尾差，容差内）。
- **发布边界**：本次只部署后端快照与报表导出逻辑，不更新 `SalesDesktop` 客户端版本号，也不重新发布主客户端安装包。

### 2026-08-04 (v4.0.2)

- **驾驶舱冷缓存超时修复**：零售后端重启后首次打开数据可视化驾驶舱不再超时。生产入口（`Sales/run_production.py`）启动预热扩展为当年 1 月至当前月全部 `/api/monthly/{ym}` + 当月站点/区域/日趋势接口，并新增 `/api/kpi/yearly`，历史月份快照缺 `mass` 字段时在启动后台即修复/重建，不再等用户首次请求串行触发 30–90s/月的慢查询。
- **客户端超时提高**：客户端 API 请求超时由 30 秒提高到 120 秒，冷缓存重建等慢请求不再被客户端提前中断。
- **验证**：`py_compile` 通过；`npx tsc --noEmit` 通过；`npx vite build` 通过（3904 modules, 21.56s）；`/api/kpi/yearly` 的 `inventory=0` 参数已验证有效。
- **发布状态**：源码已提交（`5acfafd` + `e5f7340`），安装包已生成并同步 `/download`（`SalesDesktop Setup 4.0.2.exe` + blockmap + `latest.yml`），**已部署**；`latest.yml` 已指向 4.0.2。生产已重启使预热生效，重启后驾驶舱首屏复测 123/136/71ms。

### 2026-08-03 (v4.0.1 后端热修)

- **8 月日销表价格列修复**：7/30 调价后，零售月度 Excel 日分表价格列优先使用数据库实际价（`daily_price_cache` 按日聚合 `fuelbalance.CurrentPrice` 与 `balance.EndPrice`，后者覆盖前者、同一天取最新班次），官方调价表（7/19 硬编码表）只通过 `setdefault` 补缺失的 `(站点, 油品)` 键，不再覆盖数据库新价。
- **验证**：站 19/22/24 СПБТ 现金单价 = 45.9 / 47.8 / 47.8，与 ocw DB 8/1 `balance.EndPrice` 一致；`py_compile` 通过；`python -m unittest discover -s Sales/tests` 165 项全通过。
- **发布边界**：本次只部署后端报表导出逻辑，不更新 `SalesDesktop` 客户端版本号，也不重新发布主客户端安装包。

### 2026-08-01 (v4.0.1)

- **站点详情稳定性**：修复 `/api/station/YYYY-MM/<shop>` 在补充人民币平均汇率字段时因内部导入缺失导致的 500，已覆盖 Web 与客户端。
- **区域每日趋势**：修复 2026-07 daily 快照因单个质量边界值被误判过期而触发慢查询的问题；Web 区域页在日趋势失败时不再阻断区域/站点数据加载。
- **客户端零售 KPI**：总览、月度、油品等销售额 KPI 增加平均 CNY/KGS 兜底，人民币副值与 Web/壁纸端口径一致。
- **预警显示**：客户端库存预警隐藏 11、12、21 停业站，其他站点显示站号 + 中俄文站名；Web 库存预警支持纵向滚动。
- **壁纸安装授权**：SalesWallpaperEngine 增加 `wallpaper-key.protected.json` 保护型打包密钥支持，领导机安装包可避免明文 token 直接随安装器分发；该能力不授予主系统登录权限，只用于壁纸专用接口。
- **发布状态**：待打包部署；客户端补丁版本为 `4.0.1`，壁纸公共自动更新 feed 是否切到新包需单独决定。

### 2026-08-01 (v4.0.0)

- **HTTPS 新基线**：域名和 SSL 证书就位后，主客户端默认 API、自动更新源、Web 入口和壁纸更新清单统一切换到 `https://sales.example.com`。
- **报表入口统一**：客户端年度分析报告、月度分析报告和零售日报统一复用 Web 端 `/api/export` 生成接口；批发年度分析报告走 `/api/export/analysis/wholesale/yearly/<year>`。
- **零售 KPI 口径统一**：Web、客户端零售页和数据可视化页的销售额 KPI 统一显示索姆主值和按期间平均 CNY/KGS 折算的人民币副值，销量 KPI 统一显示升数主值和实际吨位副值。
- **接口治理**：OilStation 零售 KPI、分析报告、年度/月度聚合统一到 `OilStation/endpoints/v1/retail/*` 当前实现，旧 routes 副本已备份后移除。
- **发布状态**：`d6c9d14` 后已重新打包并部署；`/download/latest.yml` 指向 `SalesDesktop Setup 4.0.0.exe`，大小 `130365320` bytes。自检前外网客户端已更新到 `4.0.0`，同版本已安装客户端通常不会再次自动拉取同版本包。

### 2026-08-01 (SalesWallpaperEngine 0.2.0)

- **托盘检查更新**：手动检查更新移到壁纸托盘一级菜单，设置页只保留自动检查/自动安装更新开关，日常操作不再需要先打开设置窗口。
- **HUD 编辑退出优化**：退出 HUD 编辑模式时不再整页刷新，直接应用保存后的 HUD 布局，降低壁纸闪屏或短暂露出系统背景的概率。
- **更新包校验增强**：自动更新和按清单手动安装都会校验包大小和 SHA256，防止下载不完整或清单异常时继续覆盖程序目录。
- **进程自恢复与状态区**：播放器 WebView2 进程失败或播放器异常退出后由主进程自动拉起；设置页新增当前版本、API、授权、刷新/更新状态和实时数据可达性。
- **托盘菜单精简**：配置目录、日志目录等排查入口收进“高级”，一级菜单保留设置、HUD 编辑、重启、检查更新、安装更新和退出等日常动作。
- **发布状态**：`/download/wallpaper-engine/latest.json` 指向 `SalesWallpaperEngine 0.2.0`；zip `7812410` bytes，Setup `7725056` bytes。自检前外网壁纸端已更新到 `0.2.0`，同版本已安装壁纸通常不会再次自动拉取同版本包。

### 2026-08-01 (SalesWallpaperEngine 0.1.18)

- **销售 HUD 合并展示**：右下角年销量与年吨位合并为一个 KPI 格上下显示，月销量与月吨位同样合并，减少 HUD 占用面积。
- **人民币金额口径**：年/月销售额格增加人民币金额，按月度分析报告同口径使用统计期间平均 CNY/KGS 折算。
- **报表保存统一**：客户端年度分析报告、月度分析报告和零售日报统一复用 Web 端 `/api/export` 生成接口，先由服务端生成文件，再按返回地址保存。
- **顶部 HUD 压缩**：站点库存已按万L显示，库存 KPI 不再占双列，顶部 HUD 宽度同步收窄。

### 2026-08-01 (SalesWallpaperEngine 0.1.17)

- **HUD 手动拖拽完善**：壁纸引擎播放器补齐全局鼠标按下/松开事件转发，托盘和设置页均可进入 HUD 编辑模式，直接拖动顶部 KPI HUD 和右下角销售/汇率 HUD，拖完可从托盘或设置页保存布局。
- **轻量数据增强**：授权销售 HUD 增加年/月吨位；顶部运营概览增加库存预警红黄计数，不增加趋势或运营异常提示。
- **地图显示筛选**：设置页增加在营站、停业/装修站、油库点位、仅低库存点位开关；托盘更新入口去重，检查更新保留在设置页，托盘仅在发现新版时显示安装项，并增加运行状态写日志动作。

### 2026-08-01 (SalesWallpaperEngine 0.1.16)

- **壁纸托盘设置页**：独立壁纸引擎新增托盘「设置...」窗口，可配置语言、每日刷新、自动更新、HUD 显示项、地图视野和 HUD 布局；保存后写入 `%APPDATA%\sales-wallpaper-engine\app-config.json` 并重启壁纸应用。
- **HUD 拖拽缩放**：设置窗口打开期间，顶部 KPI HUD 和右下角销售/汇率 HUD 可在壁纸上直接拖动位置和调整大小，实时预览，未保存关闭会恢复已保存布局。
- **标题与悬停优化**：壁纸标题改为「Example Petroleum零售版图」/「Карта розничной торговли example」，删除副标题；点位悬停 tooltip 自动避让 HUD 区块，主客户端和 Web 地图不启用该选项，行为不变。

### 2026-08-01 (SalesWallpaperEngine 0.1.15)

- **HUD 独立 KPI 开关**：壁纸右下角 HUD 的 6 个 KPI 格（年销量/年金额/月销量/月金额/美元汇率/人民币汇率）支持按机器在 `app-config.json` 中独立开关，缺省默认全开，字段缺失按开启处理，老机器零影响。

### 2026-08-01 (SalesWallpaperEngine 0.1.14)

- **壁纸地图左右居中修复**：调整地图相机水平偏移（`fitCenterX`），1920×1080 下地图画面中心与屏幕中心的偏差从约 -31px 收敛到 -0.1px，窄屏（1536×864 / 1366×768）偏差均小于 4px，画面不再明显偏左。

### 2026-07-31 (SalesWallpaperEngine 0.1.13)

- **HUD 整块开关**：壁纸右下角 HUD 的销售汇总块和汇率块支持按机器独立开关，`app-config.json` 配置 `showSalesSummary` / `showExchangeRates`（默认都显示，字段缺失按开启处理），老机器零影响。
- **自动更新重启修复**：更新应用脚本改为带日志、父进程超时仍存活时安全中止不再覆盖运行中的 exe、重启失败自动重试 3 次，修复自动更新后壁纸不自动重启的问题。
- **KPI 自适应**：顶部 KPI 指标栅格改为 6 轨自适应布局，库存卡片加宽为其他卡片的两倍。

### 2026-07-29 (v3.10.1)

- **重要版本更新**：合并此前已验证修复，恢复零售、批发等业务页面 KPI 卡片点击跳转，金额、油量、库存、站点、刷卡等指标可进入对应明细页面。
- **图表下钻恢复**：零售总览区域柱状图可跳转并选中对应区域，站点 Top10 可跳转并选中对应站点；区域页和站点页同步支持 URL 参数定位。
- **单位和 tooltip 统一**：趋势图、排行图和 KPI 的 tooltip 补齐升、万升、索姆、万索姆、万元、吨、百分比等单位，并隐藏默认 `series0` 名称。
- **知识库滚动优化**：知识库菜单左右两列支持独立上下滚动，长列表查看更稳。
- **库存液位口径升级**：库存预警改为按数据库最新 `fuelbalance.VolumeMaximum` 实际库容和当前库存计算；库容缺失时使用数据库历史观测上限兜底，黄色表示 30%-50%，红色表示低于 30%。
- **地图悬停增强**：地图点位颜色继续只表达营业状态，悬停信息按每个油品显示库存、库容、液位百分比和零售价，并用绿色/黄色/红色区分油品库存液位。
- **地图观感优化**：客户端吉尔吉斯地图、Web 零售板块总览地图和壁纸地图恢复总部/北方/南方三处油库标点，但改为高位小标点且不常驻文字；每个油库点位增加到实际坐标的指向线；CTY-22、REG-08、CTY-28等密集加油站自动散开并缩小，提高悬停命中率。
- **停业站地图口径**：11、12、21 号站在地图和壁纸端按停业红色显示；这三站实际库存已清零，但零售系统数据库仍有旧值，因此地图悬停、壁纸库存和库存预警按清零规则覆盖展示，不回写原始数据库。
- **预警页同步**：Web 端和客户端零售预警页增加油品库存液位预警表，便于直接查看低液位站点和油品。
- **壁纸引擎增强**：独立壁纸授权接口返回库存库容、液位百分比、低库存汇总、年/月销量销售额和汇率；HUD 自动避让 Windows 任务栏；`SalesWallpaperEngine` 独立版本线默认自动检查、下载、校验、替换并重启，壁纸更新仍不混入主客户端安装包；壁纸数据启动时刷新，之后每天 09:00 自动刷新一次，错过定时或刷新失败会自动补刷重试。
- **发布校验加强**：新增主程序安装包审计脚本，打包后会解开 NSIS 外层和 `app-64.7z`，对比已验证参考包检查 `SalesDesktop.exe`、`resources/app.asar`、入口 JS/CSS、地图资源和 `app-update.yml`。

### 2026-07-31 (SalesWallpaperEngine 0.1.12)

- **壁纸地图视野回归修复**：壁纸地图改为任意分辨率下水平可视宽度恒为约 72.7 世界单位（等价 0.1.9 固定相机在 1920×1080 的视野）。相机距离按视口宽高比推导（`fitWorldWidth` 选项），16:9 屏保持与 0.1.9 完全一致的画面，窄屏自动拉远不再溢出，修正 0.1.11 自适应在窄屏/小屏可能溢出的回归；`fitCenterX/Y/Z` 偏移保证国家居中。
- **壁纸设置面板移除**：删除壁纸页内设置按钮/面板、配置持久化和更新诊断显示；更新横幅与自动更新检查保留，由引擎托盘菜单和配置文件管理。
- **客户端/Web 零影响**：`fitWorldWidth` 默认关闭，客户端地图和 Web 地图不启用，行为不变。

### 2026-07-30 (SalesWallpaperEngine 0.1.11)

- **Screen-adaptive wallpaper map**: the wallpaper map no longer uses a fixed camera. The Kyrgyzstan map now auto-fits any screen resolution on init and re-fits on resolution/DPI/window changes (`fitOnResize` option), fixing the map overflowing the screen on small or narrow-aspect displays.
- **Hover tooltip occlusion fix**: the station hover tooltip flips left/up when it would cross the right/bottom edge of the screen (`flipTooltip` option) and renders above the bottom-right sales summary HUD (tooltip z-index raised to 60 in the wallpaper stylesheet).
- **Client/web zero impact**: the shared `Kgz3DMap.js` gains `fitOnResize` and `flipTooltip` options, both default OFF; the desktop client and web map do not pass them, so their behavior is unchanged.

### 2026-07-30 (SalesWallpaperEngine 0.1.10)

- **Language auto-detection**: the wallpaper page reads `SALES_RUNTIME_CONFIG.wallpaper.language` set by C# `CultureInfo.CurrentUICulture`; auto-detects Chinese or Russian and renders full UI in that language without manual switching.
- **High-DPI adaptation**: `PlayerForm` initial `Bounds` uses `Screen.PrimaryScreen.Bounds` instead of off-screen `(-32000,-32000)`, so WebView2 captures the correct DPI context on first render. Pointer coordinates are divided by `devicePixelRatio` inside the synthetic script, fixing station hover on HiDPI (e.g. Huawei touchscreen laptops).
- **Touch handling**: added `touch-action: none` and `user-scalable=no` viewport to prevent mobile/tablet browser zoom from interfering with the desktop wallpaper.
- **DPI change resilience**: the wallpaper map re-resizes on `devicePixelRatio` changes via `matchMedia('resolution: 1dppx')` listener, with multiple deferred resize calls during boot to catch late font/metric settle.

### 2026-07-29/30 (SalesWallpaperEngine 0.1.0-0.1.9)

- **Dedicated rewrite**: added `SalesWallpaperEngine`, a new independent host/player WebView2 wallpaper engine that uses WorkerW/Progman desktop attach and a separate player process.
- **Local proxy data path**: the wallpaper page now reads `127.0.0.1` and the engine proxies `/api/wallpaper/map` to the configured API with `wallpaper-key.json` token support, avoiding browser mixed-content/CSP issues.
- **0.1.1 field fix**: forwards global mouse position into the WebView canvas so station hover works while the wallpaper sits behind desktop icons; hides the in-page settings button in Engine mode.
- **0.1.2 tray cleanup**: shortens the tray version label and moves diagnostics/log actions under `高级`, keeping the first-level menu small.
- **0.1.4 sales summary HUD**: the shared wallpaper page can show current year/month retail volume and sales amount in the bottom-right HUD when `/api/wallpaper/map` is authorized.
- **0.1.5 true auto-update**: defaults to automatic update checks and installs; the engine downloads the independent zip, verifies SHA256, replaces files after exit, and restarts itself.
- **0.1.7 exchange HUD**: the bottom-right wallpaper HUD shows authorized USD/KGS and CNY/KGS exchange rates from the project exchange-rate snapshot.
- **0.1.8 display cleanup**: removes the bottom-left data timestamp and refresh timestamp from the wallpaper canvas.
- **0.1.9 daily data refresh**: refreshes wallpaper data immediately on startup, then once daily at 09:00 after the morning automation tasks; `refreshAtLocalTime` can override this.
- **Independent package**: local `SalesDesktop/download/wallpaper-engine/latest.json` is prepared for `SalesWallpaperEngine 0.2.2`; production sync is separate from the main `SalesDesktop` version, installer, and `latest.yml`.

### 2026-07-29 (v3.9.17 后端热修)

- **自用油合计口径修正**：`按加油站统计` 分表的合计列改为“合计吨位(t)”，按同一加油站、同一油品、公司车辆/员工车辆/发电机分别汇总，不再把公司车辆和员工车辆合并。
- **吨位展示**：合计值按 `Mass / 1000` 计算，四舍五入保留 4 位小数；原有公斤、升数、金额列保持不变。
- **发布边界**：本次只部署后端报表导出逻辑，不更新 `SalesDesktop` 客户端版本号，也不重新发布主客户端安装包。

### 2026-07-28 (v3.9.16)

- **排行图顺序修复**：零售分析、驾驶舱和批发列表中的排行类图表统一按指标从多到少排序，横向排行图第一名固定显示在最上方，避免 Top10、区域排行、油品结构图出现视觉倒序。
- **覆盖范围**：客户端与 Web 端同步修正总览 Top10、区域/油品/站点排行、月度油品结构、站点同区域对比、驾驶舱 ranking 组件以及批发 BarList/RankList。
- **回归保护**：新增桌面端和 Web 端排行排序工具测试，防止后续再次通过 `reverse()` 混用导致排行显示不一致。
- **发布同步**：客户端、Web 和生产部署版本同步到 `3.9.16`。

### 2026-07-28 (v3.9.15)

- **更新源兜底**：客户端自动更新检查增加备用发布源兜底；`sales.example.com` 因付款、DNS 或运营商缓存异常不可用时，仍可通过备用发布入口获取新版本。
- **阶段策略（历史）**：当时新版客户端默认更新源暂时固定为备用发布入口，API 主入口使用生产域名并支持备用入口回退；2026-08-01 起正式域名已统一切到 HTTPS。

### 2026-07-28 (v3.9.14)

- **Network Error 二次热修复**：打包客户端的 Electron CSP 连接白名单同步放行生产域名与备用入口，确保 3.9.13 的回退请求不会被客户端安全策略拦截。
- **CORS 修复**：后端正确识别 `file://`、`null`、`app://` 来源，并显式允许生产域名入口，覆盖桌面客户端本地页面和 Web 端跨源回退请求。

### 2026-07-28 (v3.9.13)

- **Network Error 热修复**：客户端访问生产域名出现网络错误时，自动使用备用入口重试 API 请求，避免 DNS 或域名网络未稳定时无法登录。
- **验证**：域名和备用入口健康接口、登录接口、CORS 预检、桌面 typecheck/test 均通过。

### 2026-07-28 (v3.9.12)

- **登录热修复**：打包后的客户端若本机旧 `app-config.json` 仍指向 `127.0.0.1/localhost`，自动回退到正式域名，避免远端客户端误连本机导致登录失败。
- **错误提示修复**：登录页显示后端或网络层真实错误信息，不再把 API 地址、网络连接、服务异常统一误报为“账号密码错误”。
- **验证**：`admin` 登录接口已在正式域名、备用入口和兼容入口返回 200；桌面 typecheck/test 通过。

### 2026-07-28 (v3.9.11)

- **AI 助手项目覆盖 release gate**：新增 `Sales/project_capabilities.py`，按客户端 41 个菜单/模块级问法自动验证 route/domain/metric/维度/只读工具，防止明确业务问题回退到最近 7 天零售汇总。
- **系统健康联动**：系统健康新增 `assistantProjectCoverage`，AI 项目覆盖失败会进入提醒中心，便于发布前发现问答覆盖缺口。
- **迟到数据审计与补跑**：新增 `scripts/audit-late-retail-data.ps1` / `scripts/late_retail_data_maintenance.py`，可按业务日期识别日快照、月快照、自用油、年度快照和吉方财务交接报表是否晚于数据上传时间，并可显式补跑。
- **历史快照重跑能力**：`OilStation/scripts/refresh_current_snapshots.py` 支持 `--date/--month/--start/--end`，用于停电、延迟上传、跨日班次等场景的历史月份快照重建。
- **真实密度/吨位审计**：新增 `audit-retail-density-mass`，并升级 `compare_retail_snapshot_db.py`，按数据库真实质量/密度字段对照快照升数、kg、吨和销售额。
- **生产域名默认入口（历史）**：桌面客户端默认 API 和更新源切换到生产域名，保留备用入口兜底；当时为临时过渡阶段保留 HTTP。2026-08-01 起正式域名已统一切到 HTTPS。
- **发布维护工具**：新增旧安装包安全清理、桌面更新源回滚、HTTP 域名连通性检查脚本；本次清理旧公开安装包释放约 `248.63 MB`。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.11`。

### 2026-07-28 (v3.9.10)

- **吉方财务交接日报补生成修复**：日报目标日期改为按 `shift.DatetimeShiftBegin` 归属，5 号站 `2026-07-27 18:43:13` 至 `2026-07-28 08:21:37` 的跨日班次会生成在 `20260727`。
- **无销售班次也生成报表**：已完成班次即使销售明细为空、现金缴款为 0，也会保存吉方财务交接报告，不再被自动任务跳过。
- **恢复营业站点模板兜底**：当前一日报表目录缺少某个恢复营业站点模板时，自动从更早日报文件夹回溯可用模板；14 号站已补入正式模板。
- **原 84 报表对齐**：机表/油罐匹配增加剩余行顺序补齐，支持非首行油罐进油量写入，并修正主表/明细表空白列显示。
- **系统健康状态修复**：报表文件已补齐且晚于旧失败任务时，状态页会忽略过期 `failedItems`；已生成文件不再被停电/停业状态误判为缺失。
- **验数结论**：2026-07-27 正式吉方财务交接日报 28 份对照原零售服务端日报 28 份，业务值、行列结构、合并区域均 0 差异。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.10`。

### 2026-07-27 (v3.9.9)

- **AI 助手快捷问答修复**：Web 端快捷问答和客户端助手在驾驶舱/首页上下文下，`月趋势`、`本月每日销量趋势`、KPI、同比环比、油品占比、零售价、停业站点等问题不再误答“驾驶舱KPI指标和驾驶舱组件目录”。
- **AI 助手密度口径修复**：`当前密度` 改为读取零售快照，按实际质量 ÷ 销量计算各油品平均密度，不再以固定密度或维护表最新值作为主答案。
- **清空问答指令修复**：`清空问答/清屏/重置对话` 在桌面端和 Web 端本地清空会话；后端 v2、流式和兼容入口返回 `clearConversation` 界面指令兜底，不再进入业务查询。
- **回归覆盖**：补充驾驶舱页面上下文下快捷问答路由测试、清空问答界面指令测试，并验证密度问答返回零售快照实绩密度。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.9`。

### 2026-07-27 (v3.9.8)

- **AI 助手项目级覆盖发布**：按当前客户端已有菜单和业务模块补齐问答入口，覆盖驾驶舱、地图、零售、批发、采购、报表中心、火车入库、物资、合同、知识库、权限、称重、系统健康、审计、管理中心和设置等内容。
- **AI 助手误路由修复**：2 号站位置、在营站/油库数量、报表中心有哪些报表、当前客户端版本、14 号站是否营业等资料类问法不再回退到最近 7 天零售汇总。
- **新增专项评测集**：新增项目级覆盖评测，和现有业务评测合计 90 条自动问答用例；实际执行 34 条菜单级问法，全部命中明确 route/domain。
- **资料类工具补齐**：新增驾驶舱 KPI、零售预警、报表中心目录、火车入库录入、客户端版本和单站营业状态等只读业务工具。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.8`。

### 2026-07-27 (v3.9.7)

- **AI 助手重要升级**：业务语义层继续增强，覆盖自然语言时间、业务域、指标、上下文追问和项目真实业务评测集。
- **AI 助手业务口径修复**：第一季度、前年/大前年、今年/去年自用油、当前年零售销量等问题按真实业务周期和独立业务域返回；当前未结束周期截止到实际运营数据日期。
- **AI 助手展示收敛**：已有类表格结果时只展示表格化答案，不再同时重复输出纯文字摘要、趋势图和类表格信息。
- **真实密度/吨位贯通**：零售真实密度和真实吨位链路贯通快照、Web、客户端和 AI；历史快照提供回填脚本，旧缓存异常时优先使用真实质量字段。
- **客户端 KPI 修复**：零售销量 KPI 和数据可视化驾驶舱零售销量 KPI 同时显示升数和实际吨位，不再由前端按固定密度估算。
- **月度快照切换修复**：Web 与客户端零售月度页面切换月份时优先读取快照，并防止慢请求覆盖当前月份。
- **吉方交接报表显示修复**：继续修复俄文内容显示和失败项返回链路，保留自动任务失败明细用于系统健康排查。
- **站点状态更新**：14 号STN-27加油站装修状态已结束，恢复正常营业口径，预警、排行、站点状态和 AI 查询不再按装修停业处理。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.7`。

### 2026-07-26 (v3.9.6)

- **吉方交接报表失败项返回**：自动任务 `retail_accounting_reports` 返回结构化 `failedItems/failedCount`，不再只返回一段合并错误文本。
- **自动任务链路统一**：计划任务、客户端手动补跑和状态检查统一识别缺站、跳过站点、模板/班次不匹配、生成警告和脚本异常。
- **系统健康展示增强**：吉方日报状态新增失败项数量和明细表，支持查看站号、文件、失败类型和原因。
- **回归覆盖**：新增吉方日报自动任务、API 手动执行、状态汇总和异常失败项单元测试。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.6`。

### 2026-07-24 (v3.9.5)

- **报表舍入口径统一**：所有生成报表在保留固定小数位时统一按“四舍五入”处理，不再依赖 Python 内置 `round()` 的银行家舍入。
- **Excel 汇总公式修复**：零售月报、周报、日报的小计和总合计公式改为 `ROUND(..., 位数)`，确保公式结果本身按目标小数位固化。
- **报表缓存刷新**：报表缓存版本升级到 `v6-report-half-up-rounding`，避免复用旧舍入公式生成的 Excel。
- **回归覆盖**：新增报表舍入单元测试，覆盖 `2.675`、`2.5` 和 Excel 汇总公式。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.5`。

### 2026-07-23 (v3.9.4)

- **零售周报增强**：新增“合同销售吨”列，位于“合同销售量”和“合同单价”之间；周报所有吨位列统一保留 4 位小数。
- **报表字体统一**：零售报表和自用油报表中含俄语内容统一使用 `Times New Roman`，减少俄文表头、站名和油品名显示差异。
- **自用油导出修复**：“按加油站统计”分表按加油站编号升序排列；修复 `01KG000AA-Водитель` 等俄文司机/车牌旧编码乱码；导出文件名改为中文 `自用油_日期_至_日期.xlsx`。
- **系统健康收敛**：API 健康统计排除 401/403 认证/权限拒绝；提醒中心去除小站低销量误报，保留真实业务异常。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.4`，报表缓存版本同步提升，避免复用旧格式 Excel。

### 2026-07-23 (v3.9.3)

- **零售日报价格修复**：7 月 19 日调价后，日分表价格列优先使用当天销售交易价，不再被旧 `fuelbalance.CurrentPrice` / `balance.EndPrice` 覆盖。
- **调价表兜底**：接入 `D:\油站调价文件\2026年\прейскурант цен26.07.18.pdf` 作为 2026-07-19 起无销售价格行的官方兜底。
- **样本站点回归**：STN-57显示 AI-92 `82.00`、AI-80 `69.50`、DT `97.30`、SPBT `44.70`；30 号站显示 AI-92 `83.30`、AI-80 `68.00`、DT `96.90`。
- **吉方交接日报修复**：销售明细按 `BasePrice` 分价聚合，跨调价班次不再把新旧价格段合并。
- **系统健康误报收敛**：API 健康统计排除 401 未登录和 403 权限拒绝，安全拦截继续进入审计日志但不再标记为接口故障。
- **零售预警收敛**：趋势异常只按日销量真实波动判断，不再把正常小站体量低于全站中位数当作异常。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.3`，报表缓存版本升级避免复用旧 Excel。

### 2026-07-22 (v3.9.2)

- **AI 助手业务域路由修复**：将“自用油”识别为独立业务域，并按原系统报表24自用油口径返回销量、重量、金额、油品和站点汇总。
- **AI 助手时间理解修复**：新增“前年”“大前年”动态相对年份解析；例如 2027 年询问“前年”会自动落到 2025 年。
- **AI 助手季度识别修复**：“第一季度”不再被“第一”误判为排行问题，季度零售回答保持汇总口径并显示合计。
- **AI 助手项目级数据路由**：收紧 KPI 触发条件，普通“今年零售/自用油/库存/价格”等问题不会被年度 KPI 分支抢走；业务词明确时不再多余澄清。
- **回归验证**：补充 AI 助手时间解析、项目级业务域路由、自用油误路由和动态相对年份回归测试。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.2`，公网更新源已指向新安装包。

### 2026-07-22 (v3.9.1)

- **AI 助手自检增强**：新增 `assistantPlan.selfCheck`，回答前检查时间、同环比基准、排行维度、趋势工具和只读工具约束。
- **AI 助手防跑偏**：用户问题里有明确时间但未可靠解析时先澄清，不再静默套用“最近7天”。
- **AI 助手默认假设透明化**：用户未说明时间时，会把“默认最近7天”记录到假设和自检风险中。
- **AI 助手前端展示**：桌面端和 Web 旧助手显示自检通过、自检有假设或自检未通过状态。
- **AI 助手评测增强**：新增自检失败、默认时间、同环比基准、页面上下文和复合问题子计划测试。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.9.1`，公网更新源已指向新安装包。

### 2026-07-22 (v3.9.0)

- **AI 助手重要版本更新**：升级为业务语义层，支持复合问题拆解、只读工具编排、同环比基准区间、页面上下文理解和查询条件展示。
- **AI 助手复合问题**：可把“上半年零售总额、哪个站最高、哪个油品下滑”拆成多个子查询，按顺序调用只读工具并合并结果。
- **AI 助手同环比增强**：`本月同比`、`比上个月同期` 等问题会保留当前区间和基准区间，并直接计算销量、吨位、金额变化。
- **AI 助手页面上下文**：客户端会传递当前页面路径，用户说“这个页面”“当前页”时可辅助判断零售、站点、油品或区域维度。
- **AI 助手原因分析增强**：站点下滑回答增加零销量天数、低销量日期和数据完整性/站点状态/油品库存价格排查提示。
- **AI 助手结果操作**：桌面端回答展示时间、指标、维度、工具和对比区间，表格支持复制和下载 CSV。
- **密集趋势图标签修复**：零售月度和站点 30 天趋势图不再强行显示每个折线数值，只保留首尾、峰谷和均匀抽样标签，避免折线标签互相重叠。
- **AI 助手时间理解修复**：识别 `26年上半年`、`26年6月` 等短年份时间条件，避免误回退为“最近7天”。
- **AI 助手季度/年度理解**：新增 `今年`、`去年`、`去年6月`、`26年二季度`、`上季度`、`本季度` 等时间条件解析。
- **AI 助手滚动区间理解**：新增 `最近30天`、`过去三周`、`近两个月`、`最近半年`、`过去一年` 等滚动时间条件解析。
- **AI 助手自然语言路由**：新增 `assistantPlan` 意图计划，能先理解零售概况、排行、站点下滑、数据补传、吉方日报、批发、汇率等查询意图，再选择对应只读数据工具。
- **AI 助手趋势指标优化**：趋势、下滑、波动类问题未明确指标时默认按销量分析；用户明确说营业额、金额或吨数时仍按对应指标。
- **AI 助手多轮上下文**：客户端会传递会话 ID、最近对话和上一轮 `assistantPlan`，后端可理解“那它今天呢”“那为什么”等追问，并复用上一轮站点、时间、维度和工具。
- **AI 助手业务词典与澄清**：新增 `businessTerms` 词典命中和 `clarification` 澄清机制，能识别营业额、销量、吨数、站点、油品、区域等说法；业务范围、排行维度或指标不明确时先反问，不再硬套默认最近 7 天。
- **AI 助手澄清回填**：用户回答“零售”“油品”“销售额”等简短澄清时，会回填上一轮问题的时间、路由和已确认字段；必要时可连续追问维度和指标。
- **AI 助手快捷回复**：桌面端和 Web 旧助手会把澄清选项显示为按钮，点击“零售”“油品”“销售额”等选项即可承接上一轮继续查询。
- **AI 助手消息滚动**：桌面端连续提问、澄清和返回结果时自动滚到最新消息。
- **柱线图避让增强**：保留的折线标签继续按柱体像素边界显示在柱顶之外，避免压住柱状图。
- **本地大模型预备**：AI 润色层会接收结构化意图计划、业务工具目录、知识库片段和对话上下文，后续从 OpenRouter 切换本地模型时可复用同一业务语义层。
- **窄柱标签优化**：密集柱线图中柱状图数值仍在柱内，但改为竖排显示，减少窄柱横向挤压。

### 2026-07-22 (v3.8.23)

- **柱线图标签避让修复**：混合趋势图先记录柱状图像素边界，再把折线数值标签移到同类目柱体上沿之外，避免折线标签压在柱子上。
- **图表顺序保护**：内部调整布局顺序时保留原始颜色映射和 tooltip 展示顺序，避免修复标签时改变图例含义。
- **回归测试**：补充 `ChartCard` 混合柱线图标签避让测试，锁定“折线在前、柱子在后”的真实业务场景。

### 2026-07-22 (v3.8.22)

- **侧栏悬停修复**：恢复客户端左侧栏收缩后鼠标悬停弹出子菜单，折叠状态下仍可进入多级菜单页面。
- **柱线图标签修复**：柱状图数据恢复显示在柱子内，折线图数据恢复显示在点位上方，并增加错位、留白和白底以减少与柱子重合。
- **菜单弹层优化**：补强折叠菜单弹出层层级、圆角和阴影，提升收缩侧栏下的可读性和稳定性。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.8.22`，公网更新源已指向新安装包。

### 2026-07-22 (v3.8.21)

- **系统健康收敛**：提醒中心和运行治理只评估当前有效自动任务，历史 `automation_all` 记录不再造成故障误报。
- **质量与发布治理**：补充后端、桌面端和 Web 端关键单元测试，`preflight-release.ps1` 纳入 Python unittest、Vitest、桌面端类型检查和完整依赖审计。
- **安全与依赖治理**：后端 CORS 与桌面端 API Host 改为白名单策略，桌面端升级到 Electron 43 / electron-builder 26，Python 后端依赖固定版本。
- **客户端体验**：关闭确认、更新安装提示和报表中心迁入中俄双语文案，统一加载/错误状态并收敛桌面端构建分包提示。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.8.21`，确保已更新到 `3.8.20` 的外网客户端可检测到新版本。

### 2026-07-22 (v3.8.20)

- **地图精度升级**：从 `D:\map` 提取高精度吉国行政区、国界、湖泊、道路和全球国家边界数据，同步到桌面端和 Web 静态资源目录。
- **3D 吉国地图**：坐标换算改为本地 Web Mercator 投影，行政区保留项目原有统一深色填充，继续支持油库、加油站、批发客户点位和库存/价格 Tooltip。
- **地球视图**：新增中国和中亚国家高精度边界，基础全球边界按 ISO3 与空间位置跳过已覆盖边界段，高精度包内共享边界去重，避免多重边界线。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.8.20`。

### 2026-07-21 (v3.8.19)

- **提醒中心**：系统健康新增“提醒中心”页签，统一汇总 API 失败、缓存失效、自动任务失败、知识库索引、客户端更新源、吉方日报缺站、零售趋势异常和报表差异事项。
- **254 收口状态**：运行治理读取最新本地报表比对摘要，突出零售总表对原软件 254 的差异待确认数量，不修改 24/84/254 已固定报表口径。
- **零售异常汇总**：系统健康接入零售预警洞察，管理员可在健康页先看到异常数量，再进入零售预警页核查站点、库存和价格调整。
- **发布同步**：源码提交 `51ebe51`，客户端、Web、后端和自动更新包版本同步到 `3.8.19`，生产环境已部署。

### 2026-07-21 (v3.8.18)

- **自用油报表对齐原 24**：查询和导出改为直接按原软件报表编号 24 数据来源生成，筛选条件固定为 `BasePaymentTypeKey=2 AND DerivedPaymentTypeKey=2`。
- **车牌/司机口径修复**：自用油车牌号取原 24 Driver 来源（`change_log GuideKey=590336`），不再使用项目车牌映射、发电机特例或 `person.Name` 兜底。
- **重量口径修复**：自用油重量只取 `selling.Mass`，不再通过密度补算，7 月 1 日至 7 月 20 日 289 笔与原 24 来源对比无差异。
- **发布同步**：客户端、Web、后端和自动更新包版本同步到 `3.8.18`，生产环境已部署。
- **运行治理**：系统健康新增运行治理状态，检查知识库附件索引和客户端 `/download` 更新源完整性。
- **知识库索引**：附件上传后解析文本入库，搜索和 AI 只读引用可命中附件内容；重建索引拆分为 `knowledge:reindex` 权限。
- **代码图谱**：初始化本机 CodeGraph 索引，`.codegraph/` 与 `.code-review-graph/` 纳入忽略。
- **发布自检**：新增 `scripts/preflight-release.ps1`，用于提交/打包/部署前统一检查 Python、客户端、Web、敏感文档和更新包。
- **维护文档**：核心文档新增/补充报表口径、API 接口调用和维护交接资料，便于后续其他软件接手。

### 2026-07-21 (v3.8.17)

- **AI 助手日期区间修复**：优先识别完整起止日期，避免“2026年1月1日到2026年6月30日”被误判为 1 月。
- **零售快照汇总**：连续完整多月区间直接合并月度快照，跨月零售销量、吨位和金额按区间汇总返回。
- **发布同步**：客户端、后端构建标识和桌面更新包版本同步到 `3.8.17`。

### 2026-07-21 (v3.8.16)

- **自动更新修复**：修复未签名 Windows 安装包因 `publisherName` 签名校验导致客户端下载后拒绝安装的问题。
- **打包配置**：关闭 Windows 更新签名校验，避免没有代码签名证书时自动更新链路被阻断。
- **更新兜底**：主进程增加 electron-updater 签名校验运行时兜底，后续版本继续支持自动更新。

### 2026-07-21 (v3.8.15)

- **吉方日报监测**：系统健康新增“吉方日报”页签，按业务日期展示应生成站、已生成站、缺失站和停业/暂停站。
- **缺站提醒**：客户端重点提示缺少交接日报的站号、站名和区域，方便数据录入人员及时发现短缺数据。
- **手动补跑**：支持在客户端按选中业务日期生成/重生成吉方财务交接日报，数据修正后可直接补跑。
- **状态排除**：停业、装修、修路、迁址等影响销售的站点单独展示，不再被误报为缺少日报。

### 2026-07-21 (v3.8.14)

- **吉方交接日报**：新增吉方财务会计交接日报生成脚本，支持按日批量生成每个加油站交接报表，并接入每日维护任务的手动/自动生成流程。
- **历史模板兼容**：补齐 4 月、5 月、6 月历史模板差异处理，兼容跨日班组、补保存文件、日期+站号文件名、老格式主表合计、单据号空格和同油品多明细行。
- **数据分配修复**：按物理油品、站内资源、供应单据和模板行匹配销售与进油数据，避免同油品多行重复合计或漏填。
- **回归验证**：4 月 735 份、5 月 791 份、6 月 759 份历史交接报表逐单元格、样式、行列尺寸和合并单元格比对全部通过。
- **发布清理**：删除本地回测/临时测试报表目录，发布包仅包含正式代码与版本信息。

### 2026-07-20 (v3.8.13)

- **地图快照**：吉尔吉斯地图悬停信息统一展示“快照时间”，后端按最新已结束班组生成库存、价格和时间口径，减少对“昨天/前天数据”的误解。
- **地图加载**：打包客户端改用本地 `kgz-map/data` 资源路径，避免外网安装版在 `file://` 环境下地图 JSON 加载失败。
- **全屏大屏**：客户端地图、Web 首页地图、零售地图支持单图全屏并可按 `Esc` 退出；客户端数据可视化页支持大屏模式，Electron 支持 `F11` 窗口全屏。
- **更新检查**：客户端检查更新增加防重入保护，避免自动检查、手动检查和自动下载并发时先闪红色错误再继续下载。
- **版本信息**：设置页补充开发者信息“Юрий”，安装包作者/发布者元数据同步完善。

### 2026-07-20 (v3.8.12)

- **报表口径**：零售日报、周报和自用油报表从 2026-06-01 起优先读取数据库真实密度、重量和吨位数据，减少固定密度造成的差异。
- **AI80 兜底**：30 号站 AI80 真实销售记录缺失密度时按 0.721 计算吨位，标定记录仍不计入正常销售。
- **外网客户端**：报表生成和下载遇到过期 access token 时自动刷新并重试，避免隔天必须 `Ctrl+R` 后才能保存。

### 2026-07-17 (v3.8.11)

- **物资字典**：表头“编码”统一改为“编号”，接口按编号升序返回，当前物资清单从 A0001 到 A0142 顺序展示。
- **录入体验**：新增/编辑改为先在表格内编辑、点击保存后统一提交，避免逐格请求导致卡顿。
- **删除保护**：新增物资删除按钮和后端删除接口，已被入库、调拨或库存记录引用的物资禁止直接删除。

### 2026-07-17 (v3.8.10)

- **物资字典**：补齐并规范 142 条物资俄语名称，修正加油机配件、计量器具、消防用品等俄语显示。
- **客户端视觉**：物资字典表格列内容统一居中显示，提升中俄双语清单阅读一致性。
- **资料保护**：知识库附件目录与本地客户端配置加入忽略规则，避免公司资料和本机地址配置误提交。

### 2026-07-17 (v3.8.9)

- **权限安全**：知识库附件删除仅管理员可执行，Web 端与客户端同步隐藏非管理员删除入口。
- **改密统一**：Web `/api/v2/auth/status` 统一读取数据库最新改密状态并支持 JWT/Session 兜底；客户端已改密账号在 Web 端不再重复提示。
- **客户端视觉**：自用油、零售报表与报表中心内容区改为与零售分析总览一致的第一层滚动容器，去掉二级容器视觉。
- **运行安全**：生产后端仅监听 `127.0.0.1:8900`，旧公网 8900 入口关闭，外网统一走 Nginx 80/443。
- **依赖治理**：火车录入 Excel 导入移除高风险 `xlsx` 依赖，改用只读解析库 `read-excel-file`；补充后端依赖与 Nginx 自检说明。

### 2026-07-17 (v3.8.8)

- **设置简化**：设置页移除重复语言切换入口，统一使用左侧栏底部语言切换。
- **更新弹窗**：更新下载完成提示改为客户端内置弹窗，避免 Windows 原生消息框风格不一致。
- **更新排查**：设置页下载进度显示已下载大小、总大小和速度；客户端本地写入 `updater.log`，方便判断差量更新或全量回退。

### 2026-07-17 (v3.8.7)

- **侧栏修复**：客户端左侧栏收缩后，logo 与菜单图标统一按 72px 侧栏居中对齐。
- **退出优化**：点击“退出账号并关闭”时先清除本地登录状态，再异步通知后端退出，减少外网网络等待导致的关闭卡顿。

### 2026-07-17 (v3.8.6)

- **更新修复**：显式启用 Electron preload 所需环境，避免安装版客户端设置页提示未检测到更新模块。
- **稳定性**：preload 读取运行时配置失败时仍优先暴露 updater 和 electronAPI，提升自动更新入口稳定性。

### 2026-07-17 (v3.8.5)

- **关闭确认**：点击客户端右上角关闭按钮时，提示选择“最小化到任务栏”或“退出登录并关闭”。
- **体验修复**：关闭确认改为客户端内置弹窗；关闭弹窗本身只取消本次关闭，不再默认最小化到任务栏。
- **弹窗优化**：关闭确认底部仅保留“最小化到任务栏”和“退出账号并关闭”两个动作。
- **关闭修复**：关闭按钮通知改为双通道触发，避免点击右上角关闭无响应。
- **托盘入口**：任务栏托盘图标支持右键打开/关闭，双击图标打开客户端。
- **登录安全**：客户端彻底关闭或重启安装更新前清除登录状态，重新打开必须重新登录。

### 2026-07-17 (v3.8.4)

- **报表修复**：客户端报表菜单“按支付方式”内容区金额列补充“万 сом”单位，现金、刷卡和合计金额右对齐展示。
- **窗口修复**：客户端恢复 Windows 原生窗口标题栏和控制按钮，避免自定义无边框按钮点击无响应。
- **数据录入**：新增“删除选中”入口，支持删除错误录入或测试录入记录。
- **侧栏优化**：折叠/展开入口合并到 logo 区域，去掉 logo 旁边的独立展开图标。
- **本地图标**：本地 Electron 测试窗口使用正式 logo 图标。
- **知识库增强**：初始化默认业务资料，覆盖账号改密、报表中心、零售口径、权限、AI 只读边界和客户端更新流程。
- **客户端美化**：长表格恢复内容区内滚动，并优化滚动条质感。
- **AI 引用优化**：知识库搜索增加中文业务关键词命中，提升自然问题召回率。
- **验收约定**：修复或新增完成后先打开本地 Electron 客户端检查，通过后再打包部署。

### 2026-07-16 (v3.7.0)

- **KPI 组件化**：统一 KPI 卡片、指标网格和涨跌好坏方向，支持状态色、说明、点击联动和中俄文单位显示。
- **可视化舱**：新增可视化舱页面，按后台模板自由组合 KPI 与零售预警摘要；普通用户只看到权限允许的组件。
- **管理中心**：新增管理员专属管理中心，可维护驾驶舱组件、系统配置、数据字典和回收站摘要。
- **录入效率**：数据录入、合同新增、物资调拨页面增加批次 KPI，显示当前行数、有效行、异常行、未保存行和汇总量。
- **权限边界**：驾驶舱配置、系统配置、字典维护和回收站摘要仍只放在管理菜单下，仅管理员可见。

### 2026-07-16 (v3.6.0)

- **权限与管理**：管理菜单统一收口为管理员可见，新增系统健康页，可查看服务、API 调用、缓存、自动任务和 AI 调用状态。
- **AI 助手**：新增全局只读 AI 助手入口，先接入 OpenRouter 免费模型，只允许查询和回答，禁止修改代码、文件、缓存、合同和业务数据。
- **Excel 式录入**：数据录入、物资调拨、合同新增升级为连续录入表格，支持回车换行、批量粘贴、草稿和统一保存；合同附件列仅登记附件编号。
- **零售预警**：保留现有预警菜单结构，趋势异常和运营建议改为每日根据零售快照生成，并按中俄语言分别返回。
- **安全**：`Ctrl+Shift+I` 控制台快捷键仅管理员登录后生效，并写入审计日志。
- **多语言**：权限、审计、系统健康、AI、调拨状态和批量录入提示补齐中俄双语。

### 2026-07-13 (v3.3.0)

- **客户端（零售·自用油）**：零售菜单新增"自用油"子页面，展示自用油每日交易明细（含车牌号），支持车牌号搜索与 Excel 导出
- **后端（OilStation）**：新增 `GET /api/retail/self-use/<year_month>` 自用油查询 API、`GET /api/export/self-use/<year_month>` Excel 导出 API

### 2026-07-13 (v3.1.5 / v3.2.0)

- 客户端（零售·区域）：新增"当月日销趋势"图（按区域内各站点每日销量/金额聚合，柱状+折线双轴）
- 客户端（零售·站点）：刷卡比例图改为每日真实占比 `刷卡/(现金+刷卡)`，缺失当日数据时按月度比例兜底
- 客户端（零售·月度）：关键洞察改为 7 条句式洞察（对齐 Web 版：销冠站点/龙头区域/刷卡占比/无销售站点/日均值/环比/同比），新增中俄 i18n 键
- 客户端（零售·月度）：修复环比/同比计算错误（后端 `calc_change` 已返回百分比值，去除多余的 `(x-1)*100`）
- 客户端（零售·油品）：新增 `normalizeResources` 归一（109→106 别名、固定油品顺序、剔除"其他"、同环比取均值），对比图改为纵向柱状（% 轴）
- 客户端（批发·查询 / 称重列表）：补全分类标签与颜色（出口/本地批发、外运、代加工、加工、采购、外运、未知），发货/收货单位为空显示占位符 `--`
- 后端（OilStation·站点日查询）：新增 `cashSales`/`cardSales` 每日列（`report_cash_amount_expr` / `report_card_amount_expr`），供客户端刷卡比例趋势使用

### 2026-07-12 (v3.1.4)

- 客户端：新增独立窗口标题栏（Windows 风格最小化/最大化/关闭），去除重复的语言切换与退出登录
- 客户端：内容区头部只保留语言切换 + 退出登录，移除红/黄/绿圆形窗口按钮
- 客户端：删除零售/批发布局重复的顶部栏
- 客户端：内容区改为可滚动容器（Content overflow:auto），支持鼠标上下滑动
- 客户端：登录页添加窗口标题栏（无边框窗口可移动/关闭）
- 客户端：修复称重审核无数据（res.data.items → res.items）

### 2026-07-11 (v3.1.3)

- 客户端：无边框窗口 + 自定义标题栏（Electron frame: false + 拖拽区 + 窗口控制按钮）
- 客户端：修复批发查询页面无数据（res.data.items → res.items）
- 客户端：修复零售区域页面无数据（ZH_REGION_KEY 反向映射）
- 客户端：修复站点同区域对比图（从 stations 筛选同区域）
- 客户端：修复站点刷卡比例（从 summary.cardSales/amount 计算）
- 客户端：修复油品排行无数据（yoyAmount/momAmount → yoySales/momSales）
- 客户端：去除外层容器嵌套，统一视口高度（AppLayout/Content 布局优化）
- 客户端：添加 CSS 重置消除 body margin/padding

### 2026-07-11 (v3.1.0)

- 基础设施：Typer CLI + Loguru + pydantic-settings 替代原生 logging + argparse
- 双端统一：后端 response.py（ok/fail 格式），HttpClient 自动解包 data 字段
- 四层重构：OilStation 后端按 controller/service/common/query 模式拆分（KPI / analytics / export / analysis_report）
- Electron 客户端：fetch 401 自动跳转登录，错误消息提取优化

### 2026-07-11 (v3.0.8)

- 修复：称重 KPI 条数与重量不匹配（后端返回 totalWeight 全量汇总）
- 新增：数据录入改为 Excel 批量编辑模式（点编辑进入编辑模式，可多行录入后统一保存）

### 2026-07-11 (v3.0.7)

- 修复：所有趋势图悬停提示改为显示实际数值（跟随 web 版模式）
- 修复：零售区域页面空白（API 返回中文区域名，客户端用 ZH_REGION_KEY 反向映射）
- 修复：零售总览区域颜色不显示（中文区域名→英文 key 映射）
- 修复：站点页面累计销量/累计金额 NaN 问题

### 2026-07-10 (v3.0.6)

- 修复：批发查询 API 路径拆分（概览用 `/api`，查询用 `/api/v2`），数据正常联动
- 修复：采购吨位列数据是公斤，改为 kg 显示
- 修复：用户角色列非管理员显示空白问题
- 修复：角色权限模块列添加中俄文对照映射

### 2026-07-10 (v3.0.5)

- 修复：批发查询 API 路径错误（`/api` → `/api/v2`），数据未联动
- 修复：采购查询吨位列数据为空（weightKg→weightTons）
- 修复：称重审核条数 KPI 名称显示问题
- 修复：仪表板零售 KPI 标注"零售累计销售额/零售累计销量"，金额加 сом 单位
- 修复：角色权限模块列切换俄语后仍显示中文
- 修复：用户角色列大小写兼容

### 2026-07-10 (v3.0.4)

- 仪表板：KPI 改为年数据（年批发/年采购）
- 语言切换：点击按钮直接切换中俄，无需下拉选择
- 零售：菜单文字改为"零售"；总览区域颜色美化；站点默认加载第一个站点
- 零售：预警页全量俄语翻译（规则/建议/提示）
- 零售：油品日历默认显示当月
- 批发客户排行：移除采购/代加工数据
- 批发外运详情：按外运量排序 KPI，REG-07→STN-63
- 采购查询：数据单位改为 kg 与称重管理统一
- 称重审核：KPI 重量单位改为 kg（原为 т）
- 用户管理：角色列大小写兼容修复
- 右侧内容区：移除多余滚动条

### 2026-07-10 (v3.0.3)

- 修复：仪表板 KPI 左右列等宽 12:12 + 2 列排布，底部对齐
- 修复：趋势图颜色改用明亮色板（蓝/绿/橙/紫/青/玫红/金/亮绿）
- 修复：所有趋势图 X 轴添加"日期"单位说明
- 修复：地名/站名/产品名随语言切换（俄语下显示俄文名称）
- 修复：右侧内容区统一单滚动容器，消除双滚动条
- 修复：左侧菜单展开子菜单后支持下滑到底部

### 2026-07-10 (v3.0.0-3.0.2)

- 3.0.2：修复零售报表导出、批发KPI高度、数据录入表格样式
- 3.0.1：修复各页面 i18n 键缺失
- 3.0.0：零售板块重构为 7 页大类菜单（总览/区域/站点/月度/油品/报表/预警）；新增批发板块 6 页；架构重构（统一 HTTP 层、React Query、共享组件库、路由懒加载）

### 2026-07-09 (v2.x)

- 2.7.0：侧边栏菜单重构，别名管理移入管理菜单
- 2.6.x：多轮修复（分析报告下载、3D 地图、IPC 下载、版本号管理）
- 2.5.0：仪表板 KPI 布局重构，市场观察卡片优化
- 2.4.0：浅色主题，自定义 logo 与应用图标
- 2.3.0：Electron 自动更新功能

### 2026-07-08 (v2.2.1)

- 修复：3D 地图标点悬停不显示站点信息（加载 kgz-map.css）
- 修复：3D 地图客户点位不显示（mountHomeMap 参数映射修复）
- 修复：Electron CSP 警告（添加 Content-Security-Policy）
- 修复：React Router v7 迁移警告（HashRouter 添加 future 配置）
- 优化：CORS 手工处理替代 Flask-CORS（修复跨域问题）
- 优化：Three.js Clock → Timer 废弃警告修复
- 优化：仪表板市场观察卡片显示真实数据

### 2026-06-17

- 全量清理：移除 Sales/ 旧 HTML + styles.css + app_nav.js；移除根目录旧 .bat 脚本；清空 OilStation/ 非运行时文件至 _archive/；更新 nginx.conf 旧路由为 301 跳转；删除 Flask 遗留路由；修复快照刷新脚本断链引用；更新 /api/retail/pages 为 SPA 路径。
- 零售模块（768px/480px）手机响应式适配：
  - 总览/月度/报表/预警页面：多列网格收窄为单列，面板高度适配小屏，报表 `tfoot` 固定底部显示合计
  - 区域/站点/油品页面：左侧列 `flex:1` 面板在自动高度容器中坍缩修复（`flex:none!important`），各图表面板显式高度 260px 确保 `height:100%` 正确计算
  - 全局：`.retail-shell` 在 768px 下 `overflow-y:auto` 允许页面滚动，子容器 `overflow:visible` 避免内容裁剪
- 已知遗留差距（计划后续修复）：
  - **WholesalePanel**：缺少整理工作流信息行、批发明细缺少 `productName` 字段、整理/去重结果详情展示
  - **HealthPanel**：快照状态缺少"最近完成月日销表"行和文件明细
  - **SystemPanel**：缺少"系统管理"标题栏和 `admin-tab active` CSS 类
  - **ContractsPanel**：价格列缺少"含物流"/"不含物流"标签
  - **RetailDashboard**：缺少年度日销趋势图

### 2026-06-17b (经营助手增强)

- 经营助手新增查询类型，覆盖全项目：
  - **趋势查询**：`本月每日销量趋势` → 读取 `daily_YYYY-MM.json` 日趋势快照，返回每日销量/金额明细及最高/最低日分析
  - **同比环比**：`本月同比环比` → 读取月度快照 `comparison` 字段，返回金额/销量同比（较上年同月）和环比（较上月）变化
  - **站点状态**：`当前停业站点` → 查询 `retail_station_status` 表，返回停业/异常站点列表及原因
  - **油品占比**：`本月油品占比` → 按油品计算销量/金额占比
  - **年度KPI**：`2026年KPI` → 读取 `kpi_yearly_YYYY_summary.json` 快照，返回累计销量/金额/交易笔数/活跃站点及同比
- 前端新增 12 个快捷按钮（停业站点、同比、油品占比、月趋势、年KPI、合计等）
- 提问示例更新：支持 `本月每日趋势`、`同比环比`、`停业站点`、`油品占比`、`年度KPI` 等自然语言问题

### 2026-07-01（批发看板全功能整改 + T+1修复 + 数据验证）

- 四规则分类全面完成：49,340 条全部自动分类，零 `needs_review`
- 称重明细表格对齐模板 9 列（序号/入厂日期/油品名称/磅单号/车号/油品所属公司/供应商/客户/过磅重量/备注）
- DB `wholesale_detail_records` 新增 `weigh_serial_no`、`sender_name` 列
- 后端生成端点加 3 字段存储 + 自动审核逻辑 + 执行看板排序参数
- 后端新增 `POST /api/admin/weigh/auto-audit` 一键自动审核端点
- 后端 weigh-details API 增加 weighSerialNo/senderName/remark 字段 + 5 种当前筛选参数（车号/客户/油品/分类/匹配状态；审核状态为历史字段）
- 后端 export API 改为模板 9 列，正月完整月份下载（不随筛选变化）
- 前端 WeighDetailTab 全重写为模板 9 列表格 + 过滤栏（车号/客户/油品/分类/匹配状态）+ 生成报表按钮
- 前端 AuditPanel 新增绿色一键自动审核按钮
- 前端 ExecutionPanel 新增排序下拉、超量行红底、到期未完成橙底、合同号可点击跳转、统计卡片联动
- 前端 WeighPanel 新增日期范围筛选
- 前端 Vite 构建通过（80 modules, 213ms），Python 语法检查通过
- 导出 `批发客户名单.xlsx`（本地批发 1064 客户 + 出口批发 10 客户）
- 零售 T+1 数据延迟修复：`new Date()` 改为 `Date.now() - 86400000`
- 零售数据全链路验证通过：POS 源文件(АЗС-27) 13 月累计(2025-06→2026-06)问题查明，全站 6 月快照 vs DB selling 表经 `NOT IN (2,4)` 过滤后全部匹配
- DerivedPaymentTypeKey 映射完整梳理：0=现金销售、2=自用油(排除)、3=合同销售(талоны/保留)、4=标定(поверки/排除)、5=银行卡/油卡、8=现金记账/赊销
- SQL 过滤条件 `NOT IN (2, 4)` 确认正确，无需修改；快照刷新脚本 `scripts/refresh_current_snapshots.py:339` 保持一致

### 2026-06-14

- 完成 React + Vite 前端迁移，所有页面从内联 HTML/JS 改为 React SPA 构建。
- 部署 Nginx 1.26.3 作为反向代理：静态文件服务 + API 转发到 Flask :8900。
- 访问地址新增 `http://localhost`（Nginx :80），原 `http://127.0.0.1:8900`（Flask）保留兼容；2026-08-01 起生产推荐入口为 `https://sales.example.com`。
- 新增前端项目目录 `frontend/`，包含 React 源码、Vite 构建配置和部署脚本。
- 首页 3D 地图尺寸固定为 650px，国家模型水平偏移 `viewOffsetX: -4.0` 避免道路面板遮挡。
- 新增运维脚本：`deploy-production.ps1`（一键构建部署）、`nginx-ctl.ps1`（Nginx 控制）、`register-nginx-task.ps1`（开机自启）。

### 2026-06-06

- 修复市场观察自动任务在乌兹别克央行 `KGS` 汇率接口超时时整体失败的问题。
- 市场观察新增降级容错：`UZEX` 成品油行情仍会保存，汇率接口不可用时先显示原始报价，接口恢复后可在后台重新获取并换算为 `索姆/升`。
- 验证市场观察手动执行成功：抓取 `3` 项、更新 `3` 项、错误 `0`。
- 重启生产服务并完成健康检查，系统健康检查 `12/12` 通过。

## 访问地址

- **生产访问（Nginx）**：`https://sales.example.com`（推荐，HTTPS 域名入口）
- HTTP 域名入口：访问后 308 跳转到 `https://sales.example.com/`
- 本机访问：`http://localhost`
- Flask 直连：`http://127.0.0.1:8900/`（兼容保留）
- 零售总览：`https://sales.example.com/retail`
- 后台管理：`https://sales.example.com/admin`
- HTTPS：已启用，生产推荐入口为 `https://sales.example.com/`。

所有业务页面均需要登录。普通用户可查看主页、批发、零售等数据页面；管理员可进入后台维护系统。

## 目录结构

```
SalesVisualization/
│
├── frontend/                  React 19 + Vite 8 前端 SPA
│   ├── src/                   源码（页面/组件/API/工具/样式）
│   ├── dist/                  构建产物 → Nginx/Flask 静态服务
│   └── index.html             Vite 开发入口
│
├── Sales/                     Flask 后端（主服务）
│   ├── api.py                 路由入口 → API / auth / admin / SPA / 代理
│   ├── retail_internal.py     嵌入 OilStation 子应用
│   ├── calculations.py        批发计算逻辑
│   ├── analysis_reports.py    分析报告路由
│   ├── summary_service.py     批发汇总服务
│   ├── wholesale_service.py   汇率/批发页面服务
│   ├── daily_maintenance.py   计划任务维护
│   ├── scripts/               生产脚本（重启/注册/数据导入等）
│   └── run_production.py      生产入口（Waitress）
│
├── OilStation/                嵌入的零售数据源（精简运行时）
│   ├── api.py                 零售接口实现（被 Sales 嵌入）
│   ├── routes/                分析/报表/KPI/导出路由
│   ├── scripts/               快照刷新脚本
│   ├── echarts.min.js         ECharts 库（前端 SPA 加载）
│   ├── kgz_merged.json        KGZ 地图 GeoJSON
│   └── cache_snapshots/       快照缓存目录
│
├── assets/kgz-map/            3D 吉尔吉斯地图模块
│
├── _archive/                  旧版 HTML/静态文件归档
│   ├── Sales/                旧 Sales 页面（index/login/admin/wholesale）
│   └── OilStation/           旧 OilStation 页面 + 文档 + 测试
│
├── nginx.conf                 生产 Nginx 反向代理配置
└── deploy-production.ps1      一键构建+部署脚本
```

## 项目架构

### 总体架构

```text
┌──────────┐   HTTP :80    ┌────────────┐  反向代理   ┌──────────────────┐
│  浏览器   │ ───────────→ │   Nginx    │ ────────→ │  Flask :8900     │
│ (PC/手机) │ ←─────────── │ (静态文件) │ ←──────── │  (API 后端)      │
└──────────┘               └────────────┘            └────────┬─────────┘
                                    │                         │
                                    │ / → frontend/dist/       │ MySQL
                                    │   (React SPA)           │ sales_visualization
                                    │                         ▼
                                    │ /api/* → Flask :8900  ┌──────────┐
                                    │ /legacy/* → Flask     │  OilStation  │
                                    │                         │ (嵌入数据源) │
                                    │                         └──────────┘
```

- **Nginx（:80）**：静态文件服务（React SPA 构建产物）+ API 反向代理到 Flask
- **Flask（:8900）**：Waitress 承载，提供 REST API、登录鉴权、文件导出、嵌入 OilStation 零售数据源
- **React SPA**：Vite 构建，输出到 `frontend/dist/`，路由由 React Router 客户端处理
- **MySQL**：`sales_visualization` 数据库，存储零售、批发、汇率、字典等全量数据
- **OilStation**：作为 Python 子模块嵌入 Flask，提供零售数据接口和快照管理

### 前端架构

```text
src/
├── main.jsx                        # 应用入口：ReactDOM.createRoot
├── App.jsx                         # 路由配置：/ → AppLayout, /retail → RetailLayout
├── api/                            # API 请求封装
│   ├── client.js                   #   统一 fetch（credentials:include + 401 跳转）
│   ├── auth.js / retail.js / sales.js / wholesale.js / admin.js
├── components/
│   ├── layout/
│   │   ├── AppLayout.jsx           # 销售/批发/管理共用布局（topbar + outlet）
│   │   ├── RetailLayout.jsx        # 零售暗色布局（header + footer + outlet）
│   │   └── RetailHeaderContext.jsx # 零售 header 控件注册 Context
│   ├── admin/                      # 10+ 管理面板组件
│   ├── wholesale/                  # 批发子组件（BarList, RankList）
│   └── common/                     # AuthGuard, AdminGuard, LoadingSpinner
├── hooks/                          # useAuth, useChart, usePeriod, useApi
├── pages/
│   ├── retail/                     # 7 个零售页面（暗色大屏风格）
│   │   ├── RetailDashboard.jsx     #   总览：KPI + 3D 地图 + 排行 + 趋势
│   │   ├── MonthlyPage.jsx         #   月度：KPI + 趋势 + 油品结构 + 洞察
│   │   ├── RegionPage.jsx          #   区域：区域切换 + 站点排行 + 概览
│   │   ├── StationPage.jsx         #   站点：站点选择 + 6 个分析图表
│   │   ├── ResourcePage.jsx        #   油品：结构 + 同比环比 + 价格趋势
│   │   ├── ReportPage.jsx          #   报表：多维查询 + 导出
│   │   └── AlertPage.jsx           #   预警：停业/库存/趋势 + 运营建议
│   └── sales/                      # 销售/批发/管理页面
│       ├── DashboardPage.jsx       #   主页：KPI + 汇率 + 地图 + 市场观察
│       ├── WholesalePage.jsx       #   批发：8 个 Tab（总览/油品/客户/外运/趋势/审核/汇率/称重明细）
│       ├── AdminPage.jsx           #   管理：9 个 Tab（首页/自动任务/市场/零售/批发合同/财务/资料/健康/系统）
│       └── LoginPage.jsx           #   登录
└── styles/
    ├── global.css                  # 全局 + 销售/管理模块样式
    └── retail.css                  # 零售暗色主题 + 响应式（768px/480px）
```

**双布局架构**：
- **AppLayout**：销售/批发/管理共用，topbar 含标题、模块导航（首页/批发/管理）、年份月份筛选
- **RetailLayout**：零售专用，暗色科技风，header 接受子页面动态注册控件（月份选择、报告按钮等），footer 显示实时滚动动态

**数据流**：
```
页面组件 → useApi / useChart → api/*.js → fetch → Flask API → 快照/数据库 → 响应
                                                                     ↓
                                                               ECharts 图表渲染
```

### 后端架构

```text
Sales/
├── api.py                  # Flask 主应用：路由注册、CORS、session、错误处理
├── run_production.py       # Waitress 生产入口（含缓存预热）
├── config.py               # 数据库/NBKR/密钥配置
├── retail_internal.py      # 嵌入调用 OilStation 零售接口
├── calculations.py         # 批发数据计算（金额换算、合同匹配）
├── summary_service.py      # 主页合并统计（零售+批发合并 KPI）
├── wholesale_service.py    # 批发统计（出口/本地/外运/排行/分布）
├── analysis_reports.py     # 分析报告生成（HTML + Word）
├── daily_maintenance.py    # 自动任务维护（汇率、市场观察、零售快照）
└── scripts/                # 运维脚本
    ├── health_check.py           # 生产服务健康检查（12 项）
    ├── data_call_audit.py        # 数据调用自检（37+ 接口验证）
    ├── backfill_nbkr.py          # NBKR 汇率补齐
    ├── fetch_market_insight.py   # 市场观察获取
    ├── refresh_retail_snapshot.py # 零售快照刷新
    └── backup_project.py         # 项目备份（数据库 + 快照 + 密钥）
```

**OilStation 嵌入**：
```
OilStation/
├── api.py                  # 零售接口入口：路由注册 + 缓存预热
├── cli.py                  # Typer CLI（run / serve / cache-warm）
├── settings.py / log_setup.py / response.py  # 配置/日志/统一响应
├── endpoints/v1/retail/    # 四层模块架构
│   ├── common/query.py     #   共享查询（get_query_date_range / query_month_summary）
│   ├── kpi/                #   KPI 模块：controller + service
│   ├── analytics/          #   分析模块：controller + service/shared + service/core
│   ├── export/             #   导出模块：controller + service/workbook + service/generator
│   └── analysis_report/    #   报表模块：controller + service/common + service/docx
├── routes/                 # 旧路由文件（保留回退）
├── scripts/                # 快照刷新脚本
├── echarts.min.js / kgz_merged.json / cache_snapshots/
```

### 数据管道

```text
[MySQL 原始表] ──→ [零售快照脚本] ──→ [JSON 快照文件] ──→ [Flask API] ──→ [React SPA]
                    每日 08:30 自动         OilStation/              毫秒级读取
                    或后台手动触发          cache_snapshots/
```

**快照类型**：
| 快照 | 频率 | 内容 |
|------|------|------|
| 日快照 | 每日 | 各站点当日销量/金额/刷卡/现金 |
| 月快照 | 每日（刷新当月） | 月度 KPI、站点排行、油品结构 |
| 年派生快照 | 每日 | 年度总览、区域同比环比 |
| 报表辅助快照 | 按需 | 日报/月报 Excel 索引 |

**缓存预热**：Flask 启动时自动加载当前月和年份数据到内存，首次页面打开免慢查询。

### 部署架构

```text
Windows Server (物理机)
├── Nginx (nginx.exe)          :80  → 前台进程，反向代理
├── Flask (pythonw + Waitress) :8900 → Windows 计划任务启动
├── MySQL (mysqld)             :3306 → 数据库
├── Windows Task Scheduler
│   ├── 07:30 汇率 + 市场观察
│   └── 08:30 零售快照
└── 部署脚本
    ├── deploy-production.ps1   # 一键构建+部署
    ├── nginx-ctl.ps1           # Nginx 启停控制
    ├── restart_production_task.ps1  # 重启生产服务（含端口清理）
    └── register-nginx-task.ps1 # Nginx 开机自启
```

### 安全模型

```
浏览器 → Nginx（:80，仅 HTTP） → Flask（:8900，仅本地）
                                        │
                                    ┌───┴───┐
                                    │ Session │ ← Flask session cookie
                                    │ 14 天   │   (HttpOnly)
                                    └────────┘
```

- 所有页面需登录（Session Cookie，14 天有效）
- 普通用户：查看销售/批发/零售页面
- 管理员：额外访问管理菜单（用户、组织权限、审计、别名、称重审核、系统健康等）
- 领导层以查看数据为主，普通员工以录入和修改业务数据为主；具体菜单和数据范围由部门、角色、人员权限共同决定。
- 桌面端开发者控制台快捷键 `Ctrl+Shift+I` 仅管理员登录后生效，非管理员无响应。
- 401 未登录自动跳转 `/login`
- 已启用 HTTPS；账号、密钥、Cookie 时效等隐私配置统一登记于 `docs/配置文档.md`

## 运行方式

生产服务由 Windows 计划任务运行。推荐使用项目重启脚本，它会先停止计划任务，再清理仍占用 `8900` 的旧 `pythonw` 进程，最后重新启动计划任务：

```powershell
powershell -ExecutionPolicy Bypass -File D:\SalesVisualization\Sales\restart_production_task.ps1
```

不建议只手工执行 `Stop-ScheduledTask` / `Start-ScheduledTask`。如果旧进程未退出，页面可能仍运行旧代码，表现为强制刷新后仍显示旧接口结果。

生产入口：

```text
D:\SalesVisualization\Sales\run_production.py
```

监听地址：

```text
127.0.0.1:8900
```

项目已不再拆分 `8900` 和 `8910` 两个后端端口；外部页面与接口统一走 Nginx，后端 API 统一转发到本机 `127.0.0.1:8900`。

### Nginx 生产部署

生产环境由 Nginx 作为反向代理，静态文件服务 + API 转发：

```text
浏览器 → Nginx :80 → frontend/dist/（React SPA）
                     → Flask :8900（/api/* 接口）
                     → Flask :8900（/legacy/* 旧版 HTML，过渡期保留）
                     → Flask :8900（/retail-app/* 零售页面，过渡期保留）
```

一键构建 + 部署：

```powershell
powershell -ExecutionPolicy Bypass -File D:\SalesVisualization\deploy-production.ps1
```

该脚本会自动检测环境、执行 `npm install` + `npm run build`、生成 `nginx.conf`、启动或重载 Nginx。

Nginx 控制：

```powershell
powershell -ExecutionPolicy Bypass -File D:\SalesVisualization\nginx-ctl.ps1 start|stop|restart|reload|status
```

注册开机自启（需管理员权限）：

```powershell
powershell -ExecutionPolicy Bypass -File D:\SalesVisualization\register-nginx-task.ps1
```

## 主要功能

### 主页

- 零售、批发、合并统计 KPI。
- 今日汇率。
- 市场观察。
- 3D 吉尔吉斯斯坦地图。
- 主页地图显示油库和批发客户点位。
- 地图道路信息、点位标签、鼠标悬停高亮与提示。

### 零售板块

- 总览、区域、站点、月度、油品、报表、预警、分析报告。
- 严格沿用零售系统已有逻辑，只统计已结束班组。
- 销售量原始单位为升，同时按密度换算吨位。
- 销售金额原始单位为索姆，同时按历史每日汇率换算人民币。
- 普通柴油除 `ДТ -35` 外统一归集为 `Д/Т`。
- MBank 刷卡与正常刷卡统一归入刷卡销售。
- 年度、月度分析报告支持 HTML 和 Word 输出。
- 零售总览地图显示油库和加油站点位，并支持悬停高亮。

### 批发板块

- 出口批发、本地批发、外运统计。
- 外运仅统计数量，不计算金额。
- 合同金额按合同有效期内登记价格计算。
- 合同未匹配时，已有客户分类的批发数量仍计入出口或本地统计；未能判定类别的数量单列为待审核批发，均不提前计算金额。
- STN-01加油站编号 `001`，外运明细中的 `X-25` 按该站点识别。
- 支持 Excel 上传识别和在线录入。
- 支持合同审核、待复核数据和数据审核。
- 支持客户、油品、油库、加油站名称别名识别；批发油品名称按零售板块口径智能归集，支持 80/92/95、液化气、K5/K3/常柴、催化柴油、油浆等常见写法。
- **称重明细 Tab**：9 列模板化展示（序号/入厂日期/油品名称/磅单号/车号/油品所属公司/供应商/客户/过磅重量/备注），支持车号/客户/油品/分类/匹配状态筛选，按正月完整月份生成 Excel 报表；批发查询和批发录入不再使用审核状态。
- **执行看板**（后台批发合同 → 执行看板）：合同执行进度列表，支持排序（按执行率/数量/金额/合同日期），超量执行行红底、到期未完成行橙底，合同号可点击跳转详情，统计卡片与列表联动。

### 后台管理

- 用户与权限维护。
- 组织权限支持自定义部门、部门数据范围、角色权限和人员权限。
- 汇率维护和一键补齐。
- 市场观察维护和一键获取。
- 站点状态维护。
- 批发数据一键整理：自动保留同月最新批发批次、回滚重复旧批次，并按最新合同重新匹配和计算金额。
- 批发数据一键去重：扫描同一天、同一家公司、同一个车号与同一个重量的重复明细；若油品名称不一致，自动转入数据审核，由运营人员手动复核。
- 油品字典、客户字典、别名维护。
- 密度维护，按生效日期影响后续计算。
- 合同、上传批次、审核、日志、系统健康检查。
- 系统健康页汇总服务状态、API 调用、缓存文件、自动任务和 AI 调用情况，仅管理员可见。
- 一键刷新当前月零售缓存。
- 称重管理（后台批发合同 → 称重原始数据）：上磅/下磅原始记录查看，支持入厂日期范围筛选。
- 审核中心（后台批发合同 → 审核中心）：称重审核 Tab 支持一键自动审核（`product_id` + `entity_code` 已知且 `classification` 合法时自动通过）。
- 执行看板（后台批发合同 → 执行看板）：合同执行进度可视化，红底/橙底条件高亮，排序联动统计。
- 批发客户导出：生成 `批发客户名单.xlsx`（本地 + 出口客户）。

### 数据问答

支持通过全局 AI 助手查询零售、批发、汇率、密度、合同等数据。AI 助手为只读模式，只回答查询问题，不执行修改、删除、导入、导出、刷新、写文件或改代码等操作；当前接入 OpenRouter 免费模型，配置项以 `OPENROUTER_*` 开头，后续可替换为本地模型。典型问题包括：

- 上周销量。
- 本月销量。
- 2026 年 4 月销量。
- 出口批发量。
- 本地批发量。
- 汇率数据。
- 密度数据。
- 合同信息。

## 数据口径

- 零售统计只计入已结束班组。
- 当前未结束班组不进入正式统计。
- 零售金额按业务日期对应的历史汇率换算人民币。
- 零售吨位按密度历史记录换算，密度变更只影响生效日期后的计算。
- 批发外运只统计数量，不计算金额。
- 批发合同金额按合同有效期内登记价格计算，不因后续价格变化回算。
- 上传新的合同或批发统计后，可在后台“批发维护”中点击“一键整理批发数据”，统一处理油品智能识别、重复批次、合同匹配、金额重算和待复核提示。
- 对疑似重复录入的批发明细，可在后台“批发维护”中点击“一键去重”；系统只生成审核提示，不会自动删除或修改明细。
- 批发数据源（2025-01-01 切换）：KPI 以 `wholesale_detail_records` 为准，`business_date >= 2025-01-01 且 batch_id IS NOT NULL` 的报表上传/手工录入行为业务来源，称重自动明细（`batch_id IS NULL` 或更早日期）仅作历史；边界由 `Sales/wholesale_source_policy.py` 的 `WHOLESALE_SOURCE_CUTOFF = date(2025,1,1)` 控制。
- 批发五分类（权威口径见 `docs/客户名及自有站点名维护.md`）：外购文件 → `procurement`；外运站点（零售板块目录 30 站 + 2 油库）→ `transfer`；外销/外运文件中收货方按 `customers.customer_type` 拆 `local_wholesale`/`export_wholesale`；代加工独立保留 `processing`；内部用油 `other`。
- 汇率来源以吉尔吉斯斯坦国家银行 NBKR 为准。
- 汇率缺失时进入待补齐状态，可后台一键获取或人工录入。

## 快照与加载速度

当前系统已建立快照优先策略，页面默认优先读取快照，只有快照缺失或强制刷新时才查数据库。

快照目录：

```text
D:\SalesVisualization\OilStation\cache_snapshots
```

主要快照：

- `monthly/monthly_YYYY-MM.json`：月度汇总快照。
- `monthly/stations_YYYY-MM.json`：月度站点快照。
- `monthly/regions_YYYY-MM.json`：月度区域快照。
- `monthly/daily_YYYY-MM.json`：月内每日趋势快照。
- `daily/day_YYYY-MM-DD.json`：每日完整快照。
- `report_extras/report_extras_YYYY-MM.json`：报表辅助快照。
- `exports/.monthly_report_index.json`：已生成零售月度日销表索引，用于直接下载复用，避免逐个扫描 Excel 文件。
- 零售月份/年份选择列表由现有月份快照生成并在服务启动时预热，不再扫描原始销售表。
- 区域快照使用前月和上年同月快照补齐环比、同比字段，避免快照模式下区域分析字段缺失。

从 `2026-05-01` 开始，系统生成每日完整快照。当前月快照有效期为 30 小时；如果磁盘快照在有效期内被自动任务更新，服务会自动识别并读取新快照，不会被旧内存缓存阻挡。

`2026-05-31` 维护后，零售快照链路已调整为“先强制刷新当月日销表，再生成日/月/年快照”。当前月日销表索引会记录最新文件和最后数据日，后台系统健康页可直接查看。

实测零售内部接口读取速度为：

- 月份列表首次约 12 ms，再次读取约 1 ms。
- 月度接口约 3 ms。
- 站点接口约 3 ms。
- 区域接口约 6 ms，包含环比、同比补齐。
- 日趋势接口约 4 ms。
- 最新当月日销表强制刷新约 50 秒，后续索引复用约 8 ms。

## 自动任务

当前已注册的 Windows 每日任务：

- `SalesVisualizationDailyExchangeRates`：每天 `07:30` 自动补齐汇率。
- `SalesVisualizationDailyMarketWatch`：每天 `07:30` 自动获取市场观察。
- `SalesVisualizationDailyRetailSnapshots`：每天 `08:30` 先强制刷新当月零售日销表，再生成零售日快照、当前月与年度派生快照，刷新当前月利润快照和年度利润总表快照，并预热区域同比环比数据。
- `SalesVisualizationDailyRetailAccountingReports`：每天 `08:45` 自动生成吉方财务交接日报。
- `SalesVisualizationProduction`：生产服务任务。

注册自动任务：

```powershell
powershell.exe -ExecutionPolicy Bypass -File D:\SalesVisualization\Sales\register_daily_automation_tasks.ps1
```

维护日志：

```text
D:\SalesVisualization\Sales\logs\daily_maintenance.log
```

生产日志：

```text
D:\SalesVisualization\Sales\logs\production.log
```

## 报表与分析报告

零售日报、月报、分析报告输出目录：

```text
D:\SalesVisualization\OilStation\exports
```

批发分析报告、销售分析报告、汇率 Excel 输出目录：

```text
D:\SalesVisualization\Sales\exports
```

当前行为：

- 报表和分析报告继续保存到 `exports/`。
- 外网电脑点击生成时，会在服务器保存文件，同时向访问电脑下载。
- HTML 分析报告会自动打开预览。
- Word 分析报告会自动下载。
- 主页可生成销售分析报告，批发页面可生成批发分析报告，批发汇率页面可保存汇率 Excel。

## 系统健康检查

后台健康检查页面集中查看：

- 主项目服务状态。
- 零售嵌入接口状态。
- 销售数据库状态。
- 运维概览：今日汇率、市场观察、零售快照、最近任务执行。
- 报表辅助快照完整性。
- 零售日快照完整性。
- 当前月短期缓存状态。
- 自动任务状态。
- 自动任务健康只评估当前有效任务集：汇率、市场观察、零售快照、吉方日报；历史 `automation_all` 记录不会作为当前故障。
- 最新汇率日期。
- 最新市场观察日期。
- 日志状态。
- 登录与安全配置。

接口：

```text
/api/admin/system-health
```

后台一键刷新当前月缓存：

```text
/api/admin/system-health/refresh-cache
```

命令行完整检查：

```powershell
C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe D:\SalesVisualization\Sales\scripts\health_check.py --strict-tasks
```

命令行数据调用自检：

```powershell
C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe D:\SalesVisualization\Sales\scripts\data_call_audit.py
```

该脚本会检查运行中的 `8900` 服务、零售日/月/年快照、主页/批发/零售核心数据接口、地图悬停接口和数据问答接口。若页面显示异常但脚本通过，优先检查浏览器缓存、登录态或是否仍有旧进程占用 `8900`。

最近一次全量数据调用自检基线（2026-06-06）：

- 数据调用自检 `37/37` 通过。
- 系统健康检查 `12/12` 通过。
- `2026-06` 日快照当前 `5` 天完整，月度、站点、区域、日趋势和年度派生快照均存在。
- `5月零售销量`、`五月零售销量` 均识别为 `2026-05-01` 至 `2026-05-31`，返回该区间零售销量。
- `上周零售销量`、`本月零售销量`、`2026年零售销量`、`本月批发分类统计`、`今日汇率`、`市场观察` 问答均通过。
- 批发明细 `3150` 条当前无未识别油品；典型批发油品名称可按零售口径智能归集。
- 批发/销售年度与月度 Word 分析报告均使用新版居中表格格式；HTML 报告使用零售月报同类 KPI + 卡片 + 明细表结构。
- 汇率 Excel 当前列为日期、美元/索姆、人民币/索姆、索姆/人民币、数据来源、获取时间；列宽自适应、单元格居中、黑色框线。
- 预警页 `/api/kpi` 已改为优先读取已完成月份快照，当前来源为 `monthly_snapshot`。

读取 Windows 计划任务状态需要在服务器上以具备任务读取权限的会话运行。后台健康页已做双来源判断：能读取 Windows 任务时显示计划任务状态；读取受限时，会标注“受限”，并使用后台自动任务执行记录、服务状态和快照更新时间判断任务是否实际运行。

## 3D 地图

地图资源目录：

```text
D:\SalesVisualization\assets\kgz-map
```

2026-07-22 已从 `D:\map` 提取高精度地图内容，同步到：

- `assets/kgz-map/data/`：Web 生产静态资源路径，Nginx 同时通过 `/kgz-map/` 提供别名。
- `SalesDesktop/public/kgz-map/data/`：Electron/Vite 客户端静态资源路径。
- `SalesDesktop/src/lib/kgz-map/`：桌面端直接 import 的 Three.js 地图库。

本次升级将吉国行政区、国界、湖泊、道路和全球国家边界替换为更高精度 GeoJSON，并新增 `precision_countries.geojson` 与 `manifest.json`。3D 吉国地图坐标换算改为本地 Web Mercator 投影，保留现有油库、加油站、批发客户点位和库存/价格 Tooltip；行政区填充继续使用项目原有统一深色，不读取高精度数据里的分区 `color_hex`；地球视图保留现有业务点位和中俄文标签，并额外叠加高精度国家边界，基础全球边界会按 ISO3 和空间位置跳过已由高精度包覆盖的国家/边界段，高精度包内共享边界也会去重，避免中国等国家出现多线叠加。

当前使用范围：

- 主页：显示油库和批发客户点位。
- 零售总览：显示油库和加油站点位。

当前能力：

- 3D 吉尔吉斯斯坦底图。
- 区域轮廓。
- 道路信息。
- 湖泊和主要城市。
- 点位标签。
- 鼠标悬停点位高亮。
- 悬停提示信息。
- 旧 ECharts 地图回退能力。

## 备份

执行本地备份：

```powershell
cd D:\SalesVisualization
C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe Sales\scripts\backup_project.py
```

默认备份目录：

```text
D:\SalesVisualization\backups
```

备份内容：

- `sales_visualization` 数据库 SQL 备份。
- `OilStation/exports` 报表与分析报告。
- `OilStation/cache_snapshots` 快照。
- `Sales/.runtime` 运行密钥（详见 `docs/配置文档.md`）。
- README 和docs。

默认清理 30 天以前的同类备份，可通过 `--keep-days` 调整。

## 前端架构

当前前端已从内联 HTML/JS 迁移为 React + Vite 构建：

- **框架**：React 19 + React Router 7 + Vite 8
- **构建**：`npm run build` 产出 `frontend/dist/`，由 Nginx 静态服务
- **开发**：`npm run dev` 启动 Vite dev server（:5173），API 代理到 Flask :8900
- **图表**：ECharts 通过全局 `window.echarts` 使用，不打包进 bundle
- **3D 地图**：动态 import `/assets/kgz-map/` 模块，不修改原有 Three.js 代码
- **认证**：Session Cookie 兼容，`credentials: 'include'`

路由结构：

- `/login`：登录页
- `/`：销售主页（KPI + 汇率 + 市场观察 + 3D 地图）
- `/wholesale`：批发板块（8 个 Tab，含称重明细）
- `/admin`：管理后台（11 个面板组件）
- `/retail`：零售总览
- `/retail/station`、`/retail/region`、`/retail/monthly`、`/retail/resource`、`/retail/report`、`/retail/alert`：零售子页面
- `/legacy/*`：旧版 HTML 页面（仅保留跳转，不再主动使用）

### 迁移完成度

| 旧版 HTML 文件 | React 等价页面 | 状态 |
|---|---|---|
| `Sales/index.html` | `DashboardPage.jsx` | ✅ 已迁移 |
| `Sales/login.html` | `LoginPage.jsx` | ✅ 已迁移 |
| `Sales/admin.html` | `AdminPage.jsx` + 9 Tab（批发合同含 4 子面板） | ✅ 已迁移（差距见下方） |
| `Sales/wholesale.html` | `WholesalePage.jsx` + 7 Tab 组件 | ✅ 已迁移 |
| `OilStation/dashboard.html` | `RetailDashboard.jsx` | ✅ 已迁移 |
| `OilStation/region.html` | `RegionPage.jsx` | ✅ 已迁移 |
| `OilStation/station.html` | `StationPage.jsx` | ✅ 已迁移 |
| `OilStation/monthly.html` | `MonthlyPage.jsx` | ✅ 已迁移 |
| `OilStation/resource.html` | `ResourcePage.jsx` | ✅ 已迁移 |
| `OilStation/report.html` | `ReportPage.jsx` | ✅ 已迁移 |
| `OilStation/alert.html` | `AlertPage.jsx` | ✅ 已迁移 |

**已知迁移差距**（优先级由高到低）：

1. **ReferencePanel 实体标准选择器** — 旧版 admin.html 的`实体别名`表单有实体类型选择+自动填充标准名称功能，React 版缺少。
2. **HealthPanel 运维摘要卡片** — 旧版显示 4 张状态卡片（汇率、市场、快照、任务），React 版未实现。
3. **部分 API 函数缺命名导出** — `POST /api/admin/product-aliases`、`POST /api/densities` 无封装函数，直接调用 `post()`。

## Electron 桌面客户端

```
SalesDesktop/
├── package.json              # 版本 3.10.0（与 version.ts 对齐）
├── vite.config.ts            # Vite 构建配置
├── electron/
│   ├── main.cjs              # Electron 主进程（窗口管理 + IPC + 自动更新）
│   ├── preload.cjs           # 预加载脚本（contextBridge 桥接）
│   └── builder-config.cjs    # electron-builder 配置
├── src/
│   ├── main.tsx              # React 入口
│   ├── App.tsx               # 路由 + 布局
│   ├── version.ts            # 版本号 + CHANGELOG
│   ├── api/
│   │   ├── http.ts           # Axios 封装（JWT Token + 401 跳转 + 自动解包 data）
│   │   ├── client.ts         # 客户端 v2 API 封装
│   │   ├── retail.ts         # 零售 API 封装
│   │   ├── wholesale.ts / procurement.ts / weighing.ts / contracts.ts / ...
│   │   └── export.ts / exchange.ts / transferLoss.ts / ...
│   ├── pages/                # 15+ 页面组件
│   ├── components/           # 通用组件（KpiCard, TableCard, ChartCard, PeriodPicker 等）
│   ├── config/               # 菜单配置 + 路由表
│   ├── i18n/                 # 中俄双语（zh.json / ru.json）
│   ├── types/                # TypeScript 类型定义
│   └── hooks/                # 自定义 hooks
├── dist/                     # Vite 构建产物（dev: :5173, prod: electron loadFile）
├── release_build/            # 安装包输出目录
└── download/                 # Nginx /download/ 专用发布目录（latest.yml + 当前安装包）
```

**架构特点**：
- **双端统一**：客户端默认直连生产 HTTPS 域名入口（由 Nginx 转发到本机后端 `127.0.0.1:8900`），备用入口保留兜底，不走本地服务器
- **双认证**：JWT Token（客户端）+ Session Cookie（Web 端），后端统一校验
- **响应解包**：`http.ts` 自动解 `res.data.data → res.data`，API 封装层无感
- **自动更新**：electron-updater + `latest.yml`，设置页触发检查更新
- **401 处理**：interceptor 自动清 Token 跳登录页，错误消息统一提取

## 后续优化方向

- HTTPS 正式证书已启用；4.0.0 源码线默认 Secure Cookie，HTTP 域名入口跳转 HTTPS。
- 继续扩展异常销量、异常价格、汇率缺失、快照滞后的主动提醒。
- 建立月度归档和自动备份策略。
- 对首页、批发、零售和后台继续做小步视觉精修，避免大规模重构影响稳定。
- 数据问答继续扩展经营问题模板，并通过项目级覆盖评测保持表格优先展示。
- 补全迁移差距：ReferencePanel 实体标准选择器、HealthPanel 摘要卡片、API 函数导出。
- 移除 `/legacy/*` 路由、Flask 旧 HTML 服务路由及旧版 `admin.html`/`wholesale.html` 等直接服务文件（当前阶段建议保留维护期）。

## 界面美化方案

当前项目建议走“稳重经营驾驶舱”风格，不再做大面积炫光或复杂动画，重点提高领导查看时的清晰度和质感。

### 主页

- 保留第一屏 KPI + 今日汇率 + 市场观察 + 3D 地图的结构。
- KPI 卡片做成更统一的经营指标样式：大数字、单位、同比/环比、更新时间四层信息。
- 今日汇率保持小而精，市场观察增强信息层级：区域、市场行情、原料油、成品油、价格影响。
- 3D 地图减少视觉噪音，点位高亮、标签和 Tooltip 做得更清楚，默认视角避免遮挡地图边界。

### 批发

- 批发页面偏“业务分析台”：分类、客户、油品、外运、审核各模块用统一图表卡片。
- 出口批发、本地批发、外运使用固定颜色和图标，所有页面保持一致。
- 审核类数据突出“待处理数量、影响吨数、影响金额、处理入口”。

### 零售

- 零售页面偏“运营看板”：总览、站点、区域、油品、月度、报表保持同一套深色主题。
- 站点和区域排行增加更清晰的排序标识，减少表格拥挤。
- 地图 Tooltip 保留库存和价格，但排版更像小型信息卡。

### 后台

- 后台偏“运维控制台”：少装饰、强分组、按钮状态明确。
- 系统健康页继续强化为第一入口，显示今日状态、任务状态、快照状态、异常提示。
- 所有一键操作按钮增加执行中、成功、失败和最近执行时间，降低误操作。

### 移动端

- 手机端优先保证主页、零售总览和数据问答可读。
- 表格默认横向滚动，不强行压缩到多行。
- 后台主要适配电脑和平板，不建议为手机端做复杂维护操作。

## 发布版维护

当前项目已进入稳定运行阶段，日常维护建议以后台为主：

- 汇率、市场观察、零售/自用油/利润快照可在后台“自动任务”中手动执行。
- 服务、快照、日志、安全配置和任务状态可在后台“系统健康”中查看。
- 若 Windows 计划任务读取显示“受限”，优先查看最近自动任务记录和日志，不必立即判断为任务失败。
- 发布前可清理 `__pycache__`、`.pytest_cache` 和空日志文件；不要清理 `cache_snapshots`、`exports`、`logs` 中的有效运行数据。

## 当前运行方案

零售页面的日常访问链路已经固定为“自动任务生成快照，页面读取快照”：

1. `07:30` 获取汇率和市场观察信息。
2. `08:30` 按“昨天所属月份”强制刷新日销表 Excel，保证跨月第 1 天会补齐上月最后一天。
3. 日销表刷新成功后，生成当月每日快照、当月页面快照、年度派生快照、当前月/年度利润快照和区域同比环比数据。
4. 后台自动任务记录写入 `automation_task_runs`，系统健康页可查看最近执行状态。
5. 服务启动时预热月份、年份、年度总览及当前月核心接口。
6. 月度、区域、报表页面打开时并行读取当前月快照；历史月份直接使用已归档快照。
7. 日销 Excel 报表通过索引复用；自动快照任务每日强制刷新一次最近已完成销售日所属月份的报表，保证快照口径跟随最新报表。

零售快照链路：

```text
零售数据库 -> 当月日销表 Excel -> 日快照 day_YYYY-MM-DD -> 月快照 monthly/stations/regions/daily -> 年度派生快照 dashboard/resources/kpi -> 利润月度/年度快照
```

如果数据库当天补录或修正后需要立即展示最新数据，可在后台“自动任务”执行“立即刷新零售/自用油/利润快照”；正常情况下无需每天手动点击。

异常处理顺序：

1. 后台系统健康页查看任务、快照日期与日志。
2. 数据已更新但页面未变化时，执行“刷新当前月缓存”。
3. 自动任务中断时，执行“立即刷新零售/自用油/利润快照”。
4. 服务无法访问时，运行 `D:\SalesVisualization\ops-restart-service.bat`。

后台“立即刷新零售/自用油/利润快照”已采用后台执行与单实例保护：按钮提交后立即返回执行状态；自动任务或人工刷新已经在运行时，再次点击不会重复启动任务，也不会让报表生成阻塞快照更新。

## 自助运维入口

后台已经把常用维护动作集中到页面内，正常情况下不需要打开 Codex：

- 后台 `自动任务` 页面：可手动执行 `立即补齐汇率`、`立即获取市场观察`、`立即刷新零售/自用油/利润快照`、`执行全部自动任务`。
- 后台 `系统健康` 页面：可查看服务、数据库、快照、日志和计划任务状态。
- 后台 `系统健康` 页面：可提交 `重启生产服务`，提交后约 20 秒恢复访问。
- 后台 `系统健康` 页面：可执行 `刷新当前月缓存`，用于手动刷新零售当前月短期缓存。

如果网页服务本身不可访问，可以在服务器电脑上双击项目根目录下的脚本：

```text
D:\SalesVisualization\ops-restart-service.bat
D:\SalesVisualization\ops-fetch-data.bat
D:\SalesVisualization\ops-refresh-retail-snapshots.bat
```

三个脚本分别用于重启生产服务、补齐汇率与市场观察、刷新零售快照。

## 数据问答

数据问答已升级为全局只读 AI 助手。回答会优先基于系统已有接口和快照数据整理，表格数据会尽量放在同一行，便于在电脑、手机和平板上查看。助手只处理查询和解释类问题；涉及修改项目代码、文件、合同、缓存、业务数据或执行导入导出等动作时会直接拒绝。

当前支持的经营问题包括：

- 零售销量、油品结构、站点排行、区域排行。
- 批发总量、出口批发、本地批发、外运统计。
- 批发客户排行、批发油品排行、外运区域汇总。
- 合并统计、汇率、密度、合同、审核提示、市场观察。

零售问答和合并统计中的零售部分优先读取快照，不再优先扫零售数据库；快照缺失时才回退到接口实时查询。

## 市场观察自动任务

市场观察采用非中国境内的官方或公开市场来源，覆盖俄罗斯、乌兹别克和国际市场。自动任务会在获取后做中文整理：

- 统一地区名称为 `俄罗斯`、`乌兹别克`、`国际`。
- 统一原油、成品油、炼厂、库存、制裁、出口等常用术语。
- 过滤明显不适合展示的英文尾注和来源重复。
- 首页和数据问答均优先显示中文整理后的内容。
- 乌兹别克成品油报价来自 `UZEX` 官网公开报价，按乌兹别克央行 `KGS` 汇率和系统中对应油品生效密度换算为 `索姆/升`，页面保留来源链接与换算说明。
- 国际原油价格自动获取 `Brent` 与 `WTI` 基准报价。
- 俄罗斯市场以 `SPIMEX` 官方指数入口为参考；其指数数值再展示受许可要求约束，取得许可前不自动转载数值。

每日自动任务时间：

- `07:30`：补齐汇率。
- `07:30`：获取并整理市场观察。
- `08:30`：生成零售日快照、当前月/年度汇总快照、当前月利润快照、年度利润总表快照、区域同比环比数据，并同步生成零售预警趋势异常和运营建议；Excel 日销报表按需生成并复用已有索引。
## 2026-08-01 Current Deployment Status

- Production HTTPS is enabled: `https://sales.example.com/`.
- HTTP domain traffic redirects to HTTPS; backup endpoint and certificate paths are kept only in `docs/配置文档.md`.
- SalesDesktop source version is now `5.6.0` (packaged and deployed for the 装卸车明细 bilingual Excel alignment + transfer-entity routing release); the publicly deployed line is now `5.6.0`. New packaged builds default to the HTTPS API and update feed, upgrade legacy public HTTP config to HTTPS, and keep manual fallback details only in configuration.
- System Health now includes a manual task for generating the previous completed month's original-software 254 monthly archive on the server; it saves in place and does not download a package to the client.
- SalesWallpaperEngine source version is now `0.2.23`; the wallpaper line moved independently through 0.2.13–0.2.21 (system WebView2 runtime convergence, inventory panel/sellable-days polish, WH_MOUSE_LL wheel hook, localized station names, bundled-key persistence across auto-updates) and the public feed points to `0.2.23`.
