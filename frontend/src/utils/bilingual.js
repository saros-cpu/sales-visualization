// 把中俄双语全称拆成「中文在上、俄文在下」两行。
// 与桌面端 SalesDesktop/src/utils/bilingual.ts 保持一致，便于两端显示统一。
export function splitBilingual(name) {
  if (!name) return { top: '', bottom: '' };
  const idx = name.search(/[А-Яа-яЁё]/);
  if (idx <= 0) return { top: name, bottom: '' };
  const top = name.slice(0, idx).replace(/[\s"'«»“”‘’\-]+$/, '').trim();
  const bottom = name.slice(idx).trim();
  if (!top) return { top: name, bottom: '' };
  return { top, bottom };
}

export function isBilingual(name) {
  if (!name) return false;
  const hasCn = /[一-鿿]/.test(name);
  const hasCy = /[А-Яа-яЁё]/.test(name);
  return hasCn && hasCy;
}
