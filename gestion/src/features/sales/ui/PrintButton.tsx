"use client";

/** Opens the browser print dialog: print on the 80 mm printer or choose "Guardar como PDF". */
export function PrintButton({ label = "Imprimir / Guardar PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn--primary" onClick={() => window.print()}>
      {label}
    </button>
  );
}
