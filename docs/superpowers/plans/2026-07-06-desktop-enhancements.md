# 桌面端功能增强 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 9 项桌面端功能增强（汇率图表、数据录入下拉、合同联动、3D 地图修复、仪表板调整、角色权限等）

**Architecture:** 后端增加别名 API 端点 + 合同分页/前缀匹配；前端修改 5 个现有页面 + 新增 2 个页面（别名管理/角色权限）；静态地图资源由 Vite public 目录提供

**Tech Stack:** Python/Flask + MySQL, React/TypeScript/Ant Design/ECharts/Three.js

## Global Constraints

- Flask 端口 8900，JWT 认证
- 所有 UI 字符串通过 `t('...')` i18n
- THREE npm 包版本 0.185.1
- 数据库 `reader` 用户无 REFERENCES 权限，有 ALTER 权限

---

## File Structure

| File | Responsibility |
|------|---------------|
| `Sales/api_v2/aliases.py` | **新建** — 别名查询/建议 API |
| `Sales/api_v2/contracts.py` | **修改** — 公司前缀匹配 + 分页 |
| `Sales/api_v2/__init__.py` | **修改** — 注册 aliases blueprint |
| `SalesDesktop/src/api/exchange.ts` | **修改** — 增加 aliases API 调用 |
| `SalesDesktop/src/api/client.ts` | **修改** — 增加 aliases/contract API |
| `SalesDesktop/src/pages/ExchangeRates.tsx` | **修改** — Y 轴调整 + 简化统计卡 |
| `SalesDesktop/src/pages/Dashboard.tsx` | **修改** — KPI 等高 + 年累计 + 汇率卡片 |
| `SalesDesktop/src/pages/Contracts.tsx` | **修改** — 加翻页 |
| `SalesDesktop/src/pages/TrainEntry/TrainEntryPage.tsx` | **修改** — 下拉菜单替代 Input |
| `SalesDesktop/src/pages/Users.tsx` | **修改** — 增加角色权限入口 |
| `SalesDesktop/src/pages/UserRoles.tsx` | **新建** — 角色权限管理页 |
| `SalesDesktop/src/pages/Aliases.tsx` | **新建** — 别名映射管理页 |
| `SalesDesktop/src/pages/MapPage.tsx` | **修改** — 回退 iframe + Vite 静态 |
| `SalesDesktop/src/layouts/AppLayout.tsx` | **修改** — 菜单改名 + 子菜单 |
| `SalesDesktop/src/App.tsx` | **修改** — 新增路由 |
| `SalesDesktop/src/i18n/zh.json` | **修改** — 补充 key |
| `SalesDesktop/src/i18n/ru.json` | **修改** — 补充 key |
| `SalesDesktop/public/kgz-map/` | **新建** — 复制 vendor/ + full-map.html |

---

### Task 1: 汇率图表 Y 轴调整 + 简化统计

**Files:**
- Modify: `SalesDesktop/src/pages/ExchangeRates.tsx:41-54`

- [ ] **Step 1: 修改 Y 轴 min**

```typescript
// 在 chartOption 之前计算数据范围
const usdValues = sorted.map((r) => r.usdKgs).filter((v): v is number => v !== null);
const cnyValues = sorted.map((r) => r.cnyKgs).filter((v): v is number => v !== null);
const usdMin = Math.min(...usdValues);
const usdMax = Math.max(...usdValues);
const cnyMin = Math.min(...cnyValues);
const cnyMax = Math.max(...cnyValues);

const chartOption = {
  // ... existing options ...
  yAxis: [
    {
      type: 'value', name: 'USD/KGS', position: 'left', axisLabel: { fontSize: 10 },
      min: usdMin - (usdMax - usdMin) * 0.1,
      max: usdMax + (usdMax - usdMin) * 0.1,
    },
    {
      type: 'value', name: 'CNY/KGS', position: 'right', axisLabel: { fontSize: 10 },
      min: cnyMin - (cnyMax - cnyMin) * 0.1,
      max: cnyMax + (cnyMax - cnyMin) * 0.1,
    },
  ],
  // ...
};
```

- [ ] **Step 2: 简化统计卡片 — 4 卡合并为 2 卡**

