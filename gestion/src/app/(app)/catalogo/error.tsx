"use client";

export default function CatalogError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="page">
      <div className="empty empty--error" role="alert">
        <strong>No se pudo cargar el catálogo</strong>
        <p>Hubo un problema al leer los datos. Sus cambios anteriores están a salvo.</p>
        <button type="button" className="btn btn--primary" onClick={() => retry()}>
          Reintentar
        </button>
      </div>
    </div>
  );
}
