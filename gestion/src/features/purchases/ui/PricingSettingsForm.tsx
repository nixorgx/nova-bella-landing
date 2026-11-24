"use client";

import { ActionForm } from "@/components/form/ActionForm";
import { FormField } from "@/components/form/fields";
import { savePricingSettingsAction } from "../actions";

export function PricingSettingsForm({ targetMarginPct, maxDiscountPct }: { targetMarginPct: string; maxDiscountPct: string | null }) {
  return (
    <ActionForm action={savePricingSettingsAction} submitLabel="Guardar políticas" pendingLabel="Guardando…">
      <FormField
        label="Margen objetivo (%)"
        name="targetMarginPct"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={targetMarginPct.replace(".", ",")}
        hint="Sobre el precio de venta. Con 40%, un costo de Bs 100 sugiere Bs 167."
        required
      />
      <FormField
        label="Descuento máximo del vendedor (%)"
        name="maxDiscountPct"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={maxDiscountPct ? maxDiscountPct.replace(".", ",") : ""}
        placeholder="Sin límite"
        hint="Vacío = sin límite. El POS bloquea precios por debajo del mínimo; el superadmin no tiene límite."
      />
    </ActionForm>
  );
}
