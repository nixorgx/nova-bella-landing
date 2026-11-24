import { setActiveAction } from "../entity-actions";

type Entity = "line" | "color" | "size" | "model" | "variant";

/** Server-action form that flips `active` for any catalog entity. */
export function ActiveToggle({
  entity,
  id,
  active,
  subject,
}: {
  entity: Entity;
  id: string;
  active: boolean;
  subject: string;
}) {
  return (
    <form action={setActiveAction} className="inline-form">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button
        type="submit"
        className={`btn btn--small ${active ? "btn--danger" : ""}`}
        aria-label={`${active ? "Desactivar" : "Activar"} ${subject}`}
      >
        {active ? "Desactivar" : "Activar"}
      </button>
    </form>
  );
}
