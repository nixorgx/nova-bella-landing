import { formatBs } from "@/lib/money";
import { waLink } from "../whatsapp";
import type { StoreInfo } from "../public-data";

/** "Cómo comprar": payment, delivery, exchange policy. Lives at the END of the page, as the client asked. */
export function PurchaseInfo({ info }: { info: StoreInfo }) {
  const chat = waLink(info.whatsapp, "Hola NovaBella, tengo una consulta sobre una compra.");
  const fees = info.zones.map((zone) => `${zone.name}: ${formatBs(zone.fee)}`);
  return (
    <section className="howto" id="como-comprar" aria-labelledby="howto-title">
      <div className="howto__inner">
        <header className="howto__head">
          <p className="eyebrow howto__eyebrow">Antes de pedir</p>
          <h2 id="howto-title">Cómo comprar</h2>
        </header>
        <ol className="howto__steps">
          <li>
            <strong>Pague como prefiera</strong>
            <p>
              Con el QR de su banco (al pedir verá el QR y el monto exacto, y sube el comprobante) o contra entrega / en tienda.
              Factura: indique su NIT al pedir.
            </p>
          </li>
          <li>
            <strong>Reciba en casa o recoja</strong>
            <p>
              {info.policy_shipping ?? "Entrega a domicilio o recojo en tienda sin costo."}
              {fees.length > 0 ? ` Envíos: ${fees.join(" · ")}.` : ""}
            </p>
          </li>
          <li>
            <strong>Cambios de talla</strong>
            <p>{info.policy_exchange ?? "Consulte por cambios de talla o modelo dentro del plazo acordado."}</p>
          </li>
        </ol>
        {chat ? (
          <a className="btn howto__chat" href={chat} target="_blank" rel="noopener noreferrer">
            Consultar por WhatsApp
          </a>
        ) : null}
      </div>
    </section>
  );
}
