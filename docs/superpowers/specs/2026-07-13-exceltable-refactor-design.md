# ExcelTable 批量编辑组件重构

## 问题

v3.2.0 引入的 ExcelTable 批量编辑组件存在三个核心缺陷：

1. **按钮重复**：ExcelTable 内部渲染了「新增/保存/取消/删除」按钮组，而所有使用页面（Contracts/Aliases/Procurement/TrainEntry/MaterialsPage）也在外部渲染了相同功能的按钮，导致编辑模式下两组按钮同时出现。

2. **新增行不可见**：ExcelTable 的 `addNewRow` 将新行写入内部 `editData` 状态，但表格数据源 `dataSource` 是来自父组件的只读 prop。新行从未进入 `dataSource`，因此渲染时不可见，用户无法对新行进行数据录入。

3. **保存不生效**：页面的外部「保存」按钮直接调用 `setEditing(false)` 退出编辑模式，未触发 ExcelTable 内部的 `saveAllChanges` 方法。修改数据在内存中丢失。

## 方案

将 ExcelTable 由「自包含组件」改为「受控组件」，通过 `forwardRef` + `useImperativeHandle` 暴露操作方法，让父页面完全控制按钮行为和行数据。

## 架构

```
父页面
  ├── 管理按钮（新增/编辑/保存/取消）
  ├── 管理 data state（含 onAddNew 回调追加行）
  └── <ExcelTable ref={tableRef}>
        ├── dataSource={data}         ← 父页面传入完整数据
        ├── onAddNew={handleAddNew}   ← 父页面接收新行并追加到 data
        ├── editing={editing}         ← 编辑模式状态
        └── tableRef.current
              ├── .saveAllChanges()   ← 收集 editData 差异，调用 onBatchSave
              └── .addNewRow()        ← 生成空白行，触发 onAddNew
```

### 组件职责

| 层 | 职责 |
|---|---|
| **ExcelTable** | 编辑态单元格渲染、editData 变更追踪、差异计算、批量提交、行选中/删除 |
| **父页面** | data 状态管理、新增行追加到 data、编辑/保存/取消按钮逻辑 |

### 数据流

1. 用户点击「新增」→ 父页面调用 `tableRef.addNewRow()`
2. ExcelTable 生成空白行（遍历 columns 取 editable 字段）→ 调用 `onAddNew(blankRow)`
3. 父页面 `onAddNew` 将新行追加到 data state → 重新传入 dataSource
4. 用户在单元格输入 → `updateCell` 写入内部 `editData`
5. 用户点击「保存」→ 父页面调用 `await tableRef.saveAllChanges()`
6. ExcelTable 遍历 `editData`，比对 `dataSource` 找出差异行 → 调用 `onBatchSave(changes)`
7. 成功后父页面 `setEditing(false)`

### API 变更

```typescript
// ExcelTable 暴露的句柄
interface ExcelTableHandle {
  saveAllChanges: () => Promise<void>;
  addNewRow: () => void;
}

// 新增 prop
interface ExcelTableProps<T> {
  // ... 原有 props
  onAddNew?: (row: T) => void;  // 新增：父页面接收新行并追加到 data
}
```

## 受影响页面（6 个）

| 页面 | 修改内容 |
|---|---|
| Contracts.tsx | 添加 tableRef、handleAddNew、修复按钮，移除 Card 容器 |
| Aliases.tsx | 同上（移除 editData/tempIdCounter） |
| Procurement.tsx | 同上（添加 PlusOutlined 按钮，修复 Save 逻辑） |
| TrainEntryPage.tsx | 同上（修复 Add 按钮调用 setEditing(false) 的 bug） |
| MaterialsPage.tsx | MaterialDictTab/InboundTab/TransferOrdersTab 三个子 Tab 同上 |
| Region.tsx | 添加缺失的 ZH_REGION_KEY import |

## 审核要点

1. `useImperativeHandle` 使用 ref 包裹函数避免闭包陷阱：`saveAllChangesRef.current = saveAllChanges`
2. 新增行通过 `id < 0` 区分（临时 ID 递减），`saveAllChanges` 检查 `change.id > 0` 走更新、否则走创建
3. 所有 antd 按钮/图标/其它未使用 import 已清理
