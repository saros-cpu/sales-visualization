import { useState, useRef, useEffect } from 'react';

export default function ColumnFilter({ label, column, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(v =>
    !search || v.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (val) => {
    const next = selected.includes(val)
      ? selected.filter(v => v !== val)
      : [...selected, val];
    onChange(column, next);
  };

  const selectAll = () => onChange(column, [...options]);
  const clearAll = () => onChange(column, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <span
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        {label} <span style={{ fontSize: 10, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
        {selected.length > 0 && selected.length < options.length && (
          <span style={{ color: '#1a3a5c', fontWeight: 'bold', marginLeft: 4 }}>({selected.length})</span>
        )}
      </span>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000,
          background: '#fff', border: '1px solid #ccc', borderRadius: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', minWidth: 200,
          maxHeight: 300, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <input
            type="text" placeholder="搜索..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ margin: 4, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3 }}
          />
          <div style={{ padding: '2px 4px', borderBottom: '1px solid #eee', display: 'flex', gap: 8, fontSize: 12 }}>
            <span onClick={selectAll} style={{ cursor: 'pointer', color: '#1a3a5c' }}>全选</span>
            <span onClick={clearAll} style={{ cursor: 'pointer', color: '#999' }}>取消</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(v => (
              <label key={v} style={{ display: 'block', padding: '3px 8px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox" checked={selected.includes(v)}
                  onChange={() => toggle(v)}
                  style={{ marginRight: 6 }}
                />
                {v}
              </label>
            ))}
            {filtered.length === 0 && <div style={{ padding: 8, color: '#999', fontSize: 12 }}>无匹配</div>}
          </div>
        </div>
      )}
    </div>
  );
}
