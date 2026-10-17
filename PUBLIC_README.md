# 加油站零售 BI 可视化平台（Sales Visualization）

> 一套面向**成品油零售 / 批发业务**的开源 BI 系统与可视化平台。覆盖站点零售、批发、外运（自有油库调拨）、报表导出、竞品价格监测与 3D 站点地图，并提供 **Web 端、桌面客户端（Electron）、壁纸引擎** 三套前端，以及一套 Flask 数据后端。

本仓库是**脱敏后的公开演示版**：所有真实公司名称、域名、IP、站点坐标、客户名与财务数据均已替换为合成占位符（如 `example.com`、随机令牌）。仓库不含 `.env`、真实数据库 dump 或证书。

---

## 功能特性

- **多板块数据聚合**：零售 / 批发 / 外运（自有油库调拨）统一看板与 KPI 指标。
- **按油品分类分析**：АИ-80 / АИ-92 / АИ-95 / Д/Т（柴油）/ СПБТ（液化气）的销量、质量、密度、金额分维度统计。
- **零售快照与报表**：每日 / 每月零售快照构建，Excel 报表导出（中俄双语表头，脏密度修正口径）。
- **竞品价格对比平台**：多源价格采集（媒体逐家价表、官方均价锚、站长哨兵）、限价基线、价格陈旧监测。
- **3D 站点地图**：吉尔吉斯加油站与油库 3D 可视化、油库容量面板。
- **壁纸引擎**：桌面壁纸挂件（库存面板、站点地图）。
- **本地大模型助手**：AI 洞察 / 问答（数据口径遵循本项目报表边界）。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Python + Flask（仅监听 `127.0.0.1:8900`） |
| 数据 | MySQL（报表口径详见 `docs/`） |
| Web 前端 | React 19 + Vite 8 + React Router 7 |
| 桌面端 | Electron + Vite + React（当前版本 `v5.6.7`） |
| 壁纸端 | SalesWallpaperEngine（独立版本线 `v0.2.24`） |
| 反向代理 | Nginx（HTTPS，多域名） |
| 跨端共享 | `shared/`（API 契约、零售核、助手 UI） |

---

## 目录结构

```
SalesVisualization-Public/
├── Sales/                  # 后端 Flask API 服务（端口 8900）
├── OilStation/             # 油站数据、快照构建、报表生成（Python）
├── frontend/               # Web 前端（React 19 + Vite）
├── SalesDesktop/           # 桌面客户端（Electron + Vite + React）
├── SalesWallpaperEngine/   # 壁纸引擎（桌面挂件）
├── shared/                 # 跨端共享：API 契约 / 零售核 / 助手 UI
├── scripts/                # 部署与运维脚本
├── docs/                   # 文档（配置、数据口径、客户/站点维护）
├── assets/                 # 静态资源
├── nginx.conf              # Nginx 反向代理配置
├── *.ps1                   # Nginx / Windows 服务管理脚本
├── README.md               # 详尽项目文档（架构、版本记录、报表边界）
├── AGENTS.md               # 项目记忆与操作契约（面向维护者/智能体）
└── TECHNICAL.md            # 技术细节
```

> 完整架构、版本更新记录与报表口径边界见仓库内 `README.md` / `AGENTS.md` / `TECHNICAL.md`。

---

## 快速开始

> 本仓库为脱敏公开版，**不含真实配置与数据**。在本地运行完整功能需自行准备 MySQL 实例、`.env` 配置与证书，并参考 `docs/配置文档.md`。

**后端（Flask，端口 8900）**
```bash
# 1. 准备 MySQL，按 OilStation/.env.example 创建 .env
# 2. 安装 Python 依赖（flask / flask-cors / pymysql 等）
# 3. 启动服务
cd Sales
python app.py
```

**Web 前端（React + Vite）**
```bash
cd frontend
npm install
npm run dev        # 开发服务器
# npm run build    # 生产构建
```

**桌面客户端（Electron）**
```bash
cd SalesDesktop
npm install
npm run electron:dev   # 开发模式
# npm run electron:build  # 打包安装程序
```

**壁纸引擎**
```bash
cd SalesWallpaperEngine
# 详见该目录内说明；与桌面端版本线相互独立
```

**反向代理（Nginx）**
```bash
# 使用仓库根目录 nginx.conf 与 *.ps1 脚本部署 HTTPS 入口
```

---

## 关于本仓库（脱敏说明）

- 所有真实公司名、域名、公网 IP、站点真实坐标、客户名与财务金额，**均已替换为合成占位符**（如 `example.com`、随机令牌），原始数据不出本地、不上传。
- **地理数据已移除**：站点 / 油库经纬度一律清零（`{'lng': 0, 'lat': 0}`），国家与州界 GeoJSON 底图不含在本仓库。部署者需自行准备地理数据，见下方「地理数据」一节。
- 通用油品名称（АИ-80 / АИ-92 / АИ-95 / ДТ / СПБТ）与石油化工术语属行业通用词汇，原样保留，未做替换。

## 地理数据（需自行添加）

本仓库**不含任何真实地理位置数据**。地图相关功能需你自行提供：

| 需要 | 位置 | 说明 |
| --- | --- | --- |
| 站点 / 油库坐标 | `OilStation/constants.py` 的 `SHOP_COORDS`、`DEPOT_COORDS` | 按 `站点编号: {'lng': 经度, 'lat': 纬度}` 填写；代码对缺失坐标有 `{'lng': 0, 'lat': 0}` 兜底 |
| 桌面端地图点位 | `SalesDesktop/src/components/KgzMap.tsx`、后端 `Sales/api_v2/map.py` | 同样按 `lng` / `lat` 字段填写 |
| 行政区底图 | 自备 GeoJSON，放到 `OilStation/kgz.geojson` | 参考 `OilStation/kgz.geojson.template` 的结构；可从公开地理数据集获取本国 / 本州边界 |
- 本仓库以「重演式」提交组织：从 `v1.0.0` 到 `v5.6.7` 的完整提交历史，便于审阅架构演进。

---

## 维护者与联系方式

- **维护者 / Maintainer**：Юрий
- **邮箱 / Email**：631131066@qq.com
- **Telegram**：+996555883019

问题反馈、部署咨询、功能建议均可通过以上方式联系。

---

## 许可证

本项目基于 **MIT License** 开源，详见 [`LICENSE`](./LICENSE)。

- 允许商用、修改、分发、私有化部署；
- 唯一义务：保留版权声明与许可声明；
- 软件按「现状」提供，不含任何担保。

> 项目简介的英文版见 [`EN_PROJECT_INTRO.md`](./EN_PROJECT_INTRO.md)。
