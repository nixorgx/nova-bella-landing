import { pctChange } from "../aggregate";

interface KpiProps {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  readonly hero?: boolean;
  readonly cost?: boolean;
  readonly children?: React.ReactNode;
}

export function Kpi({ label, value, note, hero, cost, children }: KpiProps) {
  return (
    <li className={`kpi${hero ? " kpi--hero" : ""}${cost ? " kpi--cost" : ""}`}>
      <span className="kpi__label">{label}</span>
      <strong className="kpi__value num">{value}</strong>
      {children}
      {note ? <span className="kpi__note">{note}</span> : null}
    </li>
  );
}

/** "▲ 12,5 % vs período anterior": direction in text and arrow, never color alone. */
export function Delta({ current, previous, label }: { current: string; previous: string; label: string }) {
  const change = pctChange(current, previous);
  if (change === null) return <span className="delta delta--flat">Sin período anterior para comparar</span>;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "■";
  const text = `${change > 0 ? "+" : ""}${change.toLocaleString("es-BO")} %`;
  return (
    <span className={`delta delta--${direction}`}>
      <span aria-hidden="true">{arrow}</span> {text} <span className="delta__vs">{label}</span>
    </span>
  );
}

export function KpiRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <ul className="kpis" aria-label={label}>{children}</ul>;
}
