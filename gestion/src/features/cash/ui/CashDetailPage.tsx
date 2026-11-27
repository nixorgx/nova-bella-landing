import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { uuidParam } from "@/lib/search-params";
import { resolvePeriod } from "@/features/reports/period";
import { ExportButton } from "@/features/reports/ui/ExportButton";
import { getCashSessionReport, listSessionExchanges, listSessionSales } from "../session-report";
import { CashSessionDetailView } from "./CashSessionDetailView";

/** Shared by /cajas/[id] (superadmin) and /ventas/caja/[id] (a seller's own sessions). */
export async function CashDetailPage({ rawId, backHref, backLabel }: { rawId: string; backHref: string; backLabel: string }) {
  const user = await requireRole("superadmin", "seller");
  const id = uuidParam(rawId);
  if (!id) notFound();
  const session = toSession(user);
  const cash = await getCashSessionReport(session, id);
  if (!cash) notFound();
  const [sales, exchanges] = await Promise.all([listSessionSales(session, id), listSessionExchanges(session, id)]);
  const filters = { period: resolvePeriod({}), branchId: null, sellerId: null, channel: null };

  return (
    <div className="page page--wide">
      <PageHead eyebrow={`${cash.branchName} · ${formatDateTime(cash.openedAt)}`} title={cash.closedAt ? "Detalle de caja" : "Caja abierta"}>
        <div className="head-actions">
          <Link href={backHref} className="btn btn--quiet">{backLabel}</Link>
          <ExportButton report="caja" filters={filters} extra={{ sesion: cash.id }} label="Descargar Excel de esta caja" />
        </div>
      </PageHead>
      <CashSessionDetailView cash={cash} sales={sales} exchanges={exchanges} isAdmin={user.role === "superadmin"} />
    </div>
  );
}
