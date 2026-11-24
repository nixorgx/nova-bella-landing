"use client";

import { useFormState } from "@/components/form/ActionForm";
import { ScanInput } from "@/components/scan/ScanInput";

/** Barcode input for a variant row: type it, use a USB reader, or scan with the camera. */
export function BarcodeField({ defaultValue, sku }: { defaultValue: string | null; sku: string }) {
  const state = useFormState();
  return (
    <ScanInput
      key={defaultValue ?? ""}
      compact
      name="barcode"
      label={`Código de barras de ${sku}`}
      defaultValue={defaultValue ?? ""}
      placeholder="Sin código · escanear o escribir"
      clearOnScan={false}
      error={state.fieldErrors?.barcode}
      onScan={() => undefined}
    />
  );
}
