"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { withUser } from "@/lib/db";
import { friendlyDbMessage } from "@/lib/db-errors";
import { firstErrors, formToValues, type FormState } from "@/lib/form";
import { ImageRejected, processProductImage, processQr, readUpload } from "@/features/store/images";
import { STORE_TAG } from "@/features/store/public-data";
import { bulkPublishSchema, photoMetaSchema, pickupSchema, storeSettingsSchema, zoneSchema } from "./schemas";

const SETTINGS_PATH = "/tienda-online";

/** Anything that changes what shoppers see: refresh staff pages and expire the public cache right away. */
function changed(...paths: string[]): void {
  for (const path of [SETTINGS_PATH, ...paths]) revalidatePath(path);
  revalidatePath("/catalogo", "layout");
  updateTag(STORE_TAG);
}

function fail(error: unknown, values?: Record<string, string>): FormState {
  const code = (error as { code?: string }).code;
  if (code === "23505") return { ok: false, message: "Ya existe un registro con ese nombre.", values };
  return { ok: false, message: error instanceof ImageRejected ? error.message : friendlyDbMessage(error), values };
}

export async function saveStoreSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = storeSettingsSchema.safeParse({ ...values, open: values.open === "on" });
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  const p = parsed.data;
  const rows: [string, string | null][] = [
    ["store_open", String(p.open)],
    ["store_whatsapp", p.whatsapp],
    ["store_branch_id", p.branchId],
    ["store_bank_instructions", p.bankInstructions],
    ["store_policy_exchange", p.policyExchange],
    ["store_policy_shipping", p.policyShipping],
  ];
  try {
    await withUser(toSession(actor), async (c) => {
      for (const [key, value] of rows) {
        await c.query(
          "insert into app_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()",
          [key, value],
        );
      }
    });
  } catch (error) {
    return fail(error, values);
  }
  changed();
  return { ok: true, message: p.open ? "Ajustes guardados. La tienda está abierta." : "Ajustes guardados. La tienda está cerrada: el catálogo se ve, pero no se reciben pedidos.", values };
}

export async function saveZoneAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = zoneSchema.safeParse({ ...values, active: values.active === "on" });
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  const z = parsed.data;
  try {
    await withUser(toSession(actor), (c) =>
      z.id
        ? c.query("update store_delivery_zones set name = $2, description = $3, fee = $4, sort_order = $5, active = $6 where id = $1", [z.id, z.name, z.description, z.fee, z.sortOrder, z.active])
        : c.query("insert into store_delivery_zones (name, description, fee, sort_order, active) values ($1, $2, $3, $4, $5)", [z.name, z.description, z.fee, z.sortOrder, z.active]),
    );
  } catch (error) {
    return fail(error, values);
  }
  changed();
  return { ok: true, message: z.id ? "Zona actualizada." : `Zona “${z.name}” creada.` };
}

export async function savePickupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = pickupSchema.safeParse({ ...values, active: values.active === "on" });
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  const p = parsed.data;
  try {
    await withUser(toSession(actor), (c) =>
      p.id
        ? c.query("update store_pickup_points set branch_id = $2, label = $3, address = $4, hours = $5, active = $6 where id = $1", [p.id, p.branchId, p.label, p.address, p.hours, p.active])
        : c.query("insert into store_pickup_points (branch_id, label, address, hours, active) values ($1, $2, $3, $4, $5)", [p.branchId, p.label, p.address, p.hours, p.active]),
    );
  } catch (error) {
    return fail(error, values);
  }
  changed();
  return { ok: true, message: p.id ? "Punto de recojo actualizado." : `Punto “${p.label}” creado.` };
}

/** The shop's payment QR: sharp re-encodes it losslessly; the file never reaches the database as uploaded. */
export async function uploadQrAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  try {
    const { image, etag } = await processQr(await readUpload(formData.get("qr") as File | null));
    await withUser(toSession(actor), (c) =>
      c.query(
        `insert into store_assets (key, bytes, etag, updated_by) values ('payment_qr', $1, $2, $3)
         on conflict (key) do update set bytes = excluded.bytes, etag = excluded.etag, updated_at = now(), updated_by = excluded.updated_by`,
        [image.bytes, etag, actor.id],
      ),
    );
  } catch (error) {
    return fail(error);
  }
  changed();
  return { ok: true, message: "QR de pago actualizado." };
}

