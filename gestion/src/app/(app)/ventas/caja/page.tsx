import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { uuidParam, type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions, pickBranch } from "@/features/branches/queries";
import { getCashSummary, getOpenSession } from "@/features/cash/queries";
import { listCashSessions } from "@/features/cash/session-report";
import { CashSessionTable } from "@/features/cash/ui/CashSessionTable";
import { NoCashBanner } from "@/features/cash/ui/CashBanner";
import { CloseCashForm } from "@/features/cash/ui/CloseCashForm";
import { PAYMENT_LABEL, PAYMENT_METHODS } from "@/features/sales/payments";

export const metadata: Metadata = { title: "Caja" };

export default async function CashPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin", "seller");
  const session = toSession(user);
  const isAdmin = user.role === "superadmin";
  const branches = await listBranchOptions(session);
  const branch = pickBranch(session, branches, uuidParam((await searchParams).sucursal));
  if (!branch) {
    return (
      <div className="page">
        <PageHead eyebrow="Ventas" title="Caja" />
        <EmptyState title="No hay una sucursal activa">Pida al superadmin que active su sucursal.</EmptyState>
      </div>
    );
  }
  const [open, recent] = await Promise.all([getOpenSession(session, branch.id), listCashSessions(session, { branchId: branch.id }, { page: 1, pageSize: 8 })]);
  const summary = open ? await getCashSummary(session, open) : null;

  return (
    <div className="page">
      <PageHead eyebrow={`Ventas · ${branch.name}`} title="Caja" description="Apertura y cierre del cajón, y el historial de sus turnos con el detalle de cada venta." />
      {isAdmin && branches.length > 1 ? (
        <form method="get" action="/ventas/caja" className="head-actions" aria-label="Elegir sucursal">
          <label className="field__label" htmlFor="cash-branch">Sucursal</label>
          <select id="cash-branch" name="sucursal" className="field__control" defaultValue={branch.id}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="submit" className="btn btn--small">Cambiar</button>
        </form>
      ) : null}

      {open && summary ? (
        <div className="cash-grid">
          <section className="panel" aria-labelledby="open-title">
            <div className="panel__head">
              <h2 id="open-title">Caja abierta</h2>
              <span className="badge badge--ok">Abierta</span>
            </div>
            <div className="panel__body stack">
              <dl className="money-list">
                <div><dt>Abierta</dt><dd>{formatDateTime(open.openedAt)}{open.openedByName ? ` · ${open.openedByName}` : ""}</dd></div>
                <div><dt>Efectivo inicial</dt><dd>{formatBs(open.openingAmount)}</dd></div>
                <div><dt>Ventas registradas</dt><dd>{summary.salesCount}{summary.voidCount > 0 ? ` (${summary.voidCount} anuladas)` : ""}</dd></div>
                {PAYMENT_METHODS.map((method) => (
                  <div key={method}><dt>{PAYMENT_LABEL[method]}</dt><dd>{formatBs(summary.byMethod[method])}</dd></div>
                ))}
                {summary.exchangeByMethod.efectivo !== "0.00" ? (
                  <div><dt>Cambios en efectivo (cobrado − devuelto)</dt><dd>{formatBs(summary.exchangeByMethod.efectivo)}</dd></div>
                ) : null}
                <div className="is-total"><dt>Total vendido</dt><dd>{formatBs(summary.salesTotal)}</dd></div>
                <div className="is-total"><dt>Efectivo esperado en caja</dt><dd>{formatBs(summary.expectedCash)}</dd></div>
              </dl>
              <Link href="/ventas" className="btn">Volver al punto de venta</Link>
            </div>
          </section>
          <section className="panel" aria-labelledby="close-title">
            <div className="panel__head"><h2 id="close-title">Cerrar caja</h2></div>
            <div className="panel__body">
              <CloseCashForm sessionId={open.id} openingAmount={open.openingAmount} cashSales={summary.byMethod.efectivo} cashExchangeNet={summary.exchangeByMethod.efectivo} />
            </div>
          </section>
        </div>
      ) : (
        <NoCashBanner branchId={branch.id} branchName={branch.name} isAdmin={isAdmin} />
      )}

      <section className="panel" aria-labelledby="past-title">
        <div className="panel__head"><h2 id="past-title">{isAdmin ? "Últimos turnos" : "Mis últimos turnos"}</h2>{isAdmin ? <Link className="row-link" href="/cajas">Ver todas las cajas</Link> : null}</div>
        {recent.rows.length === 0 ? (
          <div className="panel__body"><EmptyState title="Todavía no hay turnos">Aquí verá cada caja con su diferencia y sus ventas.</EmptyState></div>
        ) : (
          <CashSessionTable sessions={recent.rows} detailBase="/ventas/caja" showBranch={false} />
        )}
      </section>
    </div>
  );
}
