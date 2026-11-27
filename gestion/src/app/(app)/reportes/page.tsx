import type { Metadata } from "next";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions } from "@/features/branches/queries";
import { listSellers } from "@/features/sales/queries";
import { readReportFilters, scopeFor, viewParam } from "@/features/reports/scope";
import { ReportFilters } from "@/features/reports/ui/ReportFilters";
import { pickView, ReportTabs } from "@/features/reports/ui/ReportTabs";
import { ExchangesView } from "@/features/reports/ui/views/ExchangesView";
import { ModelsView } from "@/features/reports/ui/views/ModelsView";
import { ProfitView } from "@/features/reports/ui/views/ProfitView";
import { SellersView } from "@/features/reports/ui/views/SellersView";
import { StockView } from "@/features/reports/ui/views/StockView";
import { SummaryView } from "@/features/reports/ui/views/SummaryView";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin", "seller");
  const session = toSession(user);
  const isAdmin = user.role === "superadmin";
  const params = await searchParams;
  const filters = readReportFilters(params);
  const view = pickView(user.role, viewParam(params));
  // Sellers are pinned to their own branch and sales here and again inside every query.
  const scope = scopeFor(session, filters.period, filters);
  const [branches, sellers] = isAdmin
    ? await Promise.all([listBranchOptions(session, { includeInactive: true }), listSellers(session)])
    : [undefined, undefined];
  const props = { user, filters, scope };

  return (
    <div className="page page--wide">
      <PageHead
        eyebrow={isAdmin ? "Reportes" : (user.branchName ?? "Mi sucursal")}
        title={isAdmin ? "Reportes" : "Mis ventas"}
        description={
          isAdmin
            ? "Ventas, modelos y tallas, stock, descuentos y utilidad. Todo se puede descargar en Excel."
            : "Lo que vendiste en el período elegido, por método de pago, modelo y talla."
        }
      />
      <ReportFilters basePath="/reportes" filters={filters} view={view.id} branches={branches} sellers={sellers} />
      <ReportTabs role={user.role} current={view.id} filters={filters} basePath="/reportes" />
      {view.id === "resumen" ? <SummaryView {...props} /> : null}
      {view.id === "modelos" ? <ModelsView {...props} /> : null}
      {view.id === "stock" ? <StockView {...props} /> : null}
      {view.id === "vendedores" ? <SellersView {...props} /> : null}
      {view.id === "cambios" ? <ExchangesView {...props} /> : null}
      {view.id === "rentabilidad" ? <ProfitView {...props} /> : null}
    </div>
  );
}
