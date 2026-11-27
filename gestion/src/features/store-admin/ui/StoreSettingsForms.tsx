import { ActionForm } from "@/components/form/ActionForm";
import { FormCheckbox, FormField, FormSelect, FormTextarea } from "@/components/form/fields";
import { saveStoreSettingsAction, saveZoneAction, savePickupAction, uploadQrAction } from "../actions";
import type { BranchOption, PickupRow, StoreSettings, ZoneRow } from "../queries";
import { UploadForm } from "./UploadForm";

export function GeneralForm({ settings, branches }: { settings: StoreSettings; branches: readonly BranchOption[] }) {
  return (
    <ActionForm action={saveStoreSettingsAction} submitLabel="Guardar ajustes">
      <label className="switch">
        <input type="checkbox" name="open" defaultChecked={settings.open} />
        <span className="switch__track" aria-hidden="true" />
        <span>
          <strong>Tienda abierta</strong>
          <small>Cerrada: el catálogo se ve, pero no se reciben pedidos (se muestra un aviso).</small>
        </span>
      </label>
      <div className="form-grid">
        <FormField label="WhatsApp de la tienda" name="whatsapp" defaultValue={settings.whatsapp} inputMode="tel" placeholder="71234567" hint="Se usa en los botones “Consultar por WhatsApp” y en la confirmación del pedido." />
        <FormSelect label="Sucursal que despacha la tienda" name="branchId" defaultValue={settings.branchId} hint="De aquí sale el stock que ven los clientes y que descuenta cada pedido.">
          <option value="">Primera sucursal activa</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </FormSelect>
      </div>
      <FormTextarea label="Instrucciones de pago (banco, titular…)" name="bankInstructions" defaultValue={settings.bankInstructions} rows={3} maxLength={1000} hint="Se muestran junto al QR y en “Cómo comprar”." />
      <FormTextarea label="Política de cambios" name="policyExchange" defaultValue={settings.policyExchange} rows={2} maxLength={1000} />
      <FormTextarea label="Política de envíos" name="policyShipping" defaultValue={settings.policyShipping} rows={2} maxLength={1000} />
    </ActionForm>
  );
}

function ZoneForm({ zone }: { zone?: ZoneRow }) {
  return (
    <ActionForm action={saveZoneAction} submitLabel={zone ? "Guardar" : "Agregar zona"} resetOnSuccess={!zone} className="zone-form" submitClassName="btn btn--small">
      {zone ? <input type="hidden" name="id" value={zone.id} /> : null}
      <FormField label="Zona" name="name" defaultValue={zone?.name} maxLength={80} required />
      <FormField label="Costo (Bs)" name="fee" defaultValue={zone?.fee ?? ""} inputMode="decimal" placeholder="15,00" required />
      <FormField label="Detalle (opcional)" name="description" defaultValue={zone?.description ?? ""} maxLength={200} />
      <FormField label="Orden" name="sortOrder" defaultValue={String(zone?.sortOrder ?? 0)} inputMode="numeric" />
      <FormCheckbox label="Activa" name="active" defaultChecked={zone ? zone.active : true} />
    </ActionForm>
  );
}

export function ZonesPanel({ zones }: { zones: readonly ZoneRow[] }) {
  return (
    <div className="stack">
      {zones.length === 0 ? <p className="notice">Sin zonas, la tienda solo ofrece recojo. Agregue al menos una para vender con envío.</p> : null}
      {zones.map((zone) => <ZoneForm key={zone.id} zone={zone} />)}
      <h3 className="subhead">Nueva zona</h3>
      <ZoneForm />
    </div>
  );
}

function PickupForm({ point, branches }: { point?: PickupRow; branches: readonly BranchOption[] }) {
  return (
    <ActionForm action={savePickupAction} submitLabel={point ? "Guardar" : "Agregar punto"} resetOnSuccess={!point} className="zone-form" submitClassName="btn btn--small">
      {point ? <input type="hidden" name="id" value={point.id} /> : null}
      <FormSelect label="Sucursal" name="branchId" defaultValue={point?.branchId ?? branches[0]?.id ?? ""}>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </FormSelect>
      <FormField label="Nombre del punto" name="label" defaultValue={point?.label} maxLength={80} required />
      <FormField label="Dirección" name="address" defaultValue={point?.address ?? ""} maxLength={200} />
      <FormField label="Horario" name="hours" defaultValue={point?.hours ?? ""} maxLength={120} />
      <FormCheckbox label="Activo" name="active" defaultChecked={point ? point.active : true} />
    </ActionForm>
  );
}

export function PickupPanel({ points, branches }: { points: readonly PickupRow[]; branches: readonly BranchOption[] }) {
  return (
    <div className="stack">
      {points.length === 0 ? <p className="notice">Sin puntos de recojo, la tienda solo ofrece envío a domicilio.</p> : null}
      {points.map((p) => <PickupForm key={p.id} point={p} branches={branches} />)}
      <h3 className="subhead">Nuevo punto de recojo</h3>
      <PickupForm branches={branches} />
    </div>
  );
}

export function QrPanel({ hasQr }: { hasQr: boolean }) {
  return (
    <div className="qr-panel">
      {hasQr ? (
        <figure className="qr-panel__preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated preview route */}
          <img src="/tienda-online/qr" alt="QR de pago actual" width={200} height={200} />
          <figcaption>QR actual</figcaption>
        </figure>
      ) : (
        <p className="notice">Todavía no hay QR. Sin él, los pedidos por QR solo muestran las instrucciones de texto.</p>
      )}
      <UploadForm action={uploadQrAction} fileName="qr" label="Imagen del QR del banco" hint="Suba la imagen que le da su banco (captura o archivo). Se guarda sin pérdida para que siga siendo escaneable." submitLabel={hasQr ? "Reemplazar QR" : "Subir QR"} />
    </div>
  );
}
