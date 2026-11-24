import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { addLine, cartSignature, countUnits, decodeCart, encodeCart, removeLine, setLineQty } from "@/features/store/cart/cart-store";
import { mergeCart } from "@/features/store/cart/useCartDetails";
import { ImageRejected, MAX_UPLOAD_BYTES, processProductImage, processProof, processQr, readUpload, sniffImage } from "@/features/store/images";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("cart (pure logic)", () => {
  it("adds, merges, caps quantities and lines", () => {
    let cart = addLine([], A, 2);
    cart = addLine(cart, A, 20);
    expect(cart).toEqual([{ variantId: A, qty: 10 }]);
    cart = addLine(cart, B, 1);
    expect(countUnits(cart)).toBe(11);
    const full = Array.from({ length: 30 }, (_, i) => ({ variantId: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`, qty: 1 }));
    expect(addLine(full, A, 1)).toBe(full);
  });
  it("sets and removes lines; zero removes", () => {
    const cart = [{ variantId: A, qty: 2 }, { variantId: B, qty: 1 }];
    expect(setLineQty(cart, A, 5)[0].qty).toBe(5);
    expect(setLineQty(cart, A, 99)[0].qty).toBe(10);
    expect(setLineQty(cart, A, 0)).toEqual([{ variantId: B, qty: 1 }]);
    expect(removeLine(cart, B)).toEqual([{ variantId: A, qty: 2 }]);
  });
  it("storage round trip survives corruption and tampering", () => {
    const cart = [{ variantId: A, qty: 3 }];
    expect(decodeCart(encodeCart(cart))).toEqual(cart);
    for (const bad of [null, "", "{", "[1,2]", JSON.stringify([{ variantId: A, qty: 999 }]), JSON.stringify([{ variantId: "x", qty: 1, price: 0 }])]) expect(decodeCart(bad)).toEqual([]);
  });
  it("the checkout idempotency signature changes with the cart, not with its order", () => {
    expect(cartSignature([{ variantId: A, qty: 1 }, { variantId: B, qty: 2 }])).toBe(cartSignature([{ variantId: B, qty: 2 }, { variantId: A, qty: 1 }]));
    expect(cartSignature([{ variantId: A, qty: 1 }])).not.toBe(cartSignature([{ variantId: A, qty: 2 }]));
  });
});

describe("server-side revalidation of the cart (client prices are never used)", () => {
  const detail = (id: string, price: number, cap: number) => ({ variant_id: id, slug: "s", model: "M", color: "C", color_hex: null, size: "38", price, cap, image: null });
  it("prices from the server, flags gone/sold-out/short lines and bills only what can be served", () => {
    const merged = mergeCart([{ variantId: A, qty: 3 }, { variantId: B, qty: 1 }, { variantId: "33333333-3333-4333-8333-333333333333", qty: 1 }], [detail(A, 100, 2), detail(B, 50, 0)]);
    expect(merged.map((l) => l.problem)).toEqual(["short", "soldout", "gone"]);
    expect(merged[0]).toMatchObject({ maxQty: 2, lineTotal: "200.00" });
    expect(merged[1].lineTotal).toBe("0.00");
    expect(merged[2].detail).toBeNull();
    expect(mergeCart([{ variantId: A, qty: 1 }], [detail(A, 100, 5)])[0].problem).toBeNull();
  });
});

describe("image pipeline", () => {
  const photo = (w = 2400, h = 1800, fmt: "jpeg" | "png" = "jpeg") =>
    sharp({ create: { width: w, height: h, channels: 3, background: "#a23b60", noise: { type: "gaussian", mean: 128, sigma: 60 } } })[fmt]().toBuffer();

  it("sniffs magic bytes and refuses everything else", async () => {
    expect(sniffImage(await photo(10, 10))).toBe("jpeg");
    expect(sniffImage(await photo(10, 10, "png"))).toBe("png");
    expect(sniffImage(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).webp().toBuffer())).toBe("webp");
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a" + "x".repeat(20)))).toBeNull();
    expect(sniffImage(Buffer.from("%PDF-1.7 ".repeat(5)))).toBeNull();
    expect(sniffImage(Buffer.alloc(4))).toBeNull();
  });

  it("readUpload enforces size and type before decoding", async () => {
    await expect(readUpload(null)).rejects.toThrow(ImageRejected);
    await expect(readUpload(new File([], "a.png"))).rejects.toThrow(ImageRejected);
    await expect(readUpload(new File([Buffer.alloc(MAX_UPLOAD_BYTES + 1, 1)], "big.png", { type: "image/png" }))).rejects.toThrow(/4 MB/);
    await expect(readUpload(new File(['<svg xmlns="http://www.w3.org/2000/svg"/> padding padding'], "x.png", { type: "image/png" }))).rejects.toThrow(/JPG, PNG o WebP/);
    await expect(readUpload(new File([await photo(40, 40)], "ok.jpg"))).resolves.toBeInstanceOf(Buffer);
  });

  it("re-encodes a big photo to WebP: <= 900px, <= 150 KB, plus a 400px thumbnail", async () => {
    const set = await processProductImage(await photo());
    expect(Math.max(set.full.width, set.full.height)).toBeLessThanOrEqual(900);
    expect(set.full.bytes.length).toBeLessThanOrEqual(150_000);
    expect(Math.max(set.thumb.width, set.thumb.height)).toBeLessThanOrEqual(400);
    expect(set.thumb.bytes.length).toBeLessThanOrEqual(60_000);
    expect(sniffImage(set.full.bytes)).toBe("webp");
    expect((await sharp(set.full.bytes).metadata()).format).toBe("webp");
    expect(set.etag).toMatch(/^[0-9a-f]{40}$/);
  });

  it("strips metadata (EXIF/GPS) and flattens transparency", async () => {
    const withExif = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.2 } } })
      .withExif({ IFD0: { Copyright: "secret-owner", ImageDescription: "gps-home" } }).png().toBuffer();
    const { full } = await processProductImage(withExif);
    const meta = await sharp(full.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.hasAlpha).toBe(false);
    expect(full.bytes.includes(Buffer.from("secret-owner"))).toBe(false);
  });

  it("does not trust a lying extension: a polyglot that is not an image fails to decode", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("<script>alert(1)</script>".repeat(20))]);
    await expect(processProductImage(fake)).rejects.toThrow(ImageRejected);
  });

  it("proofs and the QR keep readable output within the database limits", async () => {
    const proof = await processProof(await photo(3000, 2000));
    expect(proof.image.bytes.length).toBeLessThanOrEqual(500_000);
    expect(Math.max(proof.image.width, proof.image.height)).toBeLessThanOrEqual(1400);
    const qrSource = await sharp({ create: { width: 700, height: 700, channels: 3, background: "#fff" } }).png().toBuffer();
    const qr = await processQr(qrSource);
    expect(sniffImage(qr.image.bytes)).toBe("webp");
  });
});
