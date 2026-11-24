export default function CatalogLoading() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando catálogo…</span>
      <div className="skeleton skeleton--title" />
      <div className="stats__tiles">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton skeleton--tile" />
        ))}
      </div>
      <div className="skeleton skeleton--block" />
    </div>
  );
}
