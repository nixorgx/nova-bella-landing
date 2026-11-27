import type { Metadata } from "next";
import Link from "next/link";
import { LANDING_URL } from "@/lib/landing-links";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { getStoreAdminData } from "@/features/store-admin/queries";
import { GeneralForm, PickupPanel, QrPanel, ZonesPanel } from "@/features/store-admin/ui/StoreSettingsForms";

export const metadata: Metadata = { title: "Tienda online" };

export default async function StoreAdminPage() {
  const user = await requireRole("superadmin");
  const data = await getStoreAdminData(toSession(user));
  const { settings } = data;
  return (
    <div className="page">
      <PageHead eyebrow="Etapa 2" title="Tienda online" description="Abra o cierre la tienda, configure entregas y pagos y publique sus modelos.">
        <div className="head-actions">
          <span className={`badge ${settings.open ? "badge--ok" : "badge--out"}`}>{settings.open ? "Abierta" : "Cerrada"}</span>
          <a className="btn" href={LANDING_URL} target="_blank" rel="noopener noreferrer">Ver la tienda</a>
          <Link className="btn btn--primary" href="/pedidos">Pedidos web</Link>
        </div>
      </PageHead>

      <section className="panel" aria-labelledby="pub-title">
        <div className="panel__head"><h2 id="pub-title">Catálogo publicado</h2><span className="eyebrow">{data.published} modelos en línea</span></div>
        <div className="panel__body">
          <p>
            Publique modelos desde el <Link href="/catalogo">catálogo</Link> (casilla de cada fila, o “Publicar todos los listos”) y suba sus fotos dentro de cada modelo.
            {data.readyToPublish > 0 ? ` Hay ${data.readyToPublish} modelos listos para publicar.` : ""}
          </p>
        </div>
      </section>

      <section className="panel" aria-labelledby="gen-title">
        <div className="panel__head"><h2 id="gen-title">Estado y contacto</h2></div>
        <div className="panel__body"><GeneralForm settings={settings} branches={data.branches} /></div>
      </section>

      <section className="panel" aria-labelledby="zones-title">
        <div className="panel__head"><h2 id="zones-title">Zonas de entrega</h2><span className="eyebrow">Costo de envío por zona</span></div>
        <div className="panel__body"><ZonesPanel zones={data.zones} /></div>
      </section>

      <section className="panel" aria-labelledby="pickup-title">
        <div className="panel__head"><h2 id="pickup-title">Puntos de recojo</h2><span className="eyebrow">Gratis</span></div>
        <div className="panel__body"><PickupPanel points={data.pickup} branches={data.branches} /></div>
      </section>

      <section className="panel" aria-labelledby="qr-title">
        <div className="panel__head"><h2 id="qr-title">QR de pago</h2></div>
        <div className="panel__body"><QrPanel hasQr={data.hasQr} /></div>
      </section>
    </div>
  );
}
