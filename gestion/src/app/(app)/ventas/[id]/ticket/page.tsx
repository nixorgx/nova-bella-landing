import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, toSession } from "@/lib/auth/guards";
import { saleNumberLabel } from "@/lib/format";
import { one, uuidParam, type RawSearchParams } from "@/lib/search-params";
import { getSaleDetail } from "@/features/sales/queries";
import { exchangeTicketHeightMm, ticketHeightMm, TICKET_WIDTH_MM } from "@/features/sales/ticket-size";
import { PrintButton } from "@/features/sales/ui/PrintButton";
import { ExchangeTicket } from "@/features/sales/ui/ExchangeTicket";
import { SaleTicket } from "@/features/sales/ui/SaleTicket";

export const metadata: Metadata = { title: "Ticket" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}


export default async function TicketPage({ params, searchParams }: Props) {
  const user = await requireRole("superadmin", "seller");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const sale = await getSaleDetail(toSession(user), id);
  if (!sale) notFound();
  const fresh = one((await searchParams).nueva) === "1";
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // 80 mm roll sized to the content. The <style> carries the request's CSP nonce.
  const groupId = one((await searchParams).cambio);
  const group = groupId ? sale.exchanges.find((candidate) => candidate.groupId === groupId) : undefined;
  if (groupId && !group) notFound();
  const height = group
    ? exchangeTicketHeightMm({ lines: group.lines.length, hasReason: Boolean(group.reason) })
    : ticketHeightMm({
        lines: sale.lines.length,
        payments: sale.payments.length,
        hasDiscount: sale.discount !== "0.00",
        hasCustomerId: Boolean(sale.customer?.ciNit),
        exchangeLines: sale.exchanges.reduce((n, g) => n + g.lines.length, 0),
      });
  const pageCss = `@page { size: ${TICKET_WIDTH_MM}mm ${height}mm; margin: 0; }`;

  return (
    <div className="page ticket-page">
      <style nonce={nonce}>{pageCss}</style>
      {fresh ? (
        <p className="notice notice--ok no-print" role="status">
          {group ? "Cambio registrado" : `Venta N° ${saleNumberLabel(sale.saleNumber)} registrada`}. Entregue el ticket al cliente.
        </p>
      ) : null}
      <div className="ticket-actions no-print">
        <PrintButton />
        <Link href="/ventas" className="btn">Nueva venta</Link>
        <Link href={`/ventas/${sale.id}`} className="btn btn--quiet">Ver detalle</Link>
      </div>
      <div className="ticket-wrap">
        {group ? <ExchangeTicket sale={sale} group={group} /> : <SaleTicket sale={sale} />}
      </div>
    </div>
  );
}
