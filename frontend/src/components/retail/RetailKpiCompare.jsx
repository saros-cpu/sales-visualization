import { pctColor } from '../../utils/retail-helpers';

function normalizePercent(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPercent(value) {
  if (value === 0) return '0.00%';
  return `${value > 0 ? '↑' : '↓'}${Math.abs(value).toFixed(2)}%`;
}

export default function RetailKpiCompare({ items = [] }) {
  const rows = items
    .map((item, index) => ({ ...item, value: normalizePercent(item?.value), index }))
    .filter(item => item.value !== null);

  if (!rows.length) return null;

  return (
    <div className="retail-kpi-compare" aria-label="同比环比">
      {rows.map(item => (
        <div
          key={`${item.label || 'compare'}-${item.index}`}
          className={`retail-kpi-compare-item ${item.value > 0 ? 'up' : item.value < 0 ? 'down' : 'neutral'}`}
        >
          <span className="retail-kpi-compare-label">{item.label}</span>
          <span className="retail-kpi-compare-value" style={{ color: pctColor(item.value) }}>
            {formatPercent(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
