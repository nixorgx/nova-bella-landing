import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { createExchange } from "@/features/exchanges/create-exchange";
import { getSaleDetail } from "@/features/sales/queries";
import { voidSaleSchema } from "@/features/sales/void-schema";
import { voidSale } from "@/features/sales/void-sale";
import { systemQuery } from "../helpers/system";
import { addStock, createBranch, createUser, createVariant, expectPgError, sellOne, stockOf } from "../helpers/fixtures";

let branch: string;
let seller: SessionPayload;
let admin: SessionPayload;

beforeAll(async () => {
  branch = await createBranch();
  seller = await createUser("seller", branch);
  admin = await createUser("superadmin", null);
});

async function stocked(price = "100.00") {
  const v = await createVariant(price);
  await addStock(v.variantId, branch, 10);
  return v;
}

describe("voidSaleSchema", () => {
  it("requires a real reason", () => {
    expect(voidSaleSchema.safeParse({ saleId: crypto.randomUUID(), reason: "  no  " }).success).toBe(false);
    expect(voidSaleSchema.safeParse({ saleId: crypto.randomUUID(), reason: "error de digitación" }).success).toBe(true);
    expect(voidSaleSchema.safeParse({ saleId: "x", reason: "error de digitación" }).success).toBe(false);
  });
});

describe("voidSale feature", () => {
  it("voids with a reason, restores stock and exposes who/why on the detail", async () => {
    const v = await stocked();
    const saleId = await sellOne(seller, branch, v.variantId, 2, "100.00", "200.00");
    await voidSale(admin, { saleId, reason: "Cliente se arrepintió" });

    expect(await stockOf(v.variantId, branch)).toBe(10);
    const detail = await getSaleDetail(admin, saleId);
    expect(detail?.status).toBe("voided");
    expect(detail?.voidInfo).toMatchObject({ reason: "Cliente se arrepintió" });
    // the seller sees the voided sale too, with the reason (no cost data involved)
    expect((await getSaleDetail(seller, saleId))?.voidInfo?.reason).toBe("Cliente se arrepintió");
  });

  it("is refused for sellers (permission) and without a reason (validation)", async () => {
    const v = await stocked();
    const saleId = await sellOne(seller, branch, v.variantId, 1, "100.00", "100.00");
    await expectPgError(voidSale(seller, { saleId, reason: "intento de vendedor" }), "42501");
    await expectPgError(voidSale(admin, { saleId, reason: "   " }), "IN003");
    expect(await stockOf(v.variantId, branch)).toBe(9);
  });

  it("cannot void a sale with exchanges and says so (IN005)", async () => {
    const a = await stocked();
    const b = await stocked();
    const saleId = await sellOne(seller, branch, a.variantId, 1, "100.00", "100.00");
    await createExchange(seller, {
      saleId, reason: "talla", note: undefined, paymentMethod: null,
      lines: [{ returnedVariantId: a.variantId, newVariantId: b.variantId, qty: 1, priceDiffOverride: undefined }],
    });
    const error = await expectPgError(voidSale(admin, { saleId, reason: "intento de anular" }), "IN005");
    expect(error.message).toMatch(/cambios registrados/);
    expect((await systemQuery("select status from sales where id = $1", [saleId])).rows[0].status).toBe("completed");
    expect((await getSaleDetail(admin, saleId))?.exchanges).toHaveLength(1);
  });
});