```typescript
// 替换 4 个 Col span={6} 为 2 个 Col span={6}
<Col span={6}><Card size="small"><Statistic title={t('exchange.totalDays')} value={data?.total ?? 0} suffix={t('common.day')} /></Card></Col>
<Col span={6}><Card size="small"><Statistic title={t('exchange.openGaps')} value={data?.openGaps ?? 0} valueStyle={{ color: (data?.openGaps ?? 0) > 0 ? '#ff4d4f' : undefined }} /></Card></Col>
// 剩余空间用空的 Col 占位：<Col span={6} /><Col span={6} />
```

- [ ] **Step 3: Build 验证**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/ExchangeRates.tsx
git commit -m "fix: exchange rate chart y-axis range & simplify stat cards"
```

---

### Task 2: 数据录入菜单改名 + 别名 API 后端

**Files:**
- Create: `Sales/api_v2/aliases.py`
- Modify: `Sales/api_v2/__init__.py`
- Modify: `SalesDesktop/src/layouts/AppLayout.tsx`
- Modify: `SalesDesktop/src/i18n/zh.json`, `ru.json`

**Interfaces:**
- GET `/api/v2/aliases/products` → `{code:0, data: [{id, displayName, aliases:[]}]}`
- GET `/api/v2/aliases/entities?type=company` → `{code:0, data: [{id, standardName, aliases:[]}]}`
- GET `/api/v2/aliases/suggest?type=product|entity&q=xxx` → `{code:0, data: [{value, label}]}`

- [ ] **Step 1: 创建别名 API**

```python
# Sales/api_v2/aliases.py
from flask import request, jsonify
from flask_jwt_extended import jwt_required
from api_v2 import bp_v2
from db import get_connection
import pymysql


@bp_v2.route('/aliases/products', methods=['GET'])
@jwt_required()
def alias_products():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT p.id, p.display_name, pa.alias_name
                FROM products p
                LEFT JOIN product_aliases pa ON p.id = pa.product_id
                WHERE p.is_active = 1
                ORDER BY p.display_name
            ''')
            rows = cur.fetchall()
            products = {}
            for r in rows:
                pid = r['id']
                if pid not in products:
                    products[pid] = {'id': pid, 'displayName': r['display_name'], 'aliases': []}
                if r['alias_name']:
                    products[pid]['aliases'].append(r['alias_name'])
            return jsonify({'code': 0, 'data': list(products.values())})
    finally:
        conn.close()


@bp_v2.route('/aliases/entities', methods=['GET'])
@jwt_required()
def alias_entities():
    entity_type = request.args.get('type', 'company')
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT id, standard_name, alias_name, entity_type
                FROM entity_aliases
                ORDER BY standard_name
            ''')
            rows = cur.fetchall()
            entities = {}
            for r in rows:
                eid = r['id']
                key = f'{r["standard_name"]}__{eid}'
                if key not in entities:
                    entities[key] = {'id': eid, 'standardName': r['standard_name'], 'entityType': r['entity_type'], 'aliases': []}
                if r['alias_name']:
                    entities[key]['aliases'].append(r['alias_name'])
            return jsonify({'code': 0, 'data': list(entities.values())})
    finally:
        conn.close()


@bp_v2.route('/aliases/suggest', methods=['GET'])
@jwt_required()
def alias_suggest():
    q = request.args.get('q', '').strip()
    atype = request.args.get('type', 'product')
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            if atype == 'product':
                cur.execute('''
                    SELECT DISTINCT pa.alias_name AS label
                    FROM product_aliases pa
                    WHERE pa.normalized_alias LIKE %s
                    LIMIT 20
                ''', (f'%{q}%',))
            else:
                cur.execute('''
                    SELECT DISTINCT ea.alias_name AS label
                    FROM entity_aliases ea
                    WHERE ea.normalized_alias LIKE %s
                    LIMIT 20
                ''', (f'%{q}%',))
            items = [{'value': r['label'], 'label': r['label']} for r in cur.fetchall()]
            return jsonify({'code': 0, 'data': items})
    finally:
        conn.close()
