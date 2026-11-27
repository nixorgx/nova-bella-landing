"use server";

import { requireRole, toSession } from "@/lib/auth/guards";
import { withUser } from "@/lib/db";
import { firstErrors, formToValues, type FormState } from "@/lib/form";
import { attempt, describeError, optionalId, revalidateCatalog } from "./action-support";
import { generateVariantsSchema, modelSchema, variantBarcodeSchema } from "./schemas";
import { generateVariants } from "./variant-generator";
import { setVariantBarcode } from "./variants";

export async function saveModelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = modelSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  const id = optionalId(values.id);
  const { lineId, name, description, basePrice, active } = parsed.data;
  return attempt(values, "Ya existe un modelo con ese nombre en esa línea.", async () => {
    const result = await withUser(toSession(actor), (c) =>
      id
        ? c.query<{ id: string }>(
            `update models set line_id = $2, name = $3, description = $4, base_sale_price = $5, active = $6
              where id = $1 returning id`,
            [id, lineId, name, description, basePrice, active],
          )
        : c.query<{ id: string }>(
            `insert into models (line_id, name, description, base_sale_price)
             values ($1, $2, $3, $4) returning id`,
            [lineId, name, description, basePrice],
          ),
    );
    const modelId = result.rows[0]?.id;
    return id
      ? { message: "Modelo guardado." }
      : { message: "Modelo creado.", redirectTo: `/catalogo/modelos/${modelId}` };
  });
}

export async function generateVariantsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const parsed = generateVariantsSchema.safeParse({
    modelId: formData.get("modelId"),
    colorIds: formData.getAll("colorIds"),
    sizeIds: formData.getAll("sizeIds"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues) };
  try {
    const { created, skipped } = await generateVariants(toSession(actor), parsed.data);
    revalidateCatalog();
    const createdText = created === 1 ? "Se creó 1 variante" : `Se crearon ${created} variantes`;
    const skippedText =
      skipped === 0 ? "." : skipped === 1 ? " y se omitió 1 que ya existía." : ` y se omitieron ${skipped} que ya existían.`;
    return { ok: true, message: `${createdText}${skippedText}` };
  } catch (error) {
    return { ok: false, message: describeError(error, "Ya existe una variante con esos datos.") };
  }
}

export async function setVariantBarcodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = variantBarcodeSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  return attempt(values, "Ese código de barras ya está en uso.", async () => {
    await setVariantBarcode(toSession(actor), parsed.data.id, parsed.data.barcode);
    return { message: parsed.data.barcode ? "Código guardado." : "Código quitado." };
  });
}
