"use server";

import { requireRole, toSession } from "@/lib/auth/guards";
import { withUser } from "@/lib/db";
import { firstErrors, formToValues, type FormState } from "@/lib/form";
import { attempt, optionalId, revalidateCatalog } from "./action-support";
import { activeSchema, colorSchema, idSchema, lineSchema, sizeSchema } from "./schemas";

/** Closed maps: table names never come from user input. */
const ACTIVE_TABLES = {
  line: "product_lines",
  color: "colors",
  size: "sizes",
  model: "models",
  variant: "variants",
} as const;
const DELETE_TABLES = { line: "product_lines", color: "colors", size: "sizes", model: "models" } as const;
const IN_USE = {
  line: "La línea tiene modelos. Desactívela en lugar de eliminarla.",
  color: "El color se usa en variantes. Desactívelo en lugar de eliminarlo.",
  size: "La talla se usa en variantes. Desactívela en lugar de eliminarla.",
  model: "El modelo tiene variantes. Desactívelo en lugar de eliminarlo.",
} as const;

export async function saveLineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = lineSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  const id = optionalId(values.id);
  return attempt(values, "Ya existe una línea con ese nombre.", async () => {
    await withUser(toSession(actor), (c) =>
      id
        ? c.query("update product_lines set name = $2 where id = $1", [id, parsed.data.name])
        : c.query("insert into product_lines (name) values ($1)", [parsed.data.name]),
    );
    return { message: id ? "Línea actualizada." : `Línea “${parsed.data.name}” creada.` };
  });
}

export async function saveColorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = colorSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  const id = optionalId(values.id);
  const { name, hex } = parsed.data;
  return attempt(values, "Ya existe un color con ese nombre.", async () => {
    await withUser(toSession(actor), (c) =>
      id
        ? c.query("update colors set name = $2, hex = $3 where id = $1", [id, name, hex])
        : c.query("insert into colors (name, hex) values ($1, $2)", [name, hex]),
    );
    return { message: id ? "Color actualizado." : `Color “${name}” creado.` };
  });
}

export async function saveSizeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = sizeSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  const id = optionalId(values.id);
  const { label, sortOrder } = parsed.data;
  return attempt(values, "Ya existe esa talla.", async () => {
    await withUser(toSession(actor), (c) =>
      id
        ? c.query("update sizes set label = $2, sort_order = $3 where id = $1", [id, label, sortOrder])
        : c.query("insert into sizes (label, sort_order) values ($1, $2)", [label, sortOrder]),
    );
    return { message: id ? "Talla actualizada." : `Talla ${label} creada.` };
  });
}

/** Activates or deactivates any catalog entity (hidden fields: entity, id, active). */
export async function setActiveAction(formData: FormData): Promise<void> {
  const actor = await requireRole("superadmin");
  const entity = String(formData.get("entity")) as keyof typeof ACTIVE_TABLES;
  const table = ACTIVE_TABLES[entity];
  const parsed = activeSchema.safeParse({ id: formData.get("id"), active: formData.get("active") });
  if (!table || !parsed.success) return;
  await withUser(toSession(actor), (c) =>
    c.query(`update ${table} set active = $2 where id = $1`, [parsed.data.id, parsed.data.active]),
  );
  revalidateCatalog();
}

/** Deletes an entry nothing references; foreign keys refuse anything in use. */
export async function deleteEntityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const entity = String(formData.get("entity")) as keyof typeof DELETE_TABLES;
  const table = DELETE_TABLES[entity];
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!table || !parsed.success) return { ok: false, message: "No se pudo eliminar." };
  try {
    await withUser(toSession(actor), (c) => c.query(`delete from ${table} where id = $1`, [parsed.data.id]));
  } catch (error) {
    const inUse = (error as { code?: string }).code === "23503";
    return { ok: false, message: inUse ? IN_USE[entity] : "No se pudo eliminar. Intente nuevamente." };
  }
  revalidateCatalog();
  return { ok: true, message: "Eliminado." };
}
