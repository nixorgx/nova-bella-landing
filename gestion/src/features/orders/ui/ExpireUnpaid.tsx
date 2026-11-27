"use client";

import { ActionForm } from "@/components/form/ActionForm";
import { FormField } from "@/components/form/fields";
import { expireUnpaidAction } from "../actions";

/** Housekeeping for the superadmin: clears spam or abandoned unpaid orders in one go. */
export function ExpireUnpaid() {
  return (
    <details className="oreason">
      <summary className="btn btn--small">Limpiar pedidos sin pagar</summary>
      <ActionForm action={expireUnpaidAction} submitLabel="Cancelar los vencidos" submitClassName="btn btn--danger" pendingLabel="Cancelando…">
        <FormField label="Más antiguos que (días)" name="days" defaultValue="3" inputMode="numeric" hint="Solo pedidos pendientes de pago y sin comprobante." />
      </ActionForm>
    </details>
  );
}
