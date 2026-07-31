// 把中俄双语全称拆成「中文在上、俄文在下」两行。
// 与采购页 Procurement.tsx 的 splitBilingual 逻辑保持一致，集中在此便于各页面复用。
export interface BilingualParts {
  top: string;
  bottom: string;
}

export function splitBilingual(name?: string | null): BilingualParts {
  if (!name) return { top: '', bottom: '' };
  const idx = name.search(/[А-Яа-яЁё]/);
  if (idx <= 0) return { top: name, bottom: '' };
  const top = name.slice(0, idx).replace(/[\s"'«»“”‘’\-]+$/, '').trim();
  const bottom = name.slice(idx).trim();
  if (!top) return { top: name, bottom: '' };
  return { top, bottom };
}

// 判断是否为中俄双语（同时含中文与西里尔）。
export function isBilingual(name?: string | null): boolean {
  if (!name) return false;
  const hasCn = /[一-鿿]/.test(name);
  const hasCy = /[А-Яа-яЁё]/.test(name);
  return hasCn && hasCy;
}
