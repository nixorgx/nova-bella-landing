export interface RankedItem {
  readonly key: string;
  readonly label: string;
  readonly sub?: string;
  readonly value: number;
  /** Text printed at the tip of the bar (never colored: text wears ink tokens). */
  readonly valueLabel: string;
}

/**
 * Ranked horizontal bars, one hue, largest first. A real ordered list: every value is printed at
 * the tip of its bar, so it needs no tooltip and no table fallback.
 */
export function RankedBars({
  items,
  label,
  tone = "accent",
}: {
  items: readonly RankedItem[];
  label: string;
  tone?: "accent" | "cost";
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ol className={`rank rank--${tone}`} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="rank__row">
          <span className="rank__name">
            <strong className="clip-2">{item.label}</strong>
            {item.sub ? <small>{item.sub}</small> : null}
          </span>
          <span className="rank__track" aria-hidden="true">
            <span className="rank__fill" style={{ "--w": `${Math.max(2, (Math.max(0, item.value) / max) * 100)}%` } as React.CSSProperties} />
          </span>
          <span className="rank__value num">{item.valueLabel}</span>
        </li>
      ))}
    </ol>
  );
}
