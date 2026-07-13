interface StationNameStackProps {
  name?: string | null;
  short?: string | null;
  className?: string;
}

const CJK_RE = /[\u3400-\u9fff]/;
const CYRILLIC_RE = /[\u0400-\u052f]/;

function splitNameParts(value?: string | null) {
  return String(value || '')
    .split(/\s*(?:\r?\n|\/|\uff0f|\|)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function stationNameLines(name?: string | null, short?: string | null) {
  const seen = new Set<string>();
  const parts = [...splitNameParts(name), ...splitNameParts(short)].filter((part) => {
    if (seen.has(part)) return false;
    seen.add(part);
    return true;
  });
  const zh = parts.find((part) => CJK_RE.test(part));
  const ru = parts.find((part) => CYRILLIC_RE.test(part));
  const primary = zh || parts[0] || '-';
  const secondary = ru && ru !== primary ? ru : (parts.find((part) => part !== primary) || '');
  return {
    primary,
    secondary,
    title: secondary ? `${primary} / ${secondary}` : primary,
  };
}

export default function StationNameStack({ name, short, className }: StationNameStackProps) {
  const lines = stationNameLines(name, short);
  return (
    <span className={['station-name-stack', className].filter(Boolean).join(' ')} title={lines.title}>
      <span className="station-name-primary">{lines.primary}</span>
      {lines.secondary ? <span className="station-name-secondary">{lines.secondary}</span> : null}
    </span>
  );
}
