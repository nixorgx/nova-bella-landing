import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { uuidParam, type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions, pickBranch } from "@/features/branches/queries";
import { getOpenSession } from "@/features/cash/queries";
import { CashStrip, NoCashBanner } from "@/features/cash/ui/CashBanner";
import { getMaxDiscountPct } from "@/features/settings/discount";
import { PosScreen } from "@/features/sales/ui/PosScreen";

export const metadata: Metadata = { title: "Punto de venta" };

export default async function PosPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin", "seller");
  const session = toSession(user);
  const requested = uuidParam((await searchParams).sucursal);
  const isAdmin = user.role === "superadmin";
  const branches = await listBranchOptions(session);
  const branch = pickBranch(session, branches, requested);

  if (!branch) {
    return (
      <div className="page">
        <PageHead eyebrow="Ventas" title="Punto de venta" />
        <EmptyState title="No hay una sucursal activa">Pida al superadmin que active su sucursal para poder vender.</EmptyState>
      </div>
    );
  }

  const [cash, maxDiscountPct] = await Promise.all([getOpenSession(session, branch.id), getMaxDiscountPct(session)]);

  return (
    <div className="page page--wide">
      <PageHead eyebrow={`Ventas · ${branch.name}`} title="Punto de venta" description="Escanee, ajuste el precio si hace falta, cobre y entregue el ticket.">
        {isAdmin && branches.length > 1 ? (
          <form method="get" action="/ventas" className="head-actions" aria-label="Elegir sucursal">
            <label className="field__label" htmlFor="pos-branch">Sucursal</label>
            <select id="pos-branch" name="sucursal" className="field__control" defaultValue={branch.id}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="submit" className="btn btn--small">Cambiar</button>
          </form>
        ) : null}
      </PageHead>
      {cash ? (
        <>
          <CashStrip cash={cash} />
          <PosScreen branchId={branch.id} branchName={branch.name} maxDiscountPct={isAdmin ? null : maxDiscountPct} isAdmin={isAdmin} />
        </>
      ) : (
        <>
          <NoCashBanner branchId={branch.id} branchName={branch.name} isAdmin={isAdmin} />
          <p className="field__hint">Mientras tanto puede <Link href="/stock" className="link-button">consultar el stock</Link>.</p>
        </>
      )}
    </div>
  );
}
