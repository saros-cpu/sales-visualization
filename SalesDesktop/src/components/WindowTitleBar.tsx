import { useState } from 'react';

const api = () => (window as any).electronAPI;

export default function WindowTitleBar({ title = '销售管理系统' }: { title?: string }) {
  const [hover, setHover] = useState<string | null>(null);

  const btnBase: React.CSSProperties = {
    width: 46,
    height: 32,
    border: 'none',
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'Segoe UI, Arial, sans-serif',
    color: '#333',
    WebkitAppRegion: 'no-drag' as any,
    outline: 'none',
    padding: 0,
    lineHeight: 1,
    transition: 'background 0.15s',
  };

  return (
    <div
      style={{
        height: 32,
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        WebkitAppRegion: 'drag' as any,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <span style={{ padding: '0 12px', fontSize: 13, fontWeight: 500, color: '#333' }}>{title}</span>
      <div style={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag' as any }}>
        <button
          style={{ ...btnBase, background: hover === 'min' ? '#e9e9e9' : 'transparent' }}
          onMouseEnter={() => setHover('min')}
          onMouseLeave={() => setHover(null)}
          onClick={() => api()?.minimize()}
          title="最小化"
        >
          &#9472;
        </button>
        <button
          style={{ ...btnBase, background: hover === 'max' ? '#e9e9e9' : 'transparent' }}
          onMouseEnter={() => setHover('max')}
          onMouseLeave={() => setHover(null)}
          onClick={() => api()?.maximize()}
          title="最大化/还原"
        >
          &#9633;
        </button>
        <button
          style={{
            ...btnBase,
            background: hover === 'close' ? '#e81123' : 'transparent',
            color: hover === 'close' ? '#fff' : '#333',
          }}
          onMouseEnter={() => setHover('close')}
          onMouseLeave={() => setHover(null)}
          onClick={() => api()?.close()}
          title="关闭"
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}
