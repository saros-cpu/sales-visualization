# Sales 总项目说明

目录：`D:\SalesVisualization\Sales`

该目录是销售板块可视化平台的总项目，负责主页、批发、合并统计、登录系统、后台管理、自动任务和零售板块嵌入。

## 版本更新记录

### 2026-06-14

- 完成 React + Vite 前端迁移，`api.py` 中的 HTML 服务路由已标记为 `DEPRECATED`，过渡期结束后移除。
- 生产环境由 Nginx 反向代理，静态文件服务 + API 转发。Flask 仅监听 127.0.0.1:8900 作为 API 后端运行。
- 访问地址新增 `http://localhost`（Nginx :80）；`http://127.0.0.1:8900` 仅保留本机调试直连。

### 2026-06-06

- 市场观察维护增加外部接口容错：乌兹别克央行 `KGS` 汇率接口超时时，不再导致整个市场观察任务失败。
- `UZEX` 成品油报价在汇率换算失败时会保留原始报价，待汇率接口恢复后可通过后台“立即获取市场观察”重新换算为 `索姆/升`。
- 已补跑市场观察任务并写入成功记录，最近一次结果为抓取 `3` 项、更新 `3` 项、错误 `0`。
- 已重启 `SalesVisualizationProduction` 生产服务，并完成健康检查 `12/12`。

## 运行入口

生产入口：

```powershell
cd D:\SalesVisualization\Sales
C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe run_production.py
```

当前生产环境由 Windows 计划任务启动，默认监听：

```text
127.0.0.1:8900
```

推荐重启方式：

```powershell
powershell -ExecutionPolicy Bypass -File D:\SalesVisualization\Sales\restart_production_task.ps1
```

该脚本会清理旧的 `8900` 监听进程后再启动计划任务，避免旧 `pythonw` 进程继续占用端口导致页面仍加载旧代码。

## 主要文件

- `api.py`：Flask 应用，包含 API 接口、登录鉴权、零售接口代理；旧 HTML 服务路由已标记 `DEPRECATED`。
- `run_production.py`：生产服务入口，使用 Waitress，启动后预热零售核心缓存。
- `config.py`：数据库、NBKR、运行密钥等配置。
- `summary_service.py`：主页合并统计。
- `wholesale_service.py`：批发页面统计。
- `retail_internal.py`：嵌入调用零售板块接口。
- `scripts/`：初始化、导入、汇率、市场观察、健康检查等脚本。
- `logs/`：生产日志和自动维护日志。
- `exports/`：批发分析报告、销售分析报告和汇率 Excel 导出文件。
- `../frontend/`：React + Vite 前端项目（构建产物在 `frontend/dist/`，由 Nginx 服务）。

## 后台管理

后台地址：

```text
http://localhost/admin
```

## 登录策略

- 所有业务页面必须先登录。
- 普通用户登录后可以查看主页、批发、零售页面。
- 管理员登录后可以进入后台。
- 登录保持时间默认 14 天，可用 `SALES_LOGIN_REMEMBER_DAYS` 调整。
- 登录失败、登录成功、退出登录会记录到操作日志。

后台功能包括：

- 用户权限
- 零售站点状态
- 市场观察
- 批发客户与合同
- 批发维护中的“一键整理批发数据”：保留同月最新批发统计批次、回滚重复旧批次，并按最新合同重新匹配和重算金额。
- 批发维护中的“一键去重”：扫描同日、同公司、同车号、同重量但油品名称不一致的明细，并转入数据审核手动复核。
- 财务汇率
- 密度维护
- 油品与客户字典
- 数据审核
- 批发油品名称按零售板块口径智能归集，支持 80/92/95、液化气、K5/K3/常柴、催化柴油、油浆等常见写法。
- 批发明细先按已维护的客户名称归类统计数量；缺少有效合同的记录进入待审核，金额在合同确认前不计算。
- 外运名称 `X-25` 识别为STN-01加油站（编号 `001`）。
- 系统健康

报告导出：

- 主页可按当前选择的年份或月份生成销售分析报告，覆盖零售、批发与合并统计。
- 批发页面可按当前选择的年份或月份生成批发分析报告。
- 批发汇率页面可按当前选择的年份或月份保存汇率 Excel，列标题包含日期、美元/索姆、人民币/索姆、索姆/人民币、数据来源和获取时间。

