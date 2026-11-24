"use client";

export default function PurchasesError({ reset }: { error: unknown; reset: () => void }) {
  return (
    <div className="page">
      <div className="empty empty--error" role="alert">
        <strong>No se pudo cargar esta pantalla</strong>
        <p>Hubo un problema al leer los datos de compras. Lo ya registrado está a salvo.</p>
        <button type="button" className="btn btn--primary" onClick={() => reset()}>
          Reintentar
        </button>
      </div>
    </div>
  );
}
