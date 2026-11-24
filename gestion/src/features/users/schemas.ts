import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 12;

/** One password policy for creating, changing and resetting: 12+ characters, within bcrypt's 72 bytes. */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .refine((value) => new TextEncoder().encode(value).length <= 72, "La contraseña es demasiado larga.");

export const createSellerSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "Use 3 a 32 caracteres: letras, números, punto, guion."),
  fullName: z.string().trim().min(2, "Ingrese el nombre completo.").max(80),
  branchId: z.uuid("Seleccione una sucursal."),
  password: newPasswordSchema,
});

export const setActiveSchema = z.object({
  userId: z.uuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export type CreateSellerInput = z.infer<typeof createSellerSchema>;