```

- [ ] **Step 2: 注册 blueprint**

```python
# Sales/api_v2/__init__.py — 在文件末尾添加
from api_v2 import aliases  # noqa
```

- [ ] **Step 3: 侧栏改名**

```typescript
// AppLayout.tsx line 21
{ key: '/train-entry', icon: <CarOutlined />, labelKey: 'dataEntry' },
```

- [ ] **Step 4: i18n — zh.json** `nav.dataEntry: "数据录入"`，**ru.json** `nav.dataEntry: "Ввод данных"`

- [ ] **Step 5: 验证**

```bash
cd Sales; python run_production.py (check running); curl -s http://127.0.0.1:8900/api/v2/aliases/products | python -c "import sys,json; d=json.load(sys.stdin); print('products:', len(d['data']))"
```

- [ ] **Step 6: Commit**

```bash
git add Sales/api_v2/aliases.py Sales/api_v2/__init__.py SalesDesktop/src/layouts/AppLayout.tsx SalesDesktop/src/i18n/
git commit -m "feat: alias API & rename sidebar to dataEntry"
```

---

### Task 3: 地图资源复制 + MapPage iframe 回退

**Files:**
- Create: `SalesDesktop/public/kgz-map/vendor/three.module.js`
- Create: `SalesDesktop/public/kgz-map/vendor/examples/jsm/controls/OrbitControls.js`
- Create: `SalesDesktop/public/kgz-map/full-map.html`
- Modify: `SalesDesktop/src/pages/MapPage.tsx`

- [ ] **Step 1: 复制 vendor 文件**

```bash
$null = New-Item -ItemType Directory -Path "SalesDesktop/public/kgz-map/vendor/examples/jsm/controls" -Force
Copy-Item "assets/kgz-map/vendor/three.module.js" "SalesDesktop/public/kgz-map/vendor/three.module.js"
Copy-Item "assets/kgz-map/vendor/examples/jsm/controls/OrbitControls.js" "SalesDesktop/public/kgz-map/vendor/examples/jsm/controls/OrbitControls.js"
Copy-Item "assets/kgz-map/full-map.html" "SalesDesktop/public/kgz-map/full-map.html"
```

- [ ] **Step 2: 修改 full-map.html 的 importmap 路径**

```html
<!-- 将 /assets/kgz-map/vendor/ 改为 /kgz-map/vendor/ -->
<script type="importmap">
{
  "imports": {
    "three": "/kgz-map/vendor/three.module.js",
    "three/addons/": "/kgz-map/vendor/examples/jsm/"
  }
}
</script>
```

同时修改 CSS 引用路径：
```html
<link rel="stylesheet" href="/kgz-map/kgz-map.css">
```

- [ ] **Step 3: 修改 full-map.html 的 API 请求路径（带 token）**

```javascript
// 读取 token，从 URL 查询参数
const token = new URLSearchParams(window.location.search).get('token') || '';
const headers = {};
if (token) headers['Authorization'] = 'Bearer ' + token;

// 在 fetch 调用中使用 headers
const res = await fetch('/api/v2/map/stations', { headers });
```

- [ ] **Step 4: 重写 MapPage.tsx**

```typescript
import { Spin } from 'antd';

export default function MapPage() {
  const token = localStorage.getItem('accessToken') || '';
  const src = `http://localhost:5173/kgz-map/full-map.html?token=${encodeURIComponent(token)}`;

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 112px)', position: 'relative' }}>
      <iframe
        src={src}
        style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }}
      />
    </div>
  );
}
```

- [ ] **Step 5: 验证**

```bash
curl.exe -s http://localhost:5173/kgz-map/full-map.html -o NUL -w "%{http_code}"
```

- [ ] **Step 6: Build + Commit**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
git add SalesDesktop/public/kgz-map/ SalesDesktop/src/pages/MapPage.tsx
git commit -m "fix: 3D map iframe with Vite-served static assets"
```

---

### Task 4: 合同后端前缀匹配 + 分页

**Files:**
- Modify: `Sales/api_v2/contracts.py`

- [ ] **Step 1: 后端分页 + 前缀匹配**

