import { describe, expect, it } from "vitest";
import { AVAILABILITY_LABEL, availabilityDetail, availabilityOf } from "@/features/store/availability";
import { applyFilters, buildFacets, filtersToQuery, hasActiveFilters, parseFilters } from "@/features/store/catalog-filter";
import { safeJsonLd } from "@/features/store/json-ld";
import { adminActions, buyerHint, isFinal, ORDER_STATUSES, progressIndex, progressSteps, sellerActions, type OrderShape } from "@/features/store/order-state";
import { deriveOrderToken, hashOrderToken, isWellFormedToken } from "@/features/store/order-token";
import { formatBoPhone, normalizeBoPhone } from "@/features/store/phone";
import type { CatalogModel } from "@/features/store/public-data";
import { checkoutSchema, parseCartLines } from "@/features/store/schemas";
import { throttleKey, LIMITS } from "@/features/store/throttle";
import { orderSummaryMessage, productInquiryMessage, toWhatsappDigits, waLink } from "@/features/store/whatsapp";
import { isPublicPath } from "@/lib/auth/routes";

describe("Bolivian phone numbers", () => {
  it.each([
    ["71234567", "71234567"],
    ["7123 4567", "71234567"],
    ["+591 71234567", "71234567"],
    ["00591-7123-4567", "71234567"],
    ["(591) 61234567", "61234567"],
  ])("normalizes %s", (raw, expected) => expect(normalizeBoPhone(raw)).toBe(expected));
  it.each(["", "1234", "81234567", "2123456", "712345678", "abc71234567", "+1 7123 4567"])("rejects %s", (raw) => expect(normalizeBoPhone(raw)).toBeNull());
  it("formats for display", () => expect(formatBoPhone("71234567")).toBe("7123 4567"));
});

describe("order state machine", () => {
  const shape = (status: OrderShape["status"], paymentMethod: OrderShape["paymentMethod"] = "qr", fulfillment: OrderShape["fulfillment"] = "delivery"): OrderShape => ({ status, paymentMethod, fulfillment });
  it("offers the right actions per state", () => {
    expect(adminActions(shape("pendiente_pago"))).toEqual(["confirm", "cancel"]);
    expect(adminActions(shape("pago_en_revision"))).toEqual(["confirm", "reject_proof", "cancel"]);
    expect(adminActions(shape("confirmado"))).toEqual(["ship", "deliver", "cancel"]);
    expect(adminActions(shape("confirmado", "qr", "pickup"))).toEqual(["ready", "deliver", "cancel"]);
    expect(adminActions(shape("en_camino"))).toEqual(["deliver", "cancel"]);
    expect(adminActions(shape("entregado"))).toEqual([]);
    expect(adminActions(shape("cancelado"))).toEqual([]);
  });
  it("sellers only get operational steps, never payment or cancellation", () => {
    for (const status of ORDER_STATUSES) {
      const actions = sellerActions(shape(status));
      expect(actions.every((a) => ["ship", "ready", "deliver"].includes(a))).toBe(true);
    }
    expect(sellerActions(shape("pendiente_pago"))).toEqual([]);
    expect(sellerActions(shape("confirmado"))).toEqual(["ship", "deliver"]);
  });
  it("knows final states, progress and has a hint for every status", () => {
    expect(isFinal("entregado") && isFinal("cancelado") && !isFinal("confirmado")).toBe(true);
    expect(progressSteps({ fulfillment: "delivery", paymentMethod: "qr" }).map((s) => s.status)).toEqual(["pendiente_pago", "confirmado", "en_camino", "entregado"]);
    expect(progressSteps({ fulfillment: "pickup", paymentMethod: "contra_entrega" })[2].status).toBe("listo_para_recoger");
    expect(progressIndex("pago_en_revision")).toBe(0);
    expect(progressIndex("cancelado")).toBe(-1);
    for (const status of ORDER_STATUSES) expect(buyerHint(shape(status)).length).toBeGreaterThan(10);
  });
});

