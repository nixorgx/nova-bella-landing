import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { D, dec, formatBs } from "@/lib/money";
import { one, uuidParam, type RawSearchParams } from "@/lib/search-params";
import { getBatch } from "@/features/purchases/batches";
import { listModelCosts } from "@/features/purchases/model-costs";
import { getPricingSettings } from "@/features/settings/pricing-settings";
import { PriceSuggestions } from "@/features/purchases/ui/PriceSuggestions";

export const metadata: Metadata = { title: "Lote de compra" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}

const rate = (value: string) => dec(value).toString().replace(".", ",");

export default async function BatchPage({ params, searchParams }: Props) {
  const user = await requireRole("superadmin");
  const session = toSession(user);
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const batch = await getBatch(session, id);
  if (!batch) notFound();
  const justCreated = one((await searchParams).nuevo) === "1";

  const [models, settings] = await Promise.all([listModelCosts(session, id), getPricingSettings(session)]);
  const units = batch.items.reduce((sum, item) => sum + item.qty, 0);
  const totalBs = batch.items.reduce((sum, item) => sum.plus(dec(item.unitCostBsLanded).times(item.qty)), new D(0));
  const totalUsd = batch.items.reduce((sum, item) => sum.plus(dec(item.unitCostUsd).times(item.qty)), new D(0));
  const freightPerUnit = units > 0 ? dec(batch.freightBs).div(units) : new D(0);

  return (
    <div className="page">
      <PageHead
        eyebrow={`Lote · ${batch.branchName}`}
        title={`Compra del ${formatPlainDate(batch.batchDate)}`}
        description={batch.supplier ? `Proveedor: ${batch.supplier}` : "Sin proveedor indicado"}
      >
        <div className="head-actions">
          <Link href="/compras" className="btn btn--quiet">Volver a lotes</Link>
          <Link href="/compras/nuevo" className="btn">Nuevo lote</Link>
        </div>
      </PageHead>

      {justCreated ? (
        <section className="summary" role="status" aria-labelledby="done-title">
          <h2 id="done-title">Lote registrado: el stock ya subió</h2>
          <dl className="summary__stats">
            <div><dt>Unidades</dt><dd>{units}</dd></div>
            <div><dt>Productos</dt><dd>{batch.items.length}</dd></div>
            <div><dt>Costo total</dt><dd>{formatBs(totalBs.toFixed(2))}</dd></div>
          </dl>
          <p>Abajo puede revisar los precios sugeridos con el nuevo costo. Nada cambia hasta que usted lo confirme.</p>
        </section>
      ) : null}

      <section className="panel panel--cost" aria-labelledby="snap-title">
        <div className="panel__head">
          <h2 id="snap-title">Tipos de cambio y flete del lote</h2>
          <span className="cost-tag">Costo · solo superadmin</span>
        </div>
        <div className="panel__body">
          <dl className="price-card__grid">
            <div><dt>TC parte {dec(batch.splitPct).toString()}%</dt><dd>{rate(batch.rate70)}</dd></div>
            <div><dt>TC parte {new D(100).minus(batch.splitPct).toString()}%</dt><dd>{rate(batch.rate30)}</dd></div>
            <div><dt>Flete total</dt><dd>{formatBs(batch.freightBs)}</dd></div>
            <div><dt>Flete por unidad</dt><dd>{formatBs(freightPerUnit.toFixed(2))}</dd></div>
            <div><dt>Total en USD</dt><dd>USD {totalUsd.toFixed(2).replace(".", ",")}</dd></div>
            <div><dt>Costo total puesto</dt><dd className="cost"><strong>{formatBs(totalBs.toFixed(2))}</strong></dd></div>
            <div><dt>Registrado</dt><dd>{formatDateTime(batch.createdAt)}</dd></div>
            <div><dt>Por</dt><dd>{batch.createdByName ?? "—"}</dd></div>
          </dl>
          {batch.notes ? <p className="field__hint">Notas: {batch.notes}</p> : null}
          <p className="field__hint">Estos valores quedaron guardados en el lote: si el tipo de cambio cambia después, este costo no se recalcula.</p>
        </div>
        <div className="table-wrap">
          <table className="table table--stack table--cost">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col">Color</th>
                <th scope="col" className="num">Talla</th>
                <th scope="col" className="num">Cant.</th>
                <th scope="col" className="num">USD unit.</th>
                <th scope="col" className="num">Bs unit. puesto</th>
                <th scope="col" className="num">Total Bs</th>
              </tr>
            </thead>
            <tbody>
              {batch.items.map((item) => (
                <tr key={item.variantId}>
                  <td data-label="Producto"><strong className="clip-2">{item.model}</strong><code className="sku">{item.sku}</code></td>
                  <td data-label="Color"><span className="color-cell"><span className="swatch" style={{ background: item.colorHex ?? "var(--ink-faint)" }} aria-hidden="true" />{item.color}</span></td>
                  <td data-label="Talla" className="num">{item.size}</td>
                  <td data-label="Cantidad" className="num">{item.qty}</td>
                  <td data-label="USD unitario" className="num">{item.unitCostUsd.replace(".", ",")}</td>
                  <td data-label="Bs unitario" className="num cost">{formatBs(item.unitCostBsLanded)}</td>
                  <td data-label="Total Bs" className="num cost"><strong>{formatBs(dec(item.unitCostBsLanded).times(item.qty).toFixed(2))}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="sugg-title">
        <div className="panel__head">
          <h2 id="sugg-title">Precios sugeridos con este lote</h2>
          <span className="eyebrow">Margen objetivo {settings.targetMarginPct.replace(".", ",")}%</span>
        </div>
        <PriceSuggestions models={models} targetMarginPct={settings.targetMarginPct} />
        <p className="panel__body field__hint">
          Es solo una sugerencia. Para cambiar un precio debe confirmarlo; <Link href="/compras/precios" className="link-button">ajuste el margen objetivo</Link> si lo necesita.
        </p>
      </section>
    </div>
  );
}