系统健康页支持查看运维概览，并可一键刷新当前月零售缓存。运维概览包含今日汇率、市场观察、零售快照和最近自动任务执行状态。

生产服务启动时预热零售月份列表、年份列表、年度总览、年度资源和当前月月度/站点/区域/日趋势快照，避免用户首次打开页面触发慢查询。

每日自动任务：

- `07:30`：补齐 NBKR 汇率。
- `07:30`：获取市场观察。
- `08:30`：按“昨天所属月份”强制刷新零售日销表，并生成日/月/年快照；每月 1 日会补齐上月最后一天。

市场观察自动任务每日获取 `UZEX` 公开成品油报价与国际 `Brent/WTI` 基准价格。`UZEX` 的成品油吨价会结合乌兹别克央行 `KGS` 汇率和平台当前生效密度折算为 `索姆/升`；国际原油仍按 `美元/桶` 作为原料行情参考。俄罗斯板块提供 `SPIMEX` 官方指数入口，其指数数值的再展示需遵守许可要求，未取得许可前仅提供官方参考入口。

## 备份脚本

```powershell
cd D:\SalesVisualization
C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe Sales\scripts\backup_project.py
```

默认输出到：

```text
D:\SalesVisualization\backups
```

备份内容包括 `sales_visualization` 数据库、零售报表、快照和运行密钥。

## 安全注意事项

- 账号、密钥、Cookie 时效等隐私配置统一登记于 `docs/配置文档.md`（含 `SALES_SECRET_KEY`、`SALES_COOKIE_SECURE`、`Sales/.runtime/secret_key.txt` 等）。
- 当前使用 Nginx 反向代理，只开放 `80/443`，Flask :8900 不直接暴露。

## 健康检查

```powershell
cd D:\SalesVisualization
C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe Sales\scripts\health_check.py
```

数据调用自检：

```powershell
cd D:\SalesVisualization
C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe Sales\scripts\data_call_audit.py
```

该脚本会直接访问运行中的 `8900` 服务，检查主页、批发、零售年/月/日、站点、区域、地图悬停、数据问答，以及零售日/月/年快照文件完整性。适合页面显示异常时先判断是接口问题、快照问题，还是浏览器缓存/旧进程问题。

2026-06-06 自检基线：

- 数据调用自检 `37/37` 通过。
- 系统健康检查 `12/12` 通过。
- `2026-06` 日快照当前 `5` 天完整，月度、站点、区域、日趋势和年度派生快照均存在。
- `5月零售销量`、`五月零售销量` 均从快照返回 `2026年5月` 数据。
- 批发明细 `3150` 条当前无未识别油品；油品智能识别样例覆盖 80/92/95、K5/K3、催化柴油、油浆和液化气。
- 批发/销售年度与月度分析报告已统一为新版 HTML/Word 格式。
- 汇率 Excel 去除备注列，列宽自适应，单元格居中并使用黑色框线。
- `/api/kpi` 已优先读取已完成月份快照，供预警页面快速显示库存提示。

后台也提供“系统健康”页面，可查看服务、快照、任务、日志与安全配置。

后台健康页会优先读取 Windows 计划任务；如果当前 Windows 会话无权读取任务或任务路径读取受限，会显示“受限”，并使用后台自动任务执行记录判断汇率、市场观察和零售快照任务是否实际运行。

需要在命令行强制校验 Windows 计划任务时，在服务器具备任务读取权限的会话中运行：

```powershell
C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe D:\SalesVisualization\Sales\scripts\health_check.py --strict-tasks
```

每日 `08:30` 的零售任务会按“昨天所属月份”强制刷新日销表 Excel，然后生成日快照、月快照、年度派生快照和利润快照；区域快照同时维护环比、同比字段。后台手动刷新零售/自用油/利润快照采用后台执行和单实例保护，重复点击不会启动第二份任务。日销表索引记录在 `OilStation/exports/.monthly_report_index.json`，系统健康页会显示当前月日销表文件和最后数据日。

如果 8:30 自动任务之后又补录或修正零售数据库，当天需要在后台“自动任务”中执行“立即刷新零售/自用油/利润快照”；否则正常情况下无需每天手动点击。
