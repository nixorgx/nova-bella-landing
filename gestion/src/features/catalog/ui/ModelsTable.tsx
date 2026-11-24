import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatBs } from "@/lib/money";
import { STOCK_LABEL, stockState } from "@/lib/stock-state";
import type { LineOption, ModelFilters, ModelRow } from "../queries";

export function ModelFiltersForm({ lines, filters }: { lines: readonly LineOption[]; filters: ModelFilters }) {
  return (
    <form method="get" action="/catalogo" className="filters" role="search" aria-label="Filtrar modelos">
      <div className="field">
        <label className="field__label" htmlFor="f-q">Nombre</label>
        <input id="f-q" name="q" type="search" className="field__control" defaultValue={filters.q ?? ""} placeholder="Ej. Alba" autoComplete="off" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="f-linea">Línea</label>
        <select id="f-linea" name="linea" className="field__control" defaultValue={filters.lineId ?? ""}>
          <option value="">Todas</option>
          {lines.map((line) => (
            <option key={line.id} value={line.id}>{line.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="f-estado">Estado</label>
        <select id="f-estado" name="estado" className="field__control" defaultValue={filters.status ?? "all"}>
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>
      <div className="filters__buttons">
        <button type="submit" className="btn">Filtrar</button>
        <Link href="/catalogo" className="btn btn--quiet">Limpiar</Link>
      </div>
    </form>
  );
}

export function ModelsTable({ models, filtered }: { models: readonly ModelRow[]; filtered: boolean }) {
  if (models.length === 0) {
    return filtered ? (
      <EmptyState title="Ningún modelo coincide" action={<Link href="/catalogo" className="btn btn--small">Quitar filtros</Link>}>
        Pruebe con otra línea o con otro nombre.
      </EmptyState>
    ) : (
      <EmptyState title="Todavía no hay modelos" action={<Link href="/catalogo/modelos/nuevo" className="btn btn--primary btn--small">Crear el primer modelo</Link>}>
        Un modelo es un calzado (por ejemplo “Alba”). Luego le genera sus colores y tallas.
      </EmptyState>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table table--stack models-table">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Seleccionar para la tienda</span></th>
            <th scope="col">Modelo</th>
            <th scope="col">Línea</th>
            <th scope="col" className="num">Precio</th>
            <th scope="col" className="num">Variantes</th>
            <th scope="col" className="num">Colores</th>
            <th scope="col">Stock</th>
            <th scope="col">Estado</th>
            <th scope="col">Tienda</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const state = stockState(model.stock);
            return (
              <tr key={model.id} className={model.active ? undefined : "is-muted"}>
                <td data-label="Seleccionar" className="select-cell">
                  <input type="checkbox" name="ids" value={model.id} form="bulk-publish" aria-label={`Seleccionar ${model.name} para la tienda`} />
                </td>
                <td data-label="Modelo">
                  <Link className="row-link clip-2" href={`/catalogo/modelos/${model.id}`}>
                    {model.name}
                  </Link>
                </td>
                <td data-label="Línea">{model.line}</td>
                <td data-label="Precio" className="num">{formatBs(model.price)}</td>
                <td data-label="Variantes" className="num">
                  {model.variants === 0 ? <span className="badge badge--low">Sin variantes</span> : model.variants}
                </td>
                <td data-label="Colores" className="num">{model.colors}</td>
                <td data-label="Stock"><span className={`badge badge--${state}`}>{model.stock} · {STOCK_LABEL[state]}</span></td>
                <td data-label="Estado">
                  <span className={`badge ${model.active ? "badge--ok" : "badge--out"}`}>{model.active ? "Activo" : "Inactivo"}</span>
                </td>
                <td data-label="Tienda">
                  {model.publishedOnline ? <span className="badge badge--ok">En línea{model.photos === 0 ? " · sin fotos" : ""}</span> : <span className="is-muted">No publicado</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