describe("order tokens", () => {
  const secret = "s".repeat(40);
  it("derives a 256-bit token deterministically from the idempotency key (retries get the same link)", () => {
    const a = deriveOrderToken("key-key-key-key-key-key", secret);
    expect(a).toBe(deriveOrderToken("key-key-key-key-key-key", secret));
    expect(a).not.toBe(deriveOrderToken("other-key-other-key-key", secret));
    expect(a).not.toBe(deriveOrderToken("key-key-key-key-key-key", "t".repeat(40)));
    expect(isWellFormedToken(a)).toBe(true);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
  });
  it("hashes to 32 bytes and rejects malformed tokens early", () => {
    expect(hashOrderToken("abc")).toHaveLength(32);
    for (const bad of ["", "short", "a".repeat(44), `${"a".repeat(42)}!`, "../../etc/passwd"]) expect(isWellFormedToken(bad)).toBe(false);
  });
});

describe("availability language", () => {
  it("never reveals exact numbers above the last-units threshold", () => {
    expect(availabilityOf(0)).toBe("agotado");
    expect(availabilityOf(2)).toBe("ultimas");
    expect(availabilityOf(4)).toBe("disponible");
    expect(availabilityDetail(1)).toBe("Queda 1 par");
    expect(availabilityDetail(3)).toBe("Quedan 3 pares");
    expect(availabilityDetail(6)).toBe("Disponible");
    expect(availabilityDetail(10)).toBe("Disponible (+10)");
    expect(AVAILABILITY_LABEL.ultimas).toBe("Últimas unidades");
  });
});

