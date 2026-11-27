import { ActionForm } from "@/components/form/ActionForm";
import { FormField } from "@/components/form/fields";
import { EmptyState } from "@/components/ui/EmptyState";
import { saveColorAction, saveLineAction, saveSizeAction } from "../entity-actions";
import type { ColorOption, LineOption, SizeOption } from "../queries";
import { ActiveToggle } from "./ActiveToggle";
import { EditableRow } from "./EditableRow";

function Panel({
  id,
  title,
  count,
  hint,
  children,
}: {
  id: string;
  title: string;
  count: number;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id}>{title}</h2>
        <span className="eyebrow">{count} en total</span>
      </div>
      <div className="panel__body stack">
        <p className="field__hint">{hint}</p>
        {children}
      </div>
    </section>
  );
}

export function LinesPanel({ lines }: { lines: readonly LineOption[] }) {
  return (
    <Panel id="lines-title" title="Líneas" count={lines.length} hint="Agrupan los modelos (Dama, Caballero, Niños…).">
      <ActionForm action={saveLineAction} submitLabel="Agregar línea" resetOnSuccess className="inline-add">
        <FormField label="Nueva línea" name="name" autoComplete="off" required placeholder="Ej. Dama" />
      </ActionForm>
      {lines.length === 0 ? (
        <EmptyState title="Aún no hay líneas">Cree la primera para poder registrar modelos.</EmptyState>
      ) : (
        <ul className="attr-list">
          {lines.map((line) => (
            <EditableRow
              key={line.id}
              entity="line"
              id={line.id}
              active={line.active}
              inUse={line.models > 0}
              action={saveLineAction}
              editLabel={`la línea ${line.name}`}
              summary={
                <>
                  <strong className="clip">{line.name}</strong>
                  <span className="field__hint">{line.models} modelos</span>
                </>
              }
              fields={<FormField label="Nombre" name="name" defaultValue={line.name} required />}
              toggle={<ActiveToggle entity="line" id={line.id} active={line.active} subject={`la línea ${line.name}`} />}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ColorsPanel({ colors }: { colors: readonly ColorOption[] }) {
  return (
    <Panel id="colors-title" title="Colores" count={colors.length} hint="Cada color tiene un tono para reconocerlo de un vistazo.">
      <ActionForm action={saveColorAction} submitLabel="Agregar color" resetOnSuccess className="inline-add">
        <FormField label="Nuevo color" name="name" autoComplete="off" required placeholder="Ej. Azul marino" />
        <FormField label="Tono" name="hex" type="color" defaultValue="#8a8070" className="color-input" />
      </ActionForm>
      {colors.length === 0 ? (
        <EmptyState title="Aún no hay colores">Agregue los colores con los que trabaja.</EmptyState>
      ) : (
        <ul className="attr-list attr-list--grid">
          {colors.map((color) => (
            <EditableRow
              key={color.id}
              entity="color"
              id={color.id}
              active={color.active}
              inUse={color.variants > 0}
              action={saveColorAction}
              editLabel={`el color ${color.name}`}
              summary={
                <>
                  <span className="swatch swatch--lg" style={{ background: color.hex }} aria-hidden="true" />
                  <span className="attr-row__text">
                    <strong className="clip">{color.name}</strong>
                    <span className="field__hint">{color.variants} variantes</span>
                  </span>
                </>
              }
              fields={
                <>
                  <FormField label="Nombre" name="name" defaultValue={color.name} required />
                  <FormField label="Tono" name="hex" type="color" defaultValue={color.hex} className="color-input" />
                </>
              }
              toggle={<ActiveToggle entity="color" id={color.id} active={color.active} subject={`el color ${color.name}`} />}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SizesPanel({ sizes }: { sizes: readonly SizeOption[] }) {
  return (
    <Panel id="sizes-title" title="Tallas" count={sizes.length} hint="El número de orden decide cómo se ordenan (38 antes que 39).">
      <ActionForm action={saveSizeAction} submitLabel="Agregar talla" resetOnSuccess className="inline-add">
        <FormField label="Nueva talla" name="label" autoComplete="off" required placeholder="Ej. 38" />
        <FormField label="Orden" name="sortOrder" inputMode="numeric" required placeholder="38" />
      </ActionForm>
      {sizes.length === 0 ? (
        <EmptyState title="Aún no hay tallas">Agregue las tallas que vende.</EmptyState>
      ) : (
        <ul className="attr-list attr-list--grid">
          {sizes.map((size) => (
            <EditableRow
              key={size.id}
              entity="size"
              id={size.id}
              active={size.active}
              inUse={size.variants > 0}
              action={saveSizeAction}
              editLabel={`la talla ${size.label}`}
              summary={
                <>
                  <span className="size-chip">{size.label}</span>
                  <span className="field__hint">{size.variants} variantes</span>
                </>
              }
              fields={
                <>
                  <FormField label="Talla" name="label" defaultValue={size.label} required />
                  <FormField label="Orden" name="sortOrder" inputMode="numeric" defaultValue={String(size.sortOrder)} required />
                </>
              }
              toggle={<ActiveToggle entity="size" id={size.id} active={size.active} subject={`la talla ${size.label}`} />}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
