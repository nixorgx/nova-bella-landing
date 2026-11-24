"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requireRole, toSession } from "@/lib/auth/guards";
import { withUser } from "@/lib/db";
import { friendlyDbMessage } from "@/lib/db-errors";
import type { FormState } from "@/lib/form";
import { STORE_TAG } from "@/features/store/public-data";

const idSchema = z.uuid();
const reasonSchema = z.string().trim().min(5, "Escriba el motivo (mínimo 5 caracteres)").max(300, "Máximo 300 caracteres");
const METHODS = ["efectivo", "qr", "transferencia", "tarjeta"] as const;

/** Stock and order lists change: refresh the staff pages and expire the public catalog cache. */
function refresh(orderId: string): void {
  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/stock");
  updateTag(STORE_TAG);
}

async function run(orderId: unknown, role: "superadmin" | "any", work: (client: Parameters<Parameters<typeof withUser>[1]>[0], id: string) => Promise<unknown>, okMessage: string): Promise<FormState> {
  const actor = role === "superadmin" ? await requireRole("superadmin") : await requireRole("superadmin", "seller");
  const id = idSchema.safeParse(orderId);
  if (!id.success) return { ok: false, message: "Pedido no válido." };
  try {
    await withUser(toSession(actor), (client) => work(client, id.data));
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
  refresh(id.data);
  return { ok: true, message: okMessage };
}

/** Confirm payment: one transaction creates the web sale and takes the stock (idempotent, no oversell). */
export async function confirmOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return run(formData.get("orderId"), "superadmin", (c, id) => c.query("select web_order_confirm($1)", [id]), "Pedido confirmado: la venta quedó registrada y el stock descontado.");
}

export async function rejectProofAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const reason = reasonSchema.safeParse(formData.get("reason"));
  if (!reason.success) return { ok: false, message: reason.error.issues[0].message };
  return run(formData.get("orderId"), "superadmin", (c, id) => c.query("select web_order_reject_proof($1, $2)", [id, reason.data]), "Comprobante rechazado: el cliente podrá enviar otro.");
}

export async function cancelOrderAdminAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const reason = reasonSchema.safeParse(formData.get("reason"));
  if (!reason.success) return { ok: false, message: reason.error.issues[0].message };
  return run(formData.get("orderId"), "superadmin", (c, id) => c.query("select web_order_cancel($1, $2)", [id, reason.data]), "Pedido cancelado.");
}

/** Superadmin: cancel every unpaid order (no proof sent) older than `days` days (spam / abandoned carts). */
export async function expireUnpaidAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const days = z.coerce.number().int().min(1).max(365).safeParse(formData.get("days"));
  if (!days.success) return { ok: false, message: "Indique entre 1 y 365 días." };
  try {
    const { rows } = await withUser(toSession(actor), (c) => c.query<{ n: number }>("select web_orders_expire_unpaid($1) as n", [days.data]));
    revalidatePath("/pedidos");
    const n = rows[0]?.n ?? 0;
    return { ok: true, message: n === 0 ? "No hay pedidos sin pagar tan antiguos." : `${n} ${n === 1 ? "pedido vencido cancelado" : "pedidos vencidos cancelados"}.` };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
}

const statusSchema = z.enum(["en_camino", "listo_para_recoger", "entregado"]);
const LABELS = { en_camino: "Pedido marcado en camino.", listo_para_recoger: "Pedido listo para recoger.", entregado: "Pedido entregado." } as const;

/** Operational steps: superadmin and sellers (sellers only for their branch; the database enforces it). */
export async function setOrderStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const status = statusSchema.safeParse(formData.get("status"));
  if (!status.success) return { ok: false, message: "Estado no válido." };
  const collected = z.enum(METHODS).safeParse(formData.get("collected"));
  return run(
    formData.get("orderId"),
    "any",
    (c, id) => c.query("select web_order_set_status($1, $2, $3)", [id, status.data, collected.success ? collected.data : null]),
    LABELS[status.data],
  );
}
