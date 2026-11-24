import { z } from "zod";
import { newPasswordSchema } from "@/features/users/schemas";

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingrese su contraseña actual.").max(200),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .superRefine((value, context) => {
    if (value.confirmPassword !== value.newPassword) {
      context.addIssue({ code: "custom", path: ["confirmPassword"], message: "Las contraseñas no coinciden." });
    }
    if (value.newPassword === value.currentPassword) {
      context.addIssue({ code: "custom", path: ["newPassword"], message: "La contraseña nueva debe ser distinta de la actual." });
    }
  });

export const resetPasswordSchema = z.object({
  userId: z.uuid(),
  newPassword: newPasswordSchema,
  mustChange: z.enum(["on"]).optional().transform((value) => value === "on"),
});
