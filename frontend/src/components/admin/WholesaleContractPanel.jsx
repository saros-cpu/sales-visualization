// src/components/admin/WholesaleContractPanel.jsx — 批发合同（父容器，5 个子标签）
import { useState } from 'react';
import WeighPanel from './WeighPanel';
import WholesalePanel from './WholesalePanel';
import AuditPanel from './AuditPanel';
import ContractsPanel from './ContractsPanel';
import ExecutionPanel from './ExecutionPanel';

const SUB_TABS = [
  { key: 'weigh',    label: '称重处理' },
  { key: 'data',     label: '数据维护' },
  { key: 'audit',    label: '审核中心' },
  { key: 'contracts', label: '合同编辑' },
  { key: 'execution', label: '执行看板' },
];

export default function WholesaleContractPanel(props) {
  const [subTab, setSubTab] = useState(() => localStorage.getItem('wcSubTab') || 'weigh');

  const switchSub = (key) => {
    setSubTab(key);
    localStorage.setItem('wcSubTab', key);
  };

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>批发合同</h2><span>称重处理 → 数据维护 → 审核中心 → 合同编辑 → 执行看板</span></div>
      <div className="admin-sub-tabs" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {SUB_TABS.map(t => (
          <button key={t.key} type="button"
            className={subTab === t.key ? 'active' : ''}
            onClick={() => switchSub(t.key)}
            style={{ padding: '6px 14px', cursor: 'pointer', background: subTab === t.key ? '#1a3a5c' : '#eee', color: subTab === t.key ? '#fff' : '#333', border: 'none', borderRadius: 4 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'weigh' && <WeighPanel {...props} />}
      {subTab === 'data' && <WholesalePanel {...props} />}
      {subTab === 'audit' && <AuditPanel {...props} />}
      {subTab === 'contracts' && <ContractsPanel {...props} />}
      {subTab === 'execution' && <ExecutionPanel {...props} />}
    </section>
  );
}
