import { filterQuery, type ReportFilters } from "../scope";

/** Plain link to the xlsx route handler: the browser downloads it, nothing runs on the client. */
export function ExportButton({
  report,
  filters,
  label = "Descargar Excel",
  extra,
  cost,
}: {
  report: string;
  filters: ReportFilters;
  label?: string;
  extra?: Readonly<Record<string, string | undefined>>;
  cost?: boolean;
}) {
  return (
    <a className={`btn btn--small${cost ? " btn--cost" : ""}`} href={`/reportes/exportar/${report}?${filterQuery(filters, extra)}`} download>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2v8m0 0L5 7m3 3 3-3M3 13h10" />
      </svg>
      {label}
    </a>
  );
}
