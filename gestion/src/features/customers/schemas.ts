import { z } from "zod";

const optionalText = (max: number, pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .max(max, `No puede pasar de ${max} caracteres.`)
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      if (!pattern.test(value)) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return value;
    });

export const customerSchema = z.object({
  name: z
    .string({ error: "Ingrese el nombre del cliente." })
    .trim()
    .min(2, "Ingrese el nombre del cliente.")
    .max(80, "El nombre no puede pasar de 80 caracteres."),
  phone: optionalText(20, /^[0-9+()\- ]{6,20}$/, "Ingrese un teléfono válido (solo números, + y guiones)."),
  ciNit: optionalText(20, /^[A-Za-z0-9.\- ]{3,20}$/, "Ingrese un CI o NIT válido."),
  notes: z
    .string()
    .trim()
    .max(200, "Las notas no pueden pasar de 200 caracteres.")
    .optional()
    .transform((value) => (value ? value : null)),
});

export type CustomerInput = z.infer<typeof customerSchema>;
