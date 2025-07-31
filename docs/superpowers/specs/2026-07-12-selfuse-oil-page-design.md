# 自用油页面设计方案

## 背景

零售菜单下新增"自用油"子页面，用于展示每日自用油交易明细，包含车牌号，支持 Excel 导出。

## 数据模型

- **自用油标识**: `selling.DerivedPaymentTypeKey = 2`
- **车牌号**: `person.Name` 字段，通过 `selling.PersonKey = person.PersonKey` 关联
- **编码问题**: `person.Name` 存储为 latin1 编码（含俄文如 Генератор），需转 utf8

## 范围

### 包含

- 后端 API 端点：查询自用油交易 + 车牌号
- 后端 Excel 导出端点
- 前端页面：按日明细表格 + 车牌号搜索 + 导出按钮
- i18n 中俄翻译
- 菜单 + 路由注册

### 不包含

- 车牌号编辑/录入功能（PersonKey=0 的 34 条发电机记录按空值展示）
- 额外的筛选条件（站点、油品等）

## 后端设计

### API 端点

```
GET /api/retail/self-use/<year_month>
```

返回格式：
```json
{
  "month": "2026-06",
  "records": [
    {
      "transactionKey": 123,
      "date": "2026-06-15",
      "shopKey": 4,
      "stationName": "ГАЗ",
      "resourceKey": 103,
      "productName": "AI-92",
      "volume": 20.5,
      "amount": 1490.0,
      "plateNumber": "01KG000AA"
    }
  ],
  "summary": {
    "totalVolume": 5000.0,
    "totalAmount": 350000.0,
    "totalRecords": 350
  }
}
```

SQL 使用 `LEFT JOIN person` 和 `CONVERT(p.Name USING utf8mb4)` 处理编码。

### Excel 导出

```
GET /api/export/self-use/<year_month>
```

返回 xlsx 文件，列：日期、站点、油品、车牌号、数量(L)、金额(сом)。

注册在 `OilStation/api.py`，路由处理在 `controller.py` + `export.py`。

## 前端设计

### 页面布局

```
PeriodPicker [月份]  |  Input.Search [搜索车牌号]  |  Button [导出 Excel]
Table: 日期 | 站点 | 油品 | 车牌号 | 数量(L) | 金额(сом)
```

### 交互

- 月份选择器控制数据范围
- 车牌号输入框实时筛选表格行
- 导出按钮下载当月 Excel
- 默认按日期倒序排序

### 修改文件清单

| 文件 | 操作 |
|------|------|
| `OilStation/endpoints/v1/retail/analytics/controller.py` | + `self_use_api` endpoint |
| `OilStation/api.py` | + 注册路由 |
| `OilStation/routes/export.py` | + Excel 导出 |
| `SalesDesktop/src/api/retail.ts` | + `getSelfUse()`, `exportSelfUseExcel()` |
| `SalesDesktop/src/pages/retail/SelfUse.tsx` | 新建页面 |
| `SalesDesktop/src/config/menu.tsx` | + 子菜单 |
| `SalesDesktop/src/App.tsx` | + 路由 |
| `SalesDesktop/src/i18n/zh.json` | + 翻译 |
| `SalesDesktop/src/i18n/ru.json` | + 翻译 |
| `SalesDesktop/src/version.ts` | 版本号 + CHANGELOG |
