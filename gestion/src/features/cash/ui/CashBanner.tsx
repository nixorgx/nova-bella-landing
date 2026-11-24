import Link from "next/link";
import { formatBs } from "@/lib/money";
import { formatTime } from "@/lib/format";
import type { CashSessionInfo } from "../queries";
import { OpenCashForm } from "./OpenCashForm";

/** No open cash: the POS cannot sell, so say it loudly and offer the one-click fix. */
export function NoCashBanner({ branchId, branchName, isAdmin }: { branchId: string; branchName: string; isAdmin: boolean }) {
  return (
    <section className="cash-banner" aria-labelledby="cash-title">
      <h2 id="cash-title">No hay una caja abierta en {branchName}</h2>
      <p>Para registrar ventas primero abra la caja con el efectivo inicial del cajón.</p>
      <OpenCashForm branchId={branchId} branchName={branchName} isAdmin={isAdmin} />
    </section>
  );
}

export function CashStrip({ cash }: { cash: CashSessionInfo }) {
  return (
    <p className="cash-strip">
      <span>
        <strong>Caja abierta</strong> desde las {formatTime(cash.openedAt)} · apertura {formatBs(cash.openingAmount)}
        {cash.openedByName ? ` · ${cash.openedByName}` : ""}
      </span>
      <Link href="/ventas/caja">Ver o cerrar caja</Link>
    </p>
  );
}
