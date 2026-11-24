import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { one, uuidParam, type RawSearchParams } from "@/lib/search-params";
import { getTransfer } from "@/features/transfers/queries";

export const metadata: Metadata = { title: "Transferencia" };

export default async function TransferDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireRole("superadmin");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!uuidParam(id)) notFound();
  const transfer = await getTransfer(toSession(user), id);
  if (!transfer) notFound();

  return (
    <div className="page">
      <PageHead
        eyebrow={`Transferencia T-${String(transfer.number).padStart(4, "0")}`}
        title={`${transfer.fromName} → ${transfer.toName}`}
        description={`${formatDateTime(transfer.createdAt)}${transfer.byName ? ` · registrada por ${transfer.byName}` : ""}`}
      >
        <Link href="/sucursales/transferencias" className="btn">Volver al historial</Link>
      </PageHead>
      {one(query.nueva) ? <p className="notice notice--ok" role="status">Transferencia registrada: el stock ya se movió.</p> : null}
      {transfer.note ? <p className="notice">{transfer.note}</p> : null}
      <section className="panel" aria-labelledby="lines-title">
        <div className="panel__head">
          <h2 id="lines-title">Productos</h2>
          <span className="eyebrow">{transfer.products} productos · {transfer.units} pares</span>
        </div>
        <div className="table-wrap">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Modelo</th>
                <th scope="col">Color</th>
                <th scope="col" className="num">Talla</th>
                <th scope="col" className="num">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {transfer.lines.map((line) => (
                <tr key={line.sku}>
                  <td data-label="SKU" className="num">{line.sku}</td>
                  <td data-label="Modelo">{line.model}</td>
                  <td data-label="Color">{line.color}</td>
                  <td data-label="Talla" className="num">{line.size}</td>
                  <td data-label="Cantidad" className="num">{line.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