```python
# contracts.py — 在 GET 方法中增加
page = int(request.args.get('page', 1))
page_size = int(request.args.get('page_size', 50))
offset = (page - 1) * page_size

# company 参数扩展
if company:
    terms = company.split(',')
    like_clauses = []
    for term in terms:
        term = term.strip()
        if term:
            like_clauses.append('(c.raw_customer_name LIKE %s OR c.raw_customer_name LIKE %s)')
            params.extend([f'%{term}%', f'%{term.upper()}%'])
            # 前缀匹配：Example/EX → EXHT，油气公司/CUSTOMER-S-АББР → CUSTOMER-S-АББР
            if term in ('Example', 'EX'):
                like_clauses.append('c.contract_no LIKE %s')
                params.append('EXHT%')
            elif term in ('油气公司', 'CUSTOMER-S-АББР'):
                like_clauses.append('c.contract_no LIKE %s')
                params.append('CUSTOMER-S-АББР%')
    if like_clauses:
        where_clause = ' AND (' + ' OR '.join(like_clauses) + ')'

# 先 COUNT
cur.execute(f'SELECT COUNT(DISTINCT c.id) FROM contracts c LEFT JOIN contract_monthly_volumes cm ON c.id = cm.contract_id WHERE 1=1{where_clause}', params)
total = cur.fetchone()['COUNT(DISTINCT c.id)']

# 再查询（加 LIMIT/OFFSET）
cur.execute(f'''
    SELECT c.id, c.contract_no, ... 
    FROM contracts c
    LEFT JOIN contract_monthly_volumes cm ON c.id = cm.contract_id
    WHERE 1=1{where_clause}
    GROUP BY c.id
    ORDER BY {order_expr} {order_dir}
    LIMIT {page_size} OFFSET {offset}
''', params)
items = [...]

return jsonify({'code': 0, 'message': 'success', 'data': {'items': items, 'total': total}})
```

- [ ] **Step 2: Build 验证**

```bash
curl.exe -s "http://127.0.0.1:8900/api/v2/contracts?company=Example,EX&page=1&page_size=10" (with auth)
```

- [ ] **Step 3: Commit**

```bash
git add Sales/api_v2/contracts.py
git commit -m "feat: contract company prefix match + pagination"
```

---

### Task 5: 合同前端翻页 + 公司联动

**Files:**
- Modify: `SalesDesktop/src/pages/Contracts.tsx`
- Modify: `SalesDesktop/src/api/client.ts`

- [ ] **Step 1: client.ts — 更新 getContracts 接口支持分页**

```typescript
// client.ts 中 getContracts
async function getContracts(params: { company?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number }) {
  const res = await client.get('/v2/contracts', { params });
  return res.data.data;  // { items: [...], total: number }
}
```

- [ ] **Step 2: Contracts.tsx — 加分页**

```typescript
// 在 state 中增加
const [page, setPage] = useState(1);
const [total, setTotal] = useState(0);
const pageSize = 50;

// 在 getContracts 调用中传 page/page_size
const res = await getContracts({ company, sort_by: 'contractNo', sort_dir: 'asc', page, page_size: pageSize });
setData(res.items);
setTotal(res.total);

// 表格底部加分页
// 如果使用 Table 的 pagination 属性
<Table
  dataSource={data}
  columns={columns}
  rowKey="id"
  pagination={{ current: page, total, pageSize, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
  // ...
/>
```

- [ ] **Step 3: Build + Commit**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
git add src/pages/Contracts.tsx src/api/client.ts
git commit -m "feat: contracts pagination frontend"
```

---

### Task 6: 仪表板调整

**Files:**
- Modify: `SalesDesktop/src/pages/Dashboard.tsx`

- [ ] **Step 1: KPI 卡片等高 + 零售年累计 + 汇率卡片改名**

```typescript
// 所有 KPI Card 加 style={{height: '100%'}}
<Col span={4}>
  <Card size="small" style={{height: '100%'}}>
    <Statistic title={t('dashboard.monthlyWholesaleTons')} value={data.monthlyWholesaleTons} precision={1} prefix={<ShoppingOutlined />} />
  </Card>
</Col>

// 零售 KPI — 目前已经是年累计（来自 getKpiYearly），确认 value 单位
<Col span={4}>
  <Card size="small" style={{height: '100%'}}>
    <Statistic title={t('retail.totalSales')} value={Math.round(kpi.totalSales / 100000000)} suffix="亿" prefix={<DollarOutlined />} />
    <div style={{ fontSize: 12, color: '#999' }}>同比 {formatYoy(kpi.yoySales)}</div>
  </Card>
</Col>

// 市场观察卡片标题改为 exchange.today
<Card size="small" title={<><DollarOutlined /> {t('exchange.today')}</>}>
  // 内容保持汇率三价
