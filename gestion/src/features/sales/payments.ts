import { D, dec, parseMoney, toMoney } from "@/lib/money";

export const PAYMENT_METHODS = ["efectivo", "qr", "transferencia", "tarjeta"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABEL: Readonly<Record<PaymentMethod, string>> = {
  efectivo: "Efectivo",
  qr: "QR",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

export interface PaymentRow {
  readonly id: string;
  readonly method: PaymentMethod;
  readonly amountInput: string;
  /** False until the person types an amount: a lone untouched row simply follows the total. */
  readonly touched: boolean;
}

export interface EffectivePayment {
  readonly id: string;
  readonly method: PaymentMethod;
  readonly amount: string;
}

export type ReconcileStatus = "exact" | "short" | "over";

export interface Reconciliation {
  readonly paid: string;
  /** total - paid: positive = still missing, negative = too much. */
  readonly remaining: string;
  readonly status: ReconcileStatus;
  readonly canConfirm: boolean;
}

export function newPaymentRow(id: string, method: PaymentMethod = "efectivo"): PaymentRow {
  return { id, method, amountInput: "", touched: false };
}

export function addPaymentRow(rows: readonly PaymentRow[], id: string, method: PaymentMethod): PaymentRow[] {
  return [...rows, newPaymentRow(id, method)];
}

export function removePaymentRow(rows: readonly PaymentRow[], id: string): PaymentRow[] {
  const next = rows.filter((row) => row.id !== id);
  return next.length === 0 ? [...rows] : next;
}

export function setPaymentAmount(rows: readonly PaymentRow[], id: string, amountInput: string): PaymentRow[] {
  return rows.map((row) => (row.id === id ? { ...row, amountInput, touched: true } : row));
}

export function setPaymentMethod(rows: readonly PaymentRow[], id: string, method: PaymentMethod): PaymentRow[] {
  return rows.map((row) => (row.id === id ? { ...row, method } : row));
}

/** Fills one row with whatever is still missing (the "completar" shortcut). */
export function fillRemaining(rows: readonly PaymentRow[], id: string, total: string): PaymentRow[] {
  const others = rows.filter((row) => row.id !== id);
  const paidByOthers = effectivePayments(others.map((row) => ({ ...row, touched: true })), total).reduce(
    (sum, payment) => sum.plus(payment.amount),
    new D(0),
  );
  const missing = dec(total).minus(paidByOthers);
  const amount = missing.gt(0) ? toMoney(missing) : "0.00";
  return rows.map((row) => (row.id === id ? { ...row, amountInput: amount, touched: true } : row));
}

function readAmount(input: string): string {
  const parsed = parseMoney(input);
  return parsed !== null && dec(parsed).gt(0) ? parsed : "0.00";
}

export function effectivePayments(rows: readonly PaymentRow[], total: string): EffectivePayment[] {
  const follow = rows.length === 1 && !rows[0].touched;
  return rows.map((row) => ({
    id: row.id,
    method: row.method,
    amount: follow ? toMoney(total) : readAmount(row.amountInput),
  }));
}

export function reconcile(payments: readonly EffectivePayment[], total: string): Reconciliation {
  const paid = payments.reduce((sum, payment) => sum.plus(payment.amount), new D(0));
  const remaining = dec(total).minus(paid);
  const status: ReconcileStatus = remaining.isZero() ? "exact" : remaining.gt(0) ? "short" : "over";
  return {
    paid: toMoney(paid),
    remaining: toMoney(remaining),
    status,
    canConfirm: status === "exact" && dec(total).gt(0),
  };
}

/** What is sent to create_sale: only rows with money in them. */
export function toSalePayments(payments: readonly EffectivePayment[]): { method: PaymentMethod; amount: string }[] {
  return payments.filter((p) => dec(p.amount).gt(0)).map((p) => ({ method: p.method, amount: p.amount }));
}

/** Change to give back for the cash part, or null while the received cash is not enough. */
export function cashChange(received: string, cashAmount: string): string | null {
  const parsed = parseMoney(received);
  if (parsed === null) return null;
  const change = dec(parsed).minus(cashAmount);
  return change.isNegative() ? null : toMoney(change);
}

/** Sum of the payments made with one method, e.g. the cash part for the change calculator. */
export function methodTotal(payments: readonly EffectivePayment[], method: PaymentMethod): string {
  return toMoney(payments.filter((p) => p.method === method).reduce((sum, p) => sum.plus(p.amount), new D(0)));
}
