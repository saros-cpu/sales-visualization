import { useEffect, useMemo, useRef, useState } from 'react';

type WallLang = 'zh' | 'ru';

interface InventoryRow {
  shopKey: number;
  name: string;
  short: string;
  fillPercent?: number | null;
  daysRemaining?: number | null;
  resourceName?: string;
  inventoryZeroedByMapRule?: boolean;
}

interface InventoryPanelProps {
  stations: Array<{
    shopKey: number;
    name?: string;
    short?: string;
    inventoryByResource?: Array<{
      name?: string;
      inventory?: number;
      capacity?: number;
      fillPercent?: number;
      fillStatus?: string;
      daysRemaining?: number | null;
    }>;
    inventoryFillPercent?: number;
    daysRemaining?: number | null;
    status?: string;
    statusType?: string;
    inventoryZeroedByMapRule?: boolean;
  }>;
  lang: WallLang;
}

const LABELS: Record<string, Record<WallLang, string>> = {
  title: { zh: '库存概览', ru: 'Запасы' },
  collapsed: { zh: '库存概览', ru: 'Запасы' },
  station: { zh: '站点', ru: 'АЗС' },
  fuel: { zh: '油品', ru: 'Топливо' },
  fill: { zh: '液位', ru: 'Уровень' },
  days: { zh: '预计天数', ru: 'Дней' },
  noData: { zh: '暂无低库存数据', ru: 'Нет данных о запасах' },
};

function urgencyClass(days: number | null | undefined): string {
  if (days == null) return '';
  if (days < 1) return 'is-critical';
  if (days < 3) return 'is-warning';
  return '';
}

export default function InventoryPanel({ stations, lang }: InventoryPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const t = (key: string) => LABELS[key]?.[lang] ?? LABELS[key]?.zh ?? key;

  // WebView2/Chromium can silently eat wheel events over a WebView2 control,
  // and React attaches `onWheel` as a passive listener (so preventDefault is a
  // no-op). Attach a real non-passive listener and scroll the panel manually
  // so the inventory list is always scrollable regardless of host quirks.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollHeight > el.clientHeight) {
        el.scrollTop += e.deltaY;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [collapsed]);

  const rows: InventoryRow[] = useMemo(() => {
    const result: InventoryRow[] = [];
    for (const s of stations) {
      if (s.status === 'closed' || s.statusType === 'closed' || s.statusType === 'stopped') continue;
      if (s.inventoryZeroedByMapRule) continue;

      const resources = s.inventoryByResource || [];
      if (resources.length > 0) {
        for (const r of resources) {
          const fill = r.fillPercent ?? (r.capacity && r.capacity > 0 && r.inventory != null ? (r.inventory / r.capacity) * 100 : null);
          if (fill == null) continue;
          if (fill > 60) continue; // 高于60%液位不显示
          let days: number | null;
          if (fill < 10) {
            days = 0; // 罐底油，无法销售，预计天数为0
          } else {
            // 10%~60%：按最近七天平均每天销售量估算可销售天数（后端写入行级 daysRemaining）
            days = r.daysRemaining ?? s.daysRemaining ?? null;
          }
          result.push({
            shopKey: s.shopKey,
            name: s.name || '',
            short: s.short || '',
            fillPercent: fill,
            daysRemaining: days,
            resourceName: r.name || '',
          });
        }
      } else if (s.inventoryFillPercent != null) {
        const fill = s.inventoryFillPercent;
        if (fill > 60) continue;
        const days = fill < 10 ? 0 : (s.daysRemaining ?? null);
        result.push({
          shopKey: s.shopKey,
          name: s.name || '',
          short: s.short || '',
          fillPercent: fill,
          daysRemaining: days,
          resourceName: '',
        });
      }
    }
    result.sort((a, b) => {
      const da = a.daysRemaining ?? 9999;
      const db = b.daysRemaining ?? 9999;
      return da - db || (a.fillPercent ?? 0) - (b.fillPercent ?? 0);
    });
    return result;
  }, [stations]);

  if (rows.length === 0) return null;

  return (
    <div className={`wallpaper-inventory wallpaper-hud ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        className="wallpaper-inventory-toggle"
        type="button"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="wallpaper-inventory-icon">⛽</span>
        <span className="wallpaper-inventory-label">{t('title')}</span>
        <span className="wallpaper-inventory-count">{rows.length}</span>
        <span className={`wallpaper-inventory-arrow ${collapsed ? '' : 'is-open'}`}>▾</span>
      </button>
      {!collapsed && (
        <div className="wallpaper-inventory-body" ref={bodyRef}>
          <div className="wallpaper-inventory-head">
            <span>{t('station')}</span>
            <span>{t('fuel')}</span>
            <span>{t('fill')}</span>
            <span>{t('days')}</span>
          </div>
          {rows.map((row) => (
            <div key={`${row.shopKey}-${row.resourceName}`} className="wallpaper-inventory-row">
              <span className="inv-station">{row.name || row.short}</span>
              <span className="inv-fuel">{row.resourceName || '--'}</span>
              <span className="inv-fill">{row.fillPercent != null ? `${row.fillPercent.toFixed(1)}%` : '--'}</span>
              <span className={`inv-days ${urgencyClass(row.daysRemaining)}`}>
                {row.daysRemaining != null
                  ? row.daysRemaining === 0
                    ? '0'
                    : row.daysRemaining.toFixed(1)
                  : '--'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
