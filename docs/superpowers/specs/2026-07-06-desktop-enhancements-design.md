# 桌面端功能增强设计

## 1. 汇率图表调整
- Y 轴 `min` 设为 `dataMin - (dataMax - dataMin) * 0.05`，使波动可见
- 简化顶部统计卡：4 卡合并为「记录天数」+「缺口总数」2 卡

## 2. 数据录入
- 侧栏：`nav.trainEntry` → `nav.dataEntry`（「火车录入」→「数据录入」）
- 新增表单下拉框：油品名称(products表)、发货单位/收货单位(customers + entity_aliases)
- 新增 API 端点 `GET /api/v2/aliases/product` 和 `GET /api/v2/aliases/entity` 返回去重选项
- 新增别名管理页面：`/aliases`，CRUD entity_aliases + product_aliases

## 3. 油品双语 + 列宽
- 确认所有页面商品名称使用 `t('product.${name}', {defaultValue: name})`
- 列宽：超过 5 列的表格移除固定宽度，改用 `ellipsis` + 最小宽度

## 4. 合同关联 + 分页
- 后端 `company` 参数扩展：`Example,EX` 时额外匹配 `contract_no LIKE 'EXHT%'`；`油气公司,CUSTOMER-S-АББР` 时额外匹配 `contract_no LIKE 'CUSTOMER-S-АББР%'`
- 后端加 `page`/`page_size` 参数 + `SELECT COUNT(*)` 返回 `total`
- 前端加 Ant Design `<Pagination>` 组件

## 5. 3D 地图 iframe 回退
- 复制 `assets/kgz-map/vendor/` + `full-map.html` 到 `public/kgz-map/`
- 修改 `full-map.html` 中 importmap 路径为 `/kgz-map/vendor/...`
- MapPage.tsx 回退到 iframe，src 指向 Vite URL `/kgz-map/full-map.html`
- 保留 `basePath: '/kgz-map/data/'` 指向 public 目录

## 6. 仪表板调整
- KPI 卡片统一 `span={4}`，加 `style={{height: '100%'}}` 等高
- 零售改为年累计：直接使用 `kpi.totalSales` / `kpi.totalLiters`（已从 getKpiYearly 获取）
- 「市场观察」卡片标题改为 `exchange.today`，内容仅保留汇率三价

## 7. 用户管理角色子菜单
- `AppLayout.tsx` 中 users 菜单改为子菜单模式
- 子项：`/users`(用户列表) + `/users/roles`(角色权限)
- 角色权限页：表格展示所有 `app_modules`，每个角色一行，勾选分配权限
- 后端 `PUT /api/v2/users/permissions` 批量保存模块权限

## 8. 别名映射 + 输入提示
- 新建 `src/pages/Aliases.tsx`：管理产品别名和实体别名
- 表单输入框加 `AutoComplete` 组件，从别名 API 获取建议
- API `GET /api/v2/aliases/suggest?type=product|entity&q=xxx`

## 9. 俄语完整性检查
- 遍历检查：Contracts.tsx、TrainEntryPage.tsx、Users.tsx、WeighingList.tsx、Settings.tsx
- 替换所有硬编码中文 label/placeholder 为 `t('...')`
- 补充缺失的 i18n 条目

## 附件
- routes: `/exchange`、`/aliases`、`/users/roles`
- API: `/api/v2/aliases/*`、`/api/v2/contracts?page=&page_size=`