export async function uploadModelPhotoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const parsed = photoMetaSchema.safeParse({ modelId: formData.get("modelId"), colorId: formData.get("colorId") ?? "", alt: formData.get("alt") ?? undefined });
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues) };
  const { modelId, colorId, alt } = parsed.data;
  try {
    const set = await processProductImage(await readUpload(formData.get("photo") as File | null));
    await withUser(toSession(actor), async (c) => {
      const next = await c.query<{ n: number }>("select coalesce(max(position) + 1, 0)::int as n from model_images where model_id = $1", [modelId]);
      await c.query(
        `insert into model_images (model_id, color_id, position, alt, full_bytes, full_width, full_height, thumb_bytes, thumb_width, thumb_height, etag, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [modelId, colorId, Math.min(99, next.rows[0].n), alt, set.full.bytes, set.full.width, set.full.height, set.thumb.bytes, set.thumb.width, set.thumb.height, set.etag, actor.id],
      );
    });
  } catch (error) {
    return fail(error);
  }
  changed(`/catalogo/modelos/${modelId}`);
  return { ok: true, message: "Foto agregada." };
}

export async function deleteModelPhotoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const imageId = String(formData.get("imageId") ?? "");
  const modelId = String(formData.get("modelId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(imageId) || !/^[0-9a-f-]{36}$/i.test(modelId)) return { ok: false, message: "Solicitud no válida." };
  try {
    await withUser(toSession(actor), (c) => c.query("delete from model_images where id = $1 and model_id = $2", [imageId, modelId]));
  } catch (error) {
    return fail(error);
  }
  changed(`/catalogo/modelos/${modelId}`);
  return { ok: true, message: "Foto eliminada." };
}

export async function makeCoverPhotoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const imageId = String(formData.get("imageId") ?? "");
  const modelId = String(formData.get("modelId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(imageId) || !/^[0-9a-f-]{36}$/i.test(modelId)) return { ok: false, message: "Solicitud no válida." };
  try {
    await withUser(toSession(actor), async (c) => {
      await c.query("update model_images set position = least(position + 1, 99) where model_id = $1", [modelId]);
      await c.query("update model_images set position = 0 where id = $1 and model_id = $2", [imageId, modelId]);
    });
  } catch (error) {
    return fail(error);
  }
  changed(`/catalogo/modelos/${modelId}`);
  return { ok: true, message: "Foto principal actualizada." };
}

/** Publish / unpublish models. Publishing only touches models that are sellable (active, priced, with variants). */
export async function setPublishedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const parsed = bulkPublishSchema.safeParse({ mode: formData.get("mode"), ids: formData.getAll("ids") });
  if (!parsed.success) return { ok: false, message: "Seleccione al menos un modelo." };
  const { mode, ids } = parsed.data;
  if (mode !== "publish_ready" && ids.length === 0) return { ok: false, message: "Seleccione al menos un modelo." };
  const sellable = `active and base_sale_price > 0 and exists (select 1 from variants v where v.model_id = models.id and v.active)`;
  try {
    const result = await withUser(toSession(actor), (c) =>
      mode === "unpublish"
        ? c.query("update models set published_online = false where id = any($1::uuid[]) and published_online", [ids])
        : mode === "publish"
          ? c.query(`update models set published_online = true where id = any($1::uuid[]) and not published_online and ${sellable}`, [ids])
          : c.query(`update models set published_online = true where not published_online and ${sellable}`),
    );
    changed();
    const n = result.rowCount ?? 0;
    const text = mode === "unpublish" ? "quitados de la tienda" : "publicados en la tienda";
    return { ok: true, message: n === 0 ? "No hubo cambios (los modelos ya estaban así o no están listos: activos, con precio y variantes)." : `${n} ${n === 1 ? "modelo" : "modelos"} ${text}.` };
  } catch (error) {
    return fail(error);
  }
}
