import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { createCustomer, getCustomer, listCustomers, searchCustomers, updateCustomer } from "@/features/customers/queries";
import { customerSchema } from "@/features/customers/schemas";
import { createSale } from "@/features/sales/create-sale";
import { saleInputSchema } from "@/features/sales/schemas";
import { createBranch, createUser, createVariant, addStock } from "../helpers/fixtures";
import { withUser } from "@/lib/db";

let branchA: string;
let branchB: string;
let sellerA: SessionPayload;
let sellerB: SessionPayload;
let admin: SessionPayload;
const tag = `Zz${Date.now().toString(36)}`;

const input = (name: string) => customerSchema.parse({ name, phone: "70012345", ciNit: "1234567" });

beforeAll(async () => {
  [branchA, branchB] = await Promise.all([createBranch(), createBranch()]);
  [sellerA, sellerB, admin] = await Promise.all([
    createUser("seller", branchA),
    createUser("seller", branchB),
    createUser("superadmin", null),
  ]);
});

describe("customers: branch rules (RLS)", () => {
  it("a seller's customer is stamped with their branch and invisible to other branches", async () => {
    const mine = await createCustomer(sellerA, input(`${tag} Ana Quispe`));
    expect(await getCustomer(sellerA, mine.id)).toMatchObject({ name: `${tag} Ana Quispe` });
    expect(await getCustomer(sellerB, mine.id)).toBeNull();
    expect((await searchCustomers(sellerB, tag)).length).toBe(0);
    expect((await searchCustomers(sellerA, tag.toLowerCase())).map((c) => c.id)).toEqual([mine.id]);
  });

  it("customers created by the superadmin are shared with every branch", async () => {
    const shared = await createCustomer(admin, input(`${tag} Compartido`));
    expect((await searchCustomers(sellerA, `${tag} compart`)).map((c) => c.id)).toContain(shared.id);
    expect((await searchCustomers(sellerB, `${tag} compart`)).map((c) => c.id)).toContain(shared.id);
  });

  it("a seller cannot edit a customer of another branch", async () => {
    const mine = await createCustomer(sellerA, input(`${tag} Privado`));
    expect(await updateCustomer(sellerB, mine.id, input("Hackeado"))).toBe(false);
    expect(await updateCustomer(sellerA, mine.id, input(`${tag} Privado Editado`))).toBe(true);
    expect((await getCustomer(admin, mine.id))?.name).toBe(`${tag} Privado Editado`);
  });

  it("a seller cannot create a customer for another branch or change its branch", async () => {
    await expect(
      withUser(sellerA, (c) => c.query("insert into customers (branch_id, name) values ($1, 'x')", [branchB])),
    ).rejects.toMatchObject({ code: "42501" });
    const mine = await createCustomer(sellerA, input(`${tag} Fijo`));
    await expect(
      withUser(sellerA, (c) => c.query("update customers set branch_id = $2 where id = $1", [mine.id, branchB])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("finds by phone and CI/NIT, lists with pagination", async () => {
    await createCustomer(sellerA, customerSchema.parse({ name: `${tag} Luis`, phone: "77711122", ciNit: "9988776" }));
    expect((await searchCustomers(sellerA, "9988776")).length).toBe(1);
    expect((await searchCustomers(sellerA, "77711122")).length).toBe(1);
    const page = await listCustomers(sellerA, tag, { page: 1, pageSize: 2 });
    expect(page.total).toBeGreaterThanOrEqual(3);
    expect(page.rows).toHaveLength(2);
  });
});

describe("customer purchase history", () => {
  it("lists the sales of a customer", async () => {
    const customer = await createCustomer(sellerA, input(`${tag} Historial`));
    const shoe = await createVariant("100.00");
    await addStock(shoe.variantId, branchA, 5);
    const sale = saleInputSchema.parse({
      customerId: customer.id,
      docType: "factura",
      items: [{ variantId: shoe.variantId, qty: 2, finalPrice: "100" }],
      payments: [{ method: "qr", amount: "200" }],
    });
    await createSale(sellerA, sale);
    const detail = await getCustomer(sellerA, customer.id);
    expect(detail?.sales).toHaveLength(1);
    expect(detail?.sales[0]).toMatchObject({ total: "200.00", units: 2, docType: "factura" });
    const row = (await listCustomers(sellerA, `${tag} Historial`, { page: 1, pageSize: 5 })).rows[0];
    expect(row).toMatchObject({ purchases: 1, spent: "200.00" });
  });
});

describe("customer validation", () => {
  it("requires a name and sane phone / CI", () => {
    expect(customerSchema.safeParse({ name: "" }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "Ana", phone: "abc" }).success).toBe(false);
    expect(customerSchema.safeParse({ name: "Ana", ciNit: "<script>" }).success).toBe(false);
    expect(customerSchema.parse({ name: "  Ana  " })).toMatchObject({ name: "Ana", phone: null, ciNit: null });
  });
});
