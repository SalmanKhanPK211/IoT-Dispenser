type Props = {
  /** 0-100, or null when unknown */
  pct: number | null;
  stale?: boolean;
};

export function levelTone(pct: number | null) {
  if (pct == null) return "muted" as const;
  if (pct < 10) return "danger" as const;
  if (pct < 30) return "warning" as const;
  return "water" as const;
}

const FILL: Record<string, string> = {
  water: "var(--color-water)",
  warning: "var(--color-warning)",
  danger: "var(--color-destructive)",
  muted: "var(--color-muted-foreground)",
};

export function TankGauge({ pct, stale }: Props) {
  const clamped = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const tone = levelTone(pct);
  const color = FILL[tone] ?? FILL["water"];

  const x = 14;
  const y = 10;
  const w = 92;
  const h = 190;
  const fillH = (h - 8) * (clamped / 100);
  const fillY = y + h - 4 - fillH;

  return (
    <div className="flex items-center gap-5">
      <svg width="120" height="212" viewBox="0 0 120 212" role="img" aria-label={`Tank ${clamped}% full`}>
        <defs>
          <clipPath id="tank-clip">
            <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} rx="14" />
          </clipPath>
          <linearGradient id="tank-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.75" />
            <stop offset="100%" stopColor="var(--color-water-deep)" stopOpacity="0.95" />
          </linearGradient>
        </defs>

        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx="18"
          fill="var(--color-secondary)"
          stroke="var(--color-border)"
          strokeWidth="2"
        />

        <g clipPath="url(#tank-clip)" opacity={stale ? 0.55 : 1}>
          <rect x={x + 4} y={fillY} width={w - 8} height={fillH} fill="url(#tank-fill)" />
          {clamped > 0 && (
            <g className="animate-wave">
              <path
                d={`M0 ${fillY} q 15 -8 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 v 12 H0 Z`}
                fill={color}
                opacity="0.55"
              />
            </g>
          )}
        </g>

        {[0, 25, 50, 75, 100].map((tick) => {
          const ty = y + h - 4 - (h - 8) * (tick / 100);
          return (
            <g key={tick}>
              <line
                x1={x + w}
                x2={x + w + 6}
                y1={ty}
                y2={ty}
                stroke="var(--color-border)"
                strokeWidth="2"
              />
            </g>
          );
        })}
      </svg>

      <div className="flex h-[212px] flex-col justify-between py-1 text-[11px] font-medium text-muted-foreground tnum">
        {[100, 75, 50, 25, 0].map((t) => (
          <span key={t}>{t}%</span>
        ))}
      </div>
    </div>
  );
}