describe("checkout validation", () => {
  const valid = {
    idempotencyKey: "A".repeat(22),
    name: "  Ana Pérez ",
    phone: "+591 7123 4567",
    email: "",
    fulfillment: "delivery",
    zoneId: "11111111-1111-4111-8111-111111111111",
    address: "Calle 1 #23",
    paymentMethod: "qr",
    wantsInvoice: false,
    items: [{ variantId: "22222222-2222-4222-8222-222222222222", qty: 2 }],
  };
  it("accepts a good order and normalizes name and phone", () => {
    const parsed = checkoutSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ name: "Ana Pérez", phone: "71234567", email: undefined });
  });
  it.each([
    ["short name", { name: "A" }],
    ["bad phone", { phone: "12345" }],
    ["bad email", { email: "nope" }],
    ["delivery without zone", { zoneId: undefined }],
    ["delivery without address", { address: "" }],
    ["pickup without point", { fulfillment: "pickup", zoneId: undefined }],
    ["unknown payment", { paymentMethod: "bitcoin" }],
    ["invoice without nit", { wantsInvoice: true }],
    ["bad key", { idempotencyKey: "x" }],
    ["empty cart", { items: [] }],
    ["qty over 10", { items: [{ variantId: "22222222-2222-4222-8222-222222222222", qty: 11 }] }],
    ["qty zero", { items: [{ variantId: "22222222-2222-4222-8222-222222222222", qty: 0 }] }],
    ["bad uuid", { items: [{ variantId: "nope", qty: 1 }] }],
    ["duplicate lines", { items: Array(2).fill({ variantId: "22222222-2222-4222-8222-222222222222", qty: 1 }) }],
    ["too many lines", { items: Array.from({ length: 31 }, (_, i) => ({ variantId: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`, qty: 1 })) }],
    ["long note", { notes: "x".repeat(301) }],
  ])("rejects %s", (_name, patch) => expect(checkoutSchema.safeParse({ ...valid, ...patch }).success).toBe(false));
  it("the cart parser never throws and returns an empty cart for garbage", () => {
    expect(parseCartLines("garbage")).toEqual([]);
    expect(parseCartLines([{ variantId: "x", qty: 1 }])).toEqual([]);
    expect(parseCartLines(valid.items)).toHaveLength(1);
  });
});

describe("catalog filters", () => {
  const model = (over: Partial<CatalogModel>): CatalogModel => ({
    id: "m", slug: "m", name: "Alba", line_id: "line-1", line: "Dama", description: "Sandalia", price: 189, image: null, image_w: null, image_h: null, units: 5,
    colors: [{ id: "c1aaaaaa-0000-4000-8000-000000000000", name: "Rojo", hex: "#ff0000", avail: true }],
    sizes: [{ id: "s1aaaaaa-0000-4000-8000-000000000000", label: "38", avail: true }],
    pairs: ["c1aaaaaa|s1aaaaaa|1"],
    ...over,
  });
  const models = [model({ id: "1", name: "Alba" }), model({ id: "2", name: "Zeta", price: 400, units: 0 }), model({ id: "3", name: "Ñandú", line_id: "line-2", line: "Niños", price: 120 })];
  it("parses URL parameters defensively", () => {
    const f = parseFilters({ q: "x".repeat(200), linea: "not-a-uuid", min: "abc", max: "100.5", orden: "hack", pagina: "-3" });
    expect(f).toMatchObject({ lineId: undefined, min: undefined, max: 100.5, sort: "destacados", page: 1 });
    expect(f.q).toHaveLength(60);
  });
  it("filters by text (accent-insensitive), line, price and sorts available first", () => {
    const f = (p: Record<string, string>) => applyFilters(models, parseFilters(p)).items.map((m) => m.id);
    expect(f({ q: "nandu" })).toEqual(["3"]);
    expect(f({ min: "150" })).toEqual(["1", "2"]);
    expect(f({ max: "150" })).toEqual(["3"]);
    expect(f({ orden: "menor-precio" })).toEqual(["3", "1", "2"]); // sold out last
    expect(f({ orden: "mayor-precio" })).toEqual(["1", "3", "2"]);
    expect(f({ color: "c1aaaaaa-0000-4000-8000-000000000000", talla: "s1aaaaaa-0000-4000-8000-000000000000" })).toHaveLength(3);
    expect(f({ talla: "00000000-0000-4000-8000-000000000000" })).toEqual([]);
  });
  it("builds facets and round-trips filters through the URL", () => {
    const facets = buildFacets(models);
    expect(facets.priceMin).toBe(120);
    expect(facets.priceMax).toBe(400);
    expect(facets.lines.map((l) => l.name)).toEqual(["Dama", "Niños"]);
    const filters = parseFilters({ q: "alba", max: "300", orden: "nombre" });
    expect(hasActiveFilters(filters)).toBe(true);
    expect(filtersToQuery(filters)).toBe("?q=alba&max=300&orden=nombre");
    expect(filtersToQuery(filters, { q: undefined })).toBe("?max=300&orden=nombre");
  });
});

describe("whatsapp and json-ld helpers", () => {
  it("builds wa.me links only for valid numbers", () => {
    expect(waLink("59171234567", "Hola & más")).toBe("https://wa.me/59171234567?text=Hola%20%26%20m%C3%A1s");
    expect(waLink(null, "x")).toBeNull();
    expect(waLink("12", "x")).toBeNull();
    expect(toWhatsappDigits("7123 4567")).toBe("59171234567");
    expect(toWhatsappDigits("59171234567")).toBe("59171234567");
    expect(toWhatsappDigits("abc")).toBeNull();
  });
  it("messages carry the product or the order code, never the private link", () => {
    expect(productInquiryMessage({ model: "Alba", color: "Rojo", size: "38", price: "189" })).toContain("Alba (Rojo, talla 38)");
    const text = orderSummaryMessage({ code: "NB-ABC234", total: "255", items: [{ model: "Alba", color: "Rojo", size: "38", qty: 2 }] });
    expect(text).toContain("NB-ABC234");
    expect(text).toContain("2 x Alba");
    expect(text).not.toMatch(/https?:/);
  });
  it("JSON-LD cannot close its script tag or inject HTML", () => {
    const out = safeJsonLd({ name: "</script><script>alert(1)</script>", d: "a & b > c " });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("public surface plumbing", () => {
  it("only the store (and sitemap/robots) is anonymous", () => {
    for (const path of ["/tienda", "/tienda/alba", "/tienda/carrito", "/tienda/pedido/abc", "/tienda/img/x", "/sitemap.xml", "/robots.txt"]) expect(isPublicPath(path)).toBe(true);
    for (const path of ["/", "/login", "/pedidos", "/tienda-online", "/tienda-online/qr", "/tiendax", "/dashboard", "/api/variantes/buscar", "/catalogo"]) expect(isPublicPath(path)).toBe(false);
  });
  it("throttle keys are namespaced per limit and bounded", () => {
    expect(throttleKey(LIMITS.checkoutIp, "1.2.3.4")).toBe("checkout-ip:1.2.3.4");
    expect(throttleKey(LIMITS.proofToken, "x".repeat(500)).length).toBeLessThan(150);
    expect(LIMITS.orderMissIp.max).toBeLessThan(LIMITS.orderViewIp.max);
  });
});

describe("store admin schemas", () => {
  it("new zones and pickup points come without an id and still validate", async () => {
    const { pickupSchema, zoneSchema, storeSettingsSchema } = await import("@/features/store-admin/schemas");
    expect(zoneSchema.safeParse({ name: "Zona", fee: "22,50", sortOrder: "0", active: true, description: "" })).toMatchObject({ success: true, data: { id: null, fee: "22.50", description: null } });
    expect(zoneSchema.safeParse({ name: "Zona", fee: "99999", active: true }).success).toBe(false);
    expect(zoneSchema.safeParse({ name: " ", fee: "1", active: true }).success).toBe(false);
    expect(pickupSchema.safeParse({ branchId: "11111111-1111-4111-8111-111111111111", label: "Tienda", active: true }).success).toBe(true);
    expect(pickupSchema.safeParse({ label: "Tienda", active: true }).success).toBe(false);
    const ok = storeSettingsSchema.safeParse({ open: true, whatsapp: "7123 4567", branchId: "", bankInstructions: "", policyExchange: "x".repeat(1001), policyShipping: "" });
    expect(ok.success).toBe(false);
    expect(storeSettingsSchema.safeParse({ open: false, whatsapp: "7123 4567", branchId: "" })).toMatchObject({ success: true, data: { whatsapp: "59171234567", branchId: null } });
    expect(storeSettingsSchema.safeParse({ open: false, whatsapp: "hola", branchId: "" }).success).toBe(false);
  });
});

describe("per-IP throttling buckets", () => {
  it("counts IPv4 one by one and IPv6 per /64", async () => {
    const { ipBucket } = await import("@/features/store/throttle");
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:0001:0002::/64");
    expect(ipBucket("2001:db8:1:2::1")).toBe("2001:0db8:0001:0002::/64");
    expect(ipBucket("2001:DB8:1:2:ffff:ffff:ffff:ffff")).toBe(ipBucket("2001:db8:1:2::9"));
    expect(ipBucket("::1")).toBe("0000:0000:0000:0000::/64");
  });
});

describe("throttle limits respect the database function bounds", () => {
  it("every limit fits auth_reserve_attempt (max 1..1000, window 1..86400 s): a violation would fail closed for everybody", () => {
    for (const limit of Object.values(LIMITS)) {
      expect(limit.max).toBeGreaterThanOrEqual(1);
      expect(limit.max).toBeLessThanOrEqual(1000);
      expect(limit.windowSeconds).toBeGreaterThanOrEqual(1);
      expect(limit.windowSeconds).toBeLessThanOrEqual(86_400);
    }
  });
});
