import React from 'react';
import { splitBilingual } from '@/utils/bilingual';

interface BilingualNameProps {
  /** 标准/双语名称（优先显示，并拆成中俄两行） */
  value?: string | null;
  /** 原始名（可选，与标准名不同且非其子集时才以灰色小字补充，便于核对） */
  raw?: string | null;
  /** 是否加粗主行（默认 true） */
  bold?: boolean;
}

/**
 * 中俄双语名称统一渲染：中文在上、俄文在下两行。
 * 与采购页「Example」等全称显示风格一致；各列表（批发查询、过磅记录）共用，避免显示标准不一。
 */
export default function BilingualName({ value, raw, bold = true }: BilingualNameProps) {
  const name = String(value || raw || '').trim();
  if (!name) return <>{'--'}</>;

  const { top, bottom } = splitBilingual(name);
  // 中文主名比较：同一实体不同写法（分隔符/引号/俄文拼写差异）时不补显原始名
  const cnPart = (s: string) => (s.match(/[\u4e00-\u9fff]+/g) || []).join('');
  const cnName = cnPart(name);
  const cnRaw = raw ? cnPart(raw) : '';
  const showRaw =
    !!raw &&
    !!raw.trim() &&
    raw.trim() !== name &&
    !name.includes(raw.trim()) &&
    !(cnName && cnRaw && cnName === cnRaw);

  return (
    <span style={{ display: 'inline-block', textAlign: 'center', lineHeight: 1.25 }}>
      <div style={{ fontWeight: bold ? 600 : 500 }}>{top || name}</div>
      {bottom && (
        <div style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.3, wordBreak: 'break-word' }}>{bottom}</div>
      )}
      {showRaw && (
        <div style={{ fontSize: 11, color: '#bfbfbf', lineHeight: 1.25 }}>{raw}</div>
      )}
    </span>
  );
}
