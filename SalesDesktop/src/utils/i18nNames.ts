import { useTranslation } from 'react-i18next';

const REGION_KEY_ZH: Record<string, string> = {
  CTY-31: 'REG-06', chu: 'REG-01', CTY-30: 'REG-02', CTY-29: 'REG-04',
  CTY-33: 'REG-05', CTY-35: 'REG-03', CTY-36: 'CTY-20', CTY-34: 'CTY-19', CTY-30City: 'REG-07',
};

// 中文 → 英文 key 反向映射（API 返回中文区域名）
const ZH_REGION_KEY: Record<string, string> = {};
for (const [en, zh] of Object.entries(REGION_KEY_ZH)) {
  ZH_REGION_KEY[zh] = en;
}

// 英文 key → 中文（用于 Region.tsx 根据 activeRegion 英文 key 查 API 数据）
const EN_REGION_KEY: Record<string, string> = { ...REGION_KEY_ZH };

const REGION_ZH_RU: Record<string, string> = {
  'REG-03': 'CTY-18 область', 'REG-01': 'CTY-01',
  'CTY-20': 'CTY-14 область', 'REG-05': 'CTY-16 область',
  'REG-02': 'CTY-03', 'CTY-19': 'CTY-17 область',
  'REG-04': 'CTY-02', 'REG-06': 'CTY-04', 'REG-07': 'CTY-05',
  'REG-08': 'CTY-08',
};

const PRODUCT_ZH_RU: Record<string, string> = {
  'АИ-80': 'АИ-80',
  'АИ-92': 'АИ-92',
  'АИ-95': 'АИ-95',
  'АИ-100': 'АИ-100',
  'ДТ': 'ДТ',
  'ДТ -35': 'ДТ -35',
  'СПБТ': 'СПБТ',
  '液化气': 'СПБТ',
  '柴油': 'ДТ',
  '汽油': 'Бензин',
  '常柴': 'ДТ',
  '催柴': 'ДТ',
};

export { ZH_REGION_KEY, EN_REGION_KEY };
export function useNameI18n() {
  const { i18n } = useTranslation();
  const isRu = i18n.language === 'ru';
  const region = (input: string | undefined): string => {
    if (!input) return '';
    const zh = REGION_KEY_ZH[input] ?? input;
    return isRu && REGION_ZH_RU[zh] ? REGION_ZH_RU[zh] : zh;
  };
  const station = (s: { name?: string; short?: string } | undefined): string => {
    if (!s) return '';
    if (isRu && s.short) return s.short;
    return s.name ?? '';
  };
  const product = (name: string | undefined): string => {
    if (!name) return '';
    if (isRu) return PRODUCT_ZH_RU[name] ?? name;
    return name;
  };
  return { region, station, product, isRu };
}
