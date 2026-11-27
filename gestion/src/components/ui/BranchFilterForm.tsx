import Link from "next/link";

interface Props {
  /** Page the filter submits to (GET): the selection lives in ?sucursal= so the link is shareable. */
  readonly action: string;
  readonly branches: readonly { id: string; name: string }[];
  readonly selected: string | null;
  readonly label?: string;
}

/** "All branches / one branch" selector for the superadmin. Plain GET form: works without JavaScript. */
export function BranchFilterForm({ action, branches, selected, label = "Sucursal" }: Props) {
  const id = `branch-filter-${action.replace(/\W+/g, "-")}`;
  return (
    <form method="get" action={action} className="branch-filter" role="search" aria-label="Elegir sucursal">
      <div className="field">
        <label className="field__label" htmlFor={id}>{label}</label>
        <select id={id} name="sucursal" className="field__control" defaultValue={selected ?? ""}>
          <option value="">Todas las sucursales</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <button type="submit" className="btn">Ver</button>
      {selected ? <Link href={action} className="btn btn--quiet">Todas</Link> : null}
    </form>
  );
}
