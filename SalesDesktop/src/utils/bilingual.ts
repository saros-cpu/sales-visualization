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
  const top = name.slice(0, idx).replace(/[\s"'«»“”‘’\-\/]+$/, '').trim();
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

// 公司名中常见的俄语法律形式词缀，比较俄文词重叠时忽略，避免把「CJSC」等
// 通用词当作实体特征词（如 Example vs 油气 都含 CJSC，不应因此判为同一实体）。
const LEGAL_RU_WORDS = new Set(['CJSC', 'ООО', 'ЗАО', 'ОАО', 'ТОО', 'ИП', 'ЧП', 'НПЗ', 'АЗС', 'AZS']);

// 提取俄文词（2+ 字母，转大写，去掉通用法律词缀），用于俄文词重叠判定。
function ruWords(s: string): string[] {
  return (s.match(/[А-Яа-яЁёA-Za-z]{2,}/g) || [])
    .map((w) => w.toUpperCase())
    .filter((w) => !LEGAL_RU_WORDS.has(w));
}

// 原始名与标准名的俄文词重叠 ≥50%（以原始名为基准）视为同一实体不同写法。
function ruOverlap(raw: string, name: string): boolean {
  const wa = ruWords(raw);
  const wb = ruWords(name);
  if (!wa.length || !wb.length) return false;
  const setB = new Set(wb);
  const hit = wa.filter((w) => setB.has(w)).length;
  return hit / wa.length >= 0.5;
}

/**
 * 判定是否应在标准名下方补显灰色小字原始名（便于核对）。
 * 同一实体不同写法（中文主名相同 / 俄文词重叠 ≥50%）时不补显，避免名称重复。
 * 从 BilingualName.tsx 提取为纯函数，便于单测护栏。
 */
export function shouldShowRaw(value?: string | null, raw?: string | null): boolean {
  const name = String(value || raw || '').trim();
  if (!name) return false;
  const rawTrim = (raw || '').trim();
  if (!rawTrim || rawTrim === name || name.includes(rawTrim)) return false;
  const cnPart = (s: string) => (s.match(/[\u4e00-\u9fff]+/g) || []).join('');
  const cnName = cnPart(name);
  const cnRaw = cnPart(raw || '');
  if (cnName && cnRaw && cnName === cnRaw) return false;
  if (ruOverlap(raw || '', name)) return false;
  return true;
}

