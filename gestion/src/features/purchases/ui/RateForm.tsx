"use client";

import { ActionForm } from "@/components/form/ActionForm";
import { FormField } from "@/components/form/fields";
import { createRateAction } from "../actions";

/** Registers a new official / parallel pair. History is append-only: rates are never edited. */
export function RateForm({ today, official, parallel }: { today: string; official?: string; parallel?: string }) {
  return (
    <ActionForm action={createRateAction} submitLabel="Registrar tipo de cambio" pendingLabel="Registrando…" resetOnSuccess>
      <FormField label="Fecha" name="rateDate" type="date" defaultValue={today} max={today} required />
      <FormField label="TC oficial" name="officialRate" inputMode="decimal" autoComplete="off" placeholder="6,96" defaultValue={official} hint="Se usa por defecto para la parte 70%." required />
      <FormField label="TC paralelo" name="parallelRate" inputMode="decimal" autoComplete="off" placeholder="10,50" defaultValue={parallel} hint="Se usa por defecto para la parte 30%." required />
    </ActionForm>
  );
}