```

- [ ] **Step 2: Build + Commit**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
git add src/pages/Dashboard.tsx
git commit -m "fix: dashboard KPI uniform height, yearly retail, exchange card rename"
```

---

### Task 7: 火车录入下拉菜单

**Files:**
- Modify: `SalesDesktop/src/pages/TrainEntry/TrainEntryPage.tsx`
- Modify: `SalesDesktop/src/api/trainEntry.ts`（可选）
- Modify: `SalesDesktop/src/api/client.ts`

- [ ] **Step 1: client.ts — 添加别名查询接口**

```typescript
// client.ts
async function getProductAliases(): Promise<{id: number; displayName: string; aliases: string[]}[]> {
  const res = await client.get('/v2/aliases/products');
  return res.data.data;
}

async function getEntityAliases(type: string): Promise<{id: number; standardName: string; aliases: string[]}[]> {
  const res = await client.get('/v2/aliases/entities', { params: { type } });
  return res.data.data;
}
```

- [ ] **Step 2: TrainEntryPage.tsx — 表单中替换为 Select + 加载别名数据**

```typescript
// 在组件中
const [products, setProducts] = useState<{value: string; label: string}[]>([]);

useEffect(() => {
  getProductAliases().then((list) => {
    const opts = new Set<string>();
    list.forEach((p) => {
      opts.add(p.displayName);
      p.aliases.forEach((a) => opts.add(a));
    });
    setProducts(Array.from(opts).map((v) => ({ value: v, label: v })));
  });
}, []);

// 同理加载 entities

// 表单中
<Form.Item name="productName" label="..." rules={[{ required: true }]}>
  <Select showSearch placeholder="..." options={products} />
</Form.Item>
<Form.Item name="senderName" label="...">
  <Select showSearch allowClear placeholder="..." options={senders} />
</Form.Item>
<Form.Item name="receiverName" label="...">
  <Select showSearch allowClear placeholder="..." options={receivers} />
</Form.Item>
```

- [ ] **Step 3: Build + Commit**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
git add src/pages/TrainEntry/TrainEntryPage.tsx src/api/client.ts
git commit -m "feat: train entry dropdown selects from alias data"
```

---

### Task 8: 用户管理角色子菜单 + 角色权限页

**Files:**
- Modify: `SalesDesktop/src/layouts/AppLayout.tsx`
- Modify: `SalesDesktop/src/App.tsx`
- Create: `SalesDesktop/src/pages/UserRoles.tsx`

- [ ] **Step 1: AppLayout.tsx — users 改为子菜单**

```typescript
// 在菜单项中
{
  key: 'users-sub',
  icon: <TeamOutlined />,
  label: t('nav.users'),
  children: [
    { key: '/users', label: t('common.userList') },
    { key: '/users/roles', label: t('common.rolePermissions') },
  ],
},
```

- [ ] **Step 2: App.tsx — 加路由**

```typescript
import UserRoles from '@/pages/UserRoles';
// ...
<Route path="users/roles" element={<UserRoles />} />
```

- [ ] **Step 3: 创建 UserRoles.tsx**

```typescript
// 展示所有模块 + 所有角色的权限矩阵
// GET /api/v2/users/permissions/modules → 模块列表
// GET /api/v2/users/permissions → 当前权限
// PUT /api/v2/users/permissions → 保存

// 使用 Ant Design Table 展示，行=模块，列=角色，勾选=有权限
```

- [ ] **Step 4: i18n 补充**

zh.json: `common.userList: "用户列表"`, `common.rolePermissions: "角色权限"`
ru.json: `common.userList: "Пользователи"`, `common.rolePermissions: "Роли и права"`

- [ ] **Step 5: Build + Commit**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
git add src/pages/UserRoles.tsx src/App.tsx src/layouts/AppLayout.tsx src/i18n/
git commit -m "feat: user role permissions submenu & page"
```

---

### Task 9: 别名管理页面 + 录入搜索建议

**Files:**
- Create: `SalesDesktop/src/pages/Aliases.tsx`
- Modify: `SalesDesktop/src/App.tsx`（加路由）
- Modify: `SalesDesktop/src/layouts/AppLayout.tsx`（加菜单）

- [ ] **Step 1: 创建 Aliases.tsx**

