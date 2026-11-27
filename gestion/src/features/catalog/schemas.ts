import { z } from "zod";
import { parseMoney } from "@/lib/money";
import { MAX_COMBINATIONS } from "./variant-matrix";

const MAX_PRICE = 99_999.99;
const BARCODE_PATTERN = /^[\x21-\x7E]{3,48}$/;

function name(label: string, max: number) {
  return z
    .string({ error: `Ingrese ${label}.` })
    .trim()
    .min(1, `Ingrese ${label}.`)
    .max(max, `El nombre no puede pasar de ${max} caracteres.`);
}

const checkbox = z
  .string()
  .optional()
  .transform((value) => value === "on" || value === "true");

const priceField = z
  .string({ error: "Ingrese un precio válido en Bs (ej. 189,50)." })
  .transform((value, ctx) => {
    const money = parseMoney(value);
    if (money === null || Number(money) < 0 || Number(money) > MAX_PRICE) {
      ctx.addIssue({ code: "custom", message: "Ingrese un precio válido en Bs (ej. 189,50)." });
      return z.NEVER;
    }
    return money;
  });

export const lineSchema = z.object({ name: name("el nombre de la línea", 40) });

export const modelSchema = z.object({
  lineId: z.uuid("Seleccione una línea."),
  name: name("el nombre del modelo", 60),
  description: z
    .string()
    .trim()
    .max(500, "La descripción no puede pasar de 500 caracteres.")
    .optional()
    .transform((value) => (value ? value : null)),
  basePrice: priceField,
  active: checkbox,
});

export const colorSchema = z.object({
  name: name("el nombre del color", 30),
  hex: z
    .string({ error: "Elija un color válido." })
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Elija un color válido.")
    .transform((value) => value.toLowerCase()),
});

export const sizeSchema = z.object({
  label: name("la talla", 8),
  sortOrder: z
    .string({ error: "Ingrese un número entero (0 a 9999)." })
    .trim()
    .regex(/^\d{1,4}$/, "Ingrese un número entero (0 a 9999).")
    .transform(Number),
});

/** Optional barcode: empty input clears it. Printable ASCII only, so Code 128 can encode it. */
export const barcodeSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    if (!BARCODE_PATTERN.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "El código debe tener de 3 a 48 caracteres, sin espacios ni tildes.",
      });
      return z.NEVER;
    }
    return value;
  });

const idList = (empty: string) =>
  z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z.array(z.uuid()).min(1, empty),
  );

export const generateVariantsSchema = z
  .object({
    modelId: z.uuid(),
    colorIds: idList("Marque al menos un color."),
    sizeIds: idList("Marque al menos una talla."),
  })
  .refine((data) => data.colorIds.length * data.sizeIds.length <= MAX_COMBINATIONS, {
    message: `Demasiadas combinaciones (máximo ${MAX_COMBINATIONS} por vez).`,
    path: ["sizeIds"],
  });

export const idSchema = z.object({ id: z.uuid() });
export const activeSchema = z.object({
  id: z.uuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});
export const variantBarcodeSchema = z.object({ id: z.uuid(), barcode: barcodeSchema });

export type ModelInput = z.infer<typeof modelSchema>;
export type GenerateVariantsInput = z.infer<typeof generateVariantsSchema>;
