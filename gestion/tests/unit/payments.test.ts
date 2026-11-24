import { describe, expect, it } from "vitest";
import {
  addPaymentRow,
  cashChange,
  effectivePayments,
  methodTotal,
  newPaymentRow,
  reconcile,
  removePaymentRow,
  setPaymentAmount,
  setPaymentMethod,
  toSalePayments,
} from "@/features/sales/payments";

describe("effective payments", () => {
  it("a single untouched row follows the order total", () => {
    const rows = [newPaymentRow("a", "efectivo")];
    expect(effectivePayments(rows, "529.00")[0].amount).toBe("529.00");
    expect(effectivePayments(rows, "10.00")[0].amount).toBe("10.00");
  });

  it("a typed amount is kept", () => {
    const rows = setPaymentAmount([newPaymentRow("a", "efectivo")], "a", "100");
    expect(effectivePayments(rows, "529.00")[0].amount).toBe("100.00");
  });

  it("unreadable text counts as zero", () => {
    const rows = setPaymentAmount([newPaymentRow("a", "qr")], "a", "xx");
    expect(effectivePayments(rows, "50.00")[0].amount).toBe("0.00");
  });
});

describe("reconciliation", () => {
  const two = (a: string, b: string) =>
    setPaymentAmount(
      setPaymentAmount(addPaymentRow([newPaymentRow("a", "efectivo")], "b", "qr"), "a", a),
      "b",
      b,
    );

  it("is exact when the rows add up to the total", () => {
    const result = reconcile(effectivePayments(two("300", "229"), "529.00"), "529.00");
    expect(result).toMatchObject({ status: "exact", paid: "529.00", remaining: "0.00", canConfirm: true });
  });

  it("reports the missing amount", () => {
    const result = reconcile(effectivePayments(two("300", "200"), "529.00"), "529.00");
    expect(result).toMatchObject({ status: "short", remaining: "29.00", canConfirm: false });
  });

  it("reports the excess", () => {
    const result = reconcile(effectivePayments(two("400", "200"), "529.00"), "529.00");
    expect(result).toMatchObject({ status: "over", remaining: "-71.00", canConfirm: false });
  });

  it("never confirms an empty order, even with matching zeros", () => {
    const rows = effectivePayments([newPaymentRow("a", "efectivo")], "0.00");
    expect(reconcile(rows, "0.00").canConfirm).toBe(false);
  });

  it("has no float drift (0.1 + 0.2)", () => {
    const rows = effectivePayments(two("0,10", "0,20"), "0.30");
    expect(reconcile(rows, "0.30").canConfirm).toBe(true);
  });
});

describe("payload and row editing", () => {
  it("drops zero rows and merges nothing silently", () => {
    const rows = effectivePayments(
      setPaymentAmount(addPaymentRow([newPaymentRow("a", "efectivo")], "b", "qr"), "a", "50"),
      "50.00",
    );
    expect(toSalePayments(rows)).toEqual([{ method: "efectivo", amount: "50.00" }]);
  });

  it("changes method and removes rows immutably (keeps at least one)", () => {
    const base = addPaymentRow([newPaymentRow("a", "efectivo")], "b", "qr");
    const changed = setPaymentMethod(base, "b", "tarjeta");
    expect(changed[1].method).toBe("tarjeta");
    expect(base[1].method).toBe("qr");
    expect(removePaymentRow(changed, "b")).toHaveLength(1);
    expect(removePaymentRow(removePaymentRow(changed, "b"), "a")).toHaveLength(1);
  });
});

describe("cash change calculator", () => {
  it("returns the change for the cash part", () => {
    expect(cashChange("200", "170.50")).toBe("29.50");
    expect(cashChange("170,50", "170.50")).toBe("0.00");
  });
  it("is null while the received cash is not enough or unreadable", () => {
    expect(cashChange("100", "170.50")).toBeNull();
    expect(cashChange("", "170.50")).toBeNull();
    expect(cashChange("abc", "170.50")).toBeNull();
  });
});

describe("methodTotal", () => {
  it("adds only the rows of that method, without float drift", () => {
    const rows = setPaymentAmount(
      setPaymentAmount(addPaymentRow(addPaymentRow([newPaymentRow("a", "efectivo")], "b", "efectivo"), "c", "qr"), "a", "0,10"),
      "b",
      "0,20",
    );
    const payments = effectivePayments(setPaymentAmount(rows, "c", "5"), "5.30");
    expect(methodTotal(payments, "efectivo")).toBe("0.30");
    expect(methodTotal(payments, "qr")).toBe("5.00");
    expect(methodTotal(payments, "tarjeta")).toBe("0.00");
  });
});
