# 自用油快照功能使用说明

## 功能概述

自用油快照功能已成功实现，用于提高自用油菜单数据查询速度。快照数据包含所有客户端需要的信息，包括交易记录、汇总数据、按站点/油品/区域/日期的分组统计。

## 实现内容

### 1. 缓存系统扩展
**文件**: `OilStation/cache_store.py`

- 在 `SNAPSHOT_PREFIXES` 中添加了 `self_use`
- 在 `CACHE_TTL` 中添加了 `self_use: 1800` (30分钟)
- 添加了快照数据结构验证

### 2. 快照生成函数
**文件**: `OilStation/scripts/refresh_current_snapshots.py`

- `_build_self_use_monthly_snapshot(ym: str)` - 构建自用油月度快照
  - 查询所有自用油交易记录（DerivedPaymentTypeKey = 2）
  - 按站点、油品、区域、日期分组聚合
  - 计算同比环比数据
  - 返回完整的快照数据结构

### 3. API集成
**文件**: `OilStation/endpoints/v1/retail/analytics/controller.py`

- `api_retail_self_use(year_month)` - 优先从快照读取数据
  - 首先检查缓存
  - 缓存命中则直接返回
  - 缓存未命中则查询数据库并缓存结果

### 4. 历史数据回填
**文件**: `OilStation/scripts/backfill_self_use_snapshots.py`

- 支持批量回填指定年份范围的自用油快照
- 显示进度和统计信息

### 5. 测试脚本
**文件**: `OilStation/scripts/test_self_use_snapshot.py`

- 测试单月快照生成功能

## 快照数据结构

```json
{
  "month": "2026-07",
  "records": [
    {
      "transactionKey": 123456,
      "date": "2026-07-01",
      "shopKey": 1,
      "stationName": "STN-01",
      "resourceKey": 102,
      "productName": "80号汽油",
      "volume": 100.5,
      "amount": 45000.0,
      "plateNumber": "А123БВ777"
    }
  ],
  "summary": {
    "totalVolume": 1400000.0,
    "totalAmount": 91000000.0,
    "totalRecords": 5000,
    "activeStations": 26
  },
  "comparison": {
    "mom": {
      "volume": -59.7,
      "amount": -60.1,
      "prevMonth": "2026-06"
    },
    "yoy": {
      "volume": -1.0,
      "amount": 2.7,
      "yoyMonth": "2025-07"
    }
  },
  "byStation": [
    {
      "shopKey": 1,
      "name": "STN-01",
      "volume": 22000.0,
      "amount": 1600000.0,
      "txnCount": 12
    }
  ],
  "byResource": [
    {
      "resourceKey": 102,
      "name": "80号汽油",
      "volume": 0.0,
      "amount": 0.0
    }
  ],
  "byRegion": {
    "REG-01": {
      "volume": 0.0,
      "amount": 0.0,
      "activeCount": 0
    }
  },
  "daily": [
    {
      "date": "2026-07-01",
      "volume": 0.0,
      "amount": 0.0
    }
  ]
}
```

## 使用方法

### 1. 生成快照

#### 生成单月快照（推荐先测试）
```bash
python OilStation/scripts/test_self_use_snapshot.py
```

#### 回填历史数据
```bash
# 回填2023-2026年所有快照
python OilStation/scripts/backfill_self_use_snapshots.py --start-year 2023 --end-year 2026

# 回填2026年所有快照
python OilStation/scripts/backfill_self_use_snapshots.py --start-year 2026 --end-year 2026

# 回填2023年所有快照
python OilStation/scripts/backfill_self_use_snapshots.py --start-year 2023 --end-year 2023
```

#### 刷新当前月快照
```bash
python OilStation/scripts/refresh_current_snapshots.py
```

### 2. 测试API

启动服务后，测试自用油API：
```bash
curl http://localhost:8900/api/retail/self-use/2026-07
```

或通过前端访问：自用油菜单 → 选择月份

### 3. 清除缓存

如果需要重新生成快照，清除缓存：
```bash
python OilStation/scripts/refresh_current_snapshots.py
```

## 性能优化

- **缓存时间**: 30分钟 (1800秒)
- **缓存策略**: 优先使用快照，快照过期或不存在时查询数据库
- **预期性能提升**: 50%以上（快照查询 < 100ms）

## 注意事项

1. **首次使用**: 需要先运行回填脚本生成历史快照
2. **数据更新**: 每月刷新时自动更新当月快照
3. **缓存失效**: 快照缓存30分钟后自动失效
4. **数据一致性**: 快照数据与数据库查询结果一致

## 故障排查

### 快照生成失败
```bash
# 检查错误信息
python OilStation/scripts/test_self_use_snapshot.py
```

### API返回错误
```bash
# 检查服务日志
# 确认服务已启动: python OilStation/api.py
```

### 缓存问题
```bash
# 清除所有缓存并重新生成
python OilStation/scripts/refresh_current_snapshots.py
```

## 文件清单

- `OilStation/cache_store.py` - 缓存系统（已修改）
- `OilStation/scripts/refresh_current_snapshots.py` - 快照生成（已修改）
- `OilStation/scripts/backfill_self_use_snapshots.py` - 历史数据回填（新增）
- `OilStation/scripts/test_self_use_snapshot.py` - 单月测试（新增）
- `OilStation/scripts/verify_implementation.py` - 验证脚本（新增）
- `OilStation/endpoints/v1/retail/analytics/controller.py` - API（已修改）

## 完成状态

✅ 缓存系统扩展
✅ 快照生成函数
✅ API集成
✅ 历史数据回填脚本
✅ 测试脚本
✅ 验证脚本
✅ 使用文档

---

**实施日期**: 2026-07-12
**实施人**: AI Assistant
**状态**: 已完成
