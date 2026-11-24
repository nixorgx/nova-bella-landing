export default function PurchasesLoading() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando compras…</span>
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--block" />
    </div>
  );
}
