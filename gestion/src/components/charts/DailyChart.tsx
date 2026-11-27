"use client";

import { useId, useMemo, useState } from "react";
import { bucketSeries, compactBs, niceMax, yTicks } from "@/lib/chart-scale";
import { formatBs } from "@/lib/money";

export interface DailyChartPoint {
  readonly day: string;
  readonly total: string;
  readonly count: number;
}

interface DailyChartProps {
  readonly title: string;
  readonly points: readonly DailyChartPoint[];
  readonly seriesLabel: string;
  /** Previous period, aligned by position (day 1 with day 1). Ignored when the bars are weeks. */
  readonly compare?: { readonly label: string; readonly points: readonly DailyChartPoint[] };
}

/**
 * Sales per day: one-hue columns (leather accent) and, optionally, the previous period as a thin
 * grey line on the SAME axis. Hover/touch/arrow keys show a tooltip, the values are also in the
 * table view below, so nothing depends on the pointer. Plain HTML + one SVG line, no chart library.
 */
export function DailyChart({ title, points, seriesLabel, compare }: DailyChartProps) {
  const uid = useId();
  const buckets = useMemo(() => bucketSeries(points), [points]);
  const weekly = buckets.length !== points.length;
  const prior = !weekly && compare ? compare.points.slice(0, buckets.length) : null;
  const [active, setActive] = useState<number | null>(null);

  const max = useMemo(
    () => Math.max(0, ...buckets.map((b) => Number(b.total)), ...(prior ?? []).map((p) => Number(p.total))),
    [buckets, prior],
  );
  const top = niceMax(max);
  const ticks = yTicks(max);
  const total = buckets.reduce((sum, b) => sum + Number(b.total), 0);
  const current = active === null ? null : buckets[active];
  const before = active === null || !prior ? null : (prior[active] ?? null);

  const line = prior
    ? prior.map((p, i) => `${((i + 0.5) / buckets.length) * 100},${100 - (Number(p.total) / top) * 100}`).join(" ")
    : "";

  function indexAt(event: React.PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(rect.width, 1);
    return Math.min(buckets.length - 1, Math.max(0, Math.floor(ratio * buckets.length)));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const last = buckets.length - 1;
    const keys: Record<string, number> = {
      ArrowRight: Math.min(last, (active ?? -1) + 1),
      ArrowLeft: Math.max(0, (active ?? 1) - 1),
      Home: 0,
      End: last,
    };
    if (event.key in keys) {
      event.preventDefault();
      setActive(keys[event.key]);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  return (
    <figure className="dchart" aria-labelledby={`${uid}-t`}>
      <figcaption className="dchart__cap">
        <strong id={`${uid}-t`}>{title}</strong>
        <ul className="legend" aria-label="Leyenda">
          <li><span className="legend__swatch" aria-hidden="true" />{seriesLabel}</li>
          {prior && compare ? <li><span className="legend__key" aria-hidden="true" />{compare.label}</li> : null}
        </ul>
      </figcaption>

      <div className="dchart__body">
        <ul className="dchart__y" aria-hidden="true">
          {ticks.map((tick) => (
            <li key={tick} style={{ "--at": `${(tick / top) * 100}%` } as React.CSSProperties}>{compactBs(tick)}</li>
          ))}
        </ul>
        <div
          className="dchart__plot"
          tabIndex={0}
          role="group"
          aria-label={`${title}. Use las flechas para recorrer los ${buckets.length} valores.`}
          onPointerMove={(event) => setActive(indexAt(event))}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          {ticks.map((tick) => (
            <span key={tick} className="dchart__grid" aria-hidden="true" style={{ "--at": `${(tick / top) * 100}%` } as React.CSSProperties} />
          ))}
          <ol className="dchart__bars" aria-hidden="true">
            {buckets.map((bucket, index) => (
              <li key={bucket.key} data-active={active === index ? "" : undefined}>
                <span
                  className="dchart__bar"
                  data-empty={Number(bucket.total) === 0 ? "" : undefined}
                  style={{ "--h": `${(Number(bucket.total) / top) * 100}%` } as React.CSSProperties}
                />
              </li>
            ))}
          </ol>
          {prior ? (
            <svg className="dchart__line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={line} />
            </svg>
          ) : null}
          {current ? (
            <div
              className="dchart__tip"
              style={{ "--x": `${((active as number) + 0.5) / buckets.length}` } as React.CSSProperties}
              data-flip={(active as number) > buckets.length * 0.6 ? "" : undefined}
            >
              <span className="dchart__tip-day">{current.label}</span>
              <strong className="num">{formatBs(current.total)}</strong>
              <span className="dchart__tip-note">{current.count} {current.count === 1 ? "venta" : "ventas"}</span>
              {before && compare ? (
                <span className="dchart__tip-note">
                  <span className="legend__key" aria-hidden="true" />{compare.label}: <span className="num">{formatBs(before.total)}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <p className="dchart__x" aria-hidden="true">
        <span>{buckets[0]?.label}</span>
        {buckets.length > 2 ? <span>{buckets[Math.floor(buckets.length / 2)].label}</span> : null}
        {buckets.length > 1 ? <span>{buckets[buckets.length - 1].label}</span> : null}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {current ? `${current.label}: ${formatBs(current.total)}, ${current.count} ventas` : ""}
      </p>

      <details className="dchart__table">
        <summary>Ver como tabla · total {formatBs(total.toFixed(2))}</summary>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{weekly ? "Semana" : "Día"}</th>
                <th scope="col" className="num">Ventas</th>
                <th scope="col" className="num">Monto</th>
                {prior && compare ? <th scope="col" className="num">{compare.label}</th> : null}
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket, index) => (
                <tr key={bucket.key}>
                  <th scope="row">{bucket.label}</th>
                  <td className="num">{bucket.count}</td>
                  <td className="num">{formatBs(bucket.total)}</td>
                  {prior ? <td className="num">{prior[index] ? formatBs(prior[index].total) : "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