```typescript
// 两个 Tab：产品别名 / 实体别名
// 每个 Tab 显示表格 + 新增/编辑/删除
// 数据来自 GET /api/v2/aliases/products 和 /api/v2/aliases/entities
```

- [ ] **Step 2: 添加路由和菜单**

```typescript
// AppLayout.tsx — 放在 dataEntry 下方
{ key: '/aliases', icon: <BookOutlined />, labelKey: 'aliases' },

// App.tsx
import Aliases from '@/pages/Aliases';
<Route path="aliases" element={<Aliases />} />
```

- [ ] **Step 3: i18n**

zh.json: `nav.aliases: "别名管理"`
ru.json: `nav.aliases: "Псевдонимы"`

- [ ] **Step 4: Build + Commit**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
git add src/pages/Aliases.tsx src/App.tsx src/layouts/AppLayout.tsx src/i18n/
git commit -m "feat: alias management page"
```

---

### Task 10: 俄语完整性 + 全局 i18n 补漏

**Files:**
- Modify: `SalesDesktop/src/i18n/zh.json`, `ru.json`
- Modify: `SalesDesktop/src/pages/Contracts.tsx`
- Modify: `SalesDesktop/src/pages/TrainEntry/TrainEntryPage.tsx`
- Modify: `SalesDesktop/src/pages/Users.tsx`
- Modify: `SalesDesktop/src/pages/WeighingList.tsx`

- [ ] **Step 1: 全面检查硬编码中文**

```typescript
// 检查项：
// 1. Contracts.tsx — COMPANY_OPTIONS label 是否 t()?
// 2. Users.tsx — 角色选项 label 是否 t()?
// 3. TrainEntryPage.tsx — 所有 placeholder，modal title，button text
// 4. WeighingList.tsx — 页面标题
// 5. 所有 columns.title = t('...') 是否正确？
```

- [ ] **Step 2: 补充缺失翻译**

zh.json 增加：
```json
"userList": "用户列表",
"rolePermissions": "角色权限",
"aliases": "别名管理",
"confirmPassword": "确认密码",
"addRecord": "新增记录",
"editRecord": "编辑记录",
"deleteRecord": "删除记录",
"operation": "操作",
```

ru.json 对应补充。

- [ ] **Step 3: 替换硬编码**

将 Contracts.tsx `COMPANY_OPTIONS` 改为：
```typescript
const COMPANY_OPTIONS = [
  { label: t('common.all'), value: '' },
  { label: `${t('common.example')} / ZD`, value: 'Example,EX' },
  { label: `${t('common.oilCompany')} / CUSTOMER-S-АББР`, value: '油气公司,CUSTOMER-S-АББР' },
];
```

Users.tsx 角色选项改为：
```typescript
const roleOptions = [
  { value: 'admin', label: t('users.admin') },
  { value: 'operator', label: t('users.operator') },
  { value: 'auditor', label: t('users.auditor') },
  { value: 'viewer', label: t('users.viewer') },
];
```

- [ ] **Step 4: Build + Commit**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
git add src/i18n/ src/pages/Contracts.tsx src/pages/Users.tsx src/pages/TrainEntry/
git commit -m "i18n: comprehensive russian translation check & fixes"
```

---

### Task 11: 产品名称双语 + 列宽响应式

**Files:**
- Modify: `SalesDesktop/src/pages/Wholesale.tsx`
- Modify: `SalesDesktop/src/pages/Procurement.tsx`

- [ ] **Step 1: 检查 Wholesale.tsx 和 Procurement.tsx 中所有列渲染**

确保每个包含产品名称的列都使用：
```typescript
render: (v: string) => t(`product.${v}`, { defaultValue: v })
```

- [ ] **Step 2: 列宽调整 — 移除固定宽度，改用 minWidth + ellipsis**

```typescript
// 对于超过 6 列的表格，仅设置 minWidth 和 ellipsis
{
  title: '...',
  dataIndex: '...',
  ellipsis: true,
  width: undefined,
  // 不设置固定 width
}
```

- [ ] **Step 3: Build + Commit**

```bash
cd SalesDesktop; npx tsc --noEmit; npx vite build 2>&1 | Select-Object -Last 3
git add src/pages/Wholesale.tsx src/pages/Procurement.tsx
git commit -m "fix: product name bilingual render & responsive column widths"
```



---

## Execution

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks
**2. Inline Execution** — execute in this session with checkpoints
