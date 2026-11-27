import { z } from "zod";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value ? value : null));

export const branchSchema = z.object({
  name: z.string().trim().min(2, "Ingrese el nombre de la sucursal.").max(60, "El nombre no puede pasar de 60 caracteres."),
  city: optionalText(60, "La ciudad no puede pasar de 60 caracteres."),
});

export const branchIdSchema = z.object({ branchId: z.uuid("Sucursal no válida.") });

export const setBranchActiveSchema = branchIdSchema.extend({
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const updateBranchSchema = branchSchema.extend({ branchId: z.uuid("Sucursal no válida.") });

export const assignSellerSchema = z.object({
  userId: z.uuid("Vendedor no válido."),
  branchId: z.uuid("Seleccione una sucursal."),
});

export type BranchInput = z.infer<typeof branchSchema>;
