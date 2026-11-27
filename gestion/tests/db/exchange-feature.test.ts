import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { createExchange } from "@/features/exchanges/create-exchange";
import { previewExchange } from "@/features/exchanges/preview";
import { readReturnableLines, readSaleExchanges } from "@/features/exchanges/queries";
import { systemQuery } from "../helpers/system";
import {
  addStock,
  closeCashSessions,
  createBranch,
  createUser,
  createVariant,
  expectPgError,
  openCashSession,
  sellOne,
  stockOf,
} from "../helpers/fixtures";

let branch: string;
let seller: SessionPayload;
let admin: SessionPayload;

beforeAll(async () => {
  branch = await createBranch();
  seller = await createUser("seller", branch);
  admin = await createUser("superadmin", null);
});

async function stocked(price: string, qty = 10) {
  const v = await createVariant(price);
  await addStock(v.variantId, branch, qty);
  return v;
}

describe("exchange feature layer", () => {
  it("previews the difference on the server and writes nothing", async () => {
    const small = await stocked("100.00");
    const large = await stocked("130.00");
    const saleId = await sellOne(seller, branch, small.variantId, 2, "90.00", "180.00");
    const before = await stockOf(large.variantId, branch);

    const preview = await previewExchange(seller, {
      saleId,
      lines: [{ returnedVariantId: small.variantId, newVariantId: large.variantId, qty: 1, priceDiffOverride: undefined }],
    });

    expect(preview).toMatchObject({ net: "40.00", direction: "cobrar", amount: "40.00", needsMethod: true, canConfirm: true });
    expect(preview.lines[0]).toMatchObject({ paidUnit: "90.00", newPrice: "130.00", diff: "40.00", newStock: 10 });
    expect(await stockOf(large.variantId, branch)).toBe(before);
  });

  it("moves stock, stores the settlement and groups several lines under one receipt", async () => {
    const a = await stocked("100.00");
    const b = await stocked("120.00");
    const cheaper = await stocked("80.00");
    const dearer = await stocked("150.00");
    const saleId = await withUser(seller, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "select create_sale($1, null, 'nota_venta', $2::jsonb, $3::jsonb, null) as id",
        [
          branch,
          JSON.stringify([
            { variant_id: a.variantId, qty: 1, final_price: "100.00" },
            { variant_id: b.variantId, qty: 1, final_price: "120.00" },
          ]),
          JSON.stringify([{ method: "efectivo", amount: "220.00" }]),
        ],
      );
      return rows[0].id;
    });

    const created = await createExchange(seller, {
      saleId,
      reason: "talla",
      note: "le quedaba chico",
      paymentMethod: "qr",
      lines: [
        { returnedVariantId: a.variantId, newVariantId: cheaper.variantId, qty: 1, priceDiffOverride: undefined },
        { returnedVariantId: b.variantId, newVariantId: dearer.variantId, qty: 1, priceDiffOverride: undefined },
      ],
    });

    expect(created.exchangeIds).toHaveLength(2);
    expect(await stockOf(a.variantId, branch)).toBe(10); // 9 after the sale + 1 back
    expect(await stockOf(cheaper.variantId, branch)).toBe(9);
    expect(await stockOf(dearer.variantId, branch)).toBe(9);

    const groups = await withUser(seller, (c) => readSaleExchanges(c, saleId));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ groupId: created.groupId, paymentMethod: "qr", net: "10.00" });
    expect(groups[0].reason).toBe("Talla equivocada: le quedaba chico");
    expect(groups[0].lines.map((l) => l.priceDiff).sort()).toEqual(["-20.00", "30.00"]);

    const stored = (await systemQuery("select cash_session_id, returned_unit_price::text as p from exchanges where group_id = $1 order by price_diff", [created.groupId])).rows;
    expect(stored[0].cash_session_id).not.toBeNull();
    expect(stored.map((r) => r.p)).toEqual(["100.00", "120.00"]);
  });

  it("limits what is left to exchange and reports it", async () => {
    const a = await stocked("100.00");
    const b = await stocked("100.00");
    const saleId = await sellOne(seller, branch, a.variantId, 2, "100.00", "200.00");
    await createExchange(seller, {
      saleId, reason: "regalo", note: undefined, paymentMethod: null,
      lines: [{ returnedVariantId: a.variantId, newVariantId: b.variantId, qty: 1, priceDiffOverride: undefined }],
    });
    const lines = await withUser(seller, (c) => readReturnableLines(c, saleId));
    expect(lines).toEqual([expect.objectContaining({ sold: 2, exchanged: 1, remaining: 1, paidUnit: "100.00" })]);

    const preview = await previewExchange(seller, {
      saleId,
      lines: [{ returnedVariantId: a.variantId, newVariantId: b.variantId, qty: 2, priceDiffOverride: undefined }],
    });
    expect(preview.canConfirm).toBe(false);
    expect(preview.lines[0].issue).toMatch(/Solo quedan 1/);
  });

  it("validates stock of the replacement across lines before confirming", async () => {
    const a = await stocked("100.00");
    const scarce = await stocked("100.00", 1);
    const saleId = await sellOne(seller, branch, a.variantId, 2, "100.00", "200.00");
    const preview = await previewExchange(seller, {
      saleId,
      lines: [{ returnedVariantId: a.variantId, newVariantId: scarce.variantId, qty: 2, priceDiffOverride: undefined }],
    });
    expect(preview.canConfirm).toBe(false);
    expect(preview.lines[0].issue).toMatch(/Stock insuficiente/);
    await expectPgError(
      createExchange(seller, {
        saleId, reason: "talla", note: undefined, paymentMethod: null,
        lines: [{ returnedVariantId: a.variantId, newVariantId: scarce.variantId, qty: 2, priceDiffOverride: undefined }],
      }),
      "IN001",
    );
    expect(await stockOf(scarce.variantId, branch)).toBe(1);
  });

  it("is atomic: a failing second line rolls the first one back", async () => {
    const a = await stocked("100.00");
    const b = await stocked("100.00");
    const empty = await createVariant("100.00");
    const saleId = await sellOne(seller, branch, a.variantId, 1, "100.00", "100.00");
    await expectPgError(
      createExchange(seller, {
        saleId, reason: "talla", note: undefined, paymentMethod: null,
        lines: [
          { returnedVariantId: a.variantId, newVariantId: b.variantId, qty: 1, priceDiffOverride: undefined },
          { returnedVariantId: a.variantId, newVariantId: empty.variantId, qty: 1, priceDiffOverride: undefined },
        ],
      }),
      "IN003",
    );
    expect((await systemQuery("select count(*)::int as n from exchanges where original_sale_id = $1", [saleId])).rows[0].n).toBe(0);
    expect(await stockOf(b.variantId, branch)).toBe(10);
  });

  it("requires a payment method when money moves, and an open cash session", async () => {
    const a = await stocked("100.00");
    const b = await stocked("130.00");
    const saleId = await sellOne(seller, branch, a.variantId, 1, "100.00", "100.00");
    const attempt = (method: "efectivo" | null) =>
      createExchange(seller, {
        saleId, reason: "modelo", note: undefined, paymentMethod: method,
        lines: [{ returnedVariantId: a.variantId, newVariantId: b.variantId, qty: 1, priceDiffOverride: undefined }],
      });
    await expectPgError(attempt(null), "IN003");

    await closeCashSessions(branch);
    await expectPgError(attempt("efectivo"), "IN005");
    await openCashSession(branch);
    const ok = await attempt("efectivo");
    expect(ok.exchangeIds).toHaveLength(1);
  });

  it("lets only the superadmin override the difference, within bounds", async () => {
    const a = await stocked("100.00");
    const b = await stocked("100.00");
    const saleId = await sellOne(seller, branch, a.variantId, 3, "100.00", "300.00");
    const line = (override: string | undefined) => [
      { returnedVariantId: a.variantId, newVariantId: b.variantId, qty: 1, priceDiffOverride: override },
    ];
    // the seller's override is dropped: the computed difference (0) is stored
    const bySeller = await createExchange(seller, { saleId, reason: "talla", note: undefined, paymentMethod: null, lines: line("-50.00") });
    const sellerRow = (await systemQuery("select price_diff::text as d from exchanges where id = $1", [bySeller.exchangeIds[0]])).rows[0];
    expect(sellerRow.d).toBe("0.00");

    const byAdmin = await createExchange(admin, { saleId, reason: "defecto", note: undefined, paymentMethod: "efectivo", lines: line("-30.00") });
    const adminRow = (await systemQuery("select price_diff::text as d, payment_method from exchanges where id = $1", [byAdmin.exchangeIds[0]])).rows[0];
    expect(adminRow).toEqual({ d: "-30.00", payment_method: "efectivo" });

    await expectPgError(
      createExchange(admin, { saleId, reason: "defecto", note: undefined, paymentMethod: "efectivo", lines: line("-100.01") }),
      "IN003",
    );
  });

  it("snapshots the cost of the returned and the replacement pair for profit reports", async () => {
    const a = await stocked("100.00");
    const b = await stocked("130.00");
    await systemQuery("insert into variant_costs (variant_id, last_cost_bs, avg_cost_bs) values ($1, 60, 60), ($2, 80, 80)", [a.variantId, b.variantId]);
    const saleId = await sellOne(seller, branch, a.variantId, 1, "100.00", "100.00");
    await systemQuery("update variant_costs set avg_cost_bs = 70 where variant_id = $1", [a.variantId]); // later purchase moves the average
    const created = await createExchange(seller, {
      saleId, reason: "talla", note: undefined, paymentMethod: "efectivo",
      lines: [{ returnedVariantId: a.variantId, newVariantId: b.variantId, qty: 1, priceDiffOverride: undefined }],
    });
    const item = (await systemQuery("select unit_cost_bs::text as c from sale_item_costs sic join sale_items si on si.id = sic.sale_item_id where si.sale_id = $1", [saleId])).rows[0];
    expect(item.c).toBe("60.0000"); // frozen at the sale, not 70
    const cost = (await systemQuery("select returned_unit_cost_bs::text as r, new_unit_cost_bs::text as n from exchange_costs where exchange_id = $1", [created.exchangeIds[0]])).rows[0];
    expect(cost).toEqual({ r: "60.0000", n: "80.0000" });
  });
});
