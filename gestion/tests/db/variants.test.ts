import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { systemQuery } from "../helpers/system";
import { generateVariants } from "@/features/catalog/variant-generator";
import { setVariantBarcode } from "@/features/catalog/variants";
import { CatalogError } from "@/features/catalog/types";
import { createBranch, createUser, expectPgError } from "../helpers/fixtures";
import { makeColor, makeLine, makeModel, makeSize, makeVariantRow, tag } from "../helpers/catalog";

let admin: SessionPayload;
let seller: SessionPayload;

beforeAll(async () => {
  const branch = await createBranch();
  admin = await createUser("superadmin", null);
  seller = await createUser("seller", branch);
});

async function skusOf(modelId: string): Promise<string[]> {
  const { rows } = await systemQuery<{ sku: string }>("select sku from variants where model_id = $1 order by sku", [modelId]);
  return rows.map((row) => row.sku);
}

describe("generateVariants", () => {
  it("creates every color x size combination with LINEA-MODELO-COLOR-TALLA skus", async () => {
    const line = await makeLine(`Dama ${tag()}`);
    const model = await makeModel(line, `Alba ${tag()}`.slice(0, 8));
    const [black, red] = [await makeColor(`Negro ${tag()}`), await makeColor(`Rojo ${tag()}`)];
    const [s37, s38, s39] = [await makeSize(`37-${tag()}`, 1), await makeSize(`38-${tag()}`, 2), await makeSize(`39-${tag()}`, 3)];

    const result = await generateVariants(admin, { modelId: model, colorIds: [black, red], sizeIds: [s37, s38, s39] });

    expect(result).toMatchObject({ created: 6, skipped: 0 });
    const skus = await skusOf(model);
    expect(skus).toHaveLength(6);
    expect(new Set(skus).size).toBe(6);
    for (const sku of skus) expect(sku).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+){3}(-\d+)?$/);
  });

  it("skips existing combinations and reports created/skipped", async () => {
    const model = await makeModel(await makeLine());
    const [c1, c2] = [await makeColor(), await makeColor()];
    const [s1, s2] = [await makeSize(`A${tag()}`, 1), await makeSize(`B${tag()}`, 2)];

    const first = await generateVariants(admin, { modelId: model, colorIds: [c1], sizeIds: [s1, s2] });
    expect(first).toMatchObject({ created: 2, skipped: 0 });

    const second = await generateVariants(admin, { modelId: model, colorIds: [c1, c2], sizeIds: [s1, s2] });
    expect(second).toMatchObject({ created: 2, skipped: 2 });
    expect(await skusOf(model)).toHaveLength(4);

    const third = await generateVariants(admin, { modelId: model, colorIds: [c1, c2], sizeIds: [s1, s2] });
    expect(third).toMatchObject({ created: 0, skipped: 4 });
  });

  it("resolves SKU collisions between colors that slug to the same text", async () => {
    const model = await makeModel(await makeLine(`Dama ${tag()}`), "Colision");
    const a = await makeColor(`Azul marino ${tag()}`);
    const b = await makeColor(`Azul mariposa ${tag()}`);
    const size = await makeSize(`C${tag()}`.slice(0, 4), 1);
    const result = await generateVariants(admin, { modelId: model, colorIds: [a, b], sizeIds: [size] });
    expect(result.created).toBe(2);
    const skus = await skusOf(model);
    expect(new Set(skus).size).toBe(2);
    expect(skus.some((sku) => /-2$/.test(sku))).toBe(true);
  });

  it("avoids a SKU already taken by another model", async () => {
    const line = await makeLine(`Dama ${tag()}`);
    const color = await makeColor("Negro " + tag());
    const size = await makeSize(`D${tag()}`.slice(0, 4), 1);
    const modelA = await makeModel(line, "Gemelo");
    const modelB = await makeModel(await makeLine(`Dama ${tag()}`), "Gemelo");
    await generateVariants(admin, { modelId: modelA, colorIds: [color], sizeIds: [size] });
    await generateVariants(admin, { modelId: modelB, colorIds: [color], sizeIds: [size] });
    const all = [...(await skusOf(modelA)), ...(await skusOf(modelB))];
    expect(new Set(all).size).toBe(2);
  });

  it("is atomic: an unknown size aborts without creating anything", async () => {
    const model = await makeModel(await makeLine());
    const color = await makeColor();
    const size = await makeSize(`E${tag()}`.slice(0, 4), 1);
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(
      generateVariants(admin, { modelId: model, colorIds: [color], sizeIds: [size, missing] }),
    ).rejects.toBeInstanceOf(CatalogError);
    expect(await skusOf(model)).toHaveLength(0);
  });

  it("refuses inactive models", async () => {
    const model = await makeModel(await makeLine(), "Retirado", "100.00", false);
    const color = await makeColor();
    const size = await makeSize(`F${tag()}`.slice(0, 4), 1);
    await expect(generateVariants(admin, { modelId: model, colorIds: [color], sizeIds: [size] })).rejects.toThrow(
      /Active el modelo/,
    );
  });

  it("survives two concurrent generations for the same model", async () => {
    const model = await makeModel(await makeLine());
    const colors = [await makeColor(), await makeColor()];
    const sizes = [await makeSize(`G${tag()}`.slice(0, 4), 1), await makeSize(`H${tag()}`.slice(0, 4), 2)];
    const [a, b] = await Promise.all([
      generateVariants(admin, { modelId: model, colorIds: colors, sizeIds: sizes }),
      generateVariants(admin, { modelId: model, colorIds: colors, sizeIds: sizes }),
    ]);
    expect(a.created + b.created).toBe(4);
    expect(await skusOf(model)).toHaveLength(4);
  });

  it("is forbidden for sellers", async () => {
    const model = await makeModel(await makeLine());
    const color = await makeColor();
    const size = await makeSize(`I${tag()}`.slice(0, 4), 1);
    await expectPgError(generateVariants(seller, { modelId: model, colorIds: [color], sizeIds: [size] }), "42501");
  });
});

describe("barcodes", () => {
  it("enforces unique barcodes with a message naming the owner", async () => {
    const model = await makeModel(await makeLine());
    const color = await makeColor();
    const [s1, s2] = [await makeSize(`J${tag()}`.slice(0, 4), 1), await makeSize(`K${tag()}`.slice(0, 4), 2)];
    const first = await makeVariantRow(model, color, s1, `SKU-${tag()}`);
    const second = await makeVariantRow(model, color, s2, `SKU-${tag()}`);
    const code = `775${tag()}`;

    await setVariantBarcode(admin, first, code);
    await expect(setVariantBarcode(admin, second, code)).rejects.toThrow(/ya pertenece a SKU-/);
    await setVariantBarcode(admin, first, null);
    await setVariantBarcode(admin, second, code);
    const { rows } = await systemQuery("select barcode from variants where id = $1", [second]);
    expect(rows[0].barcode).toBe(code);
  });

  it("allows many variants without barcode (NULLs do not collide)", async () => {
    const model = await makeModel(await makeLine());
    const color = await makeColor();
    for (let i = 0; i < 3; i += 1) {
      await makeVariantRow(model, color, await makeSize(`L${i}${tag()}`.slice(0, 5), i), `SKU-${tag()}`);
    }
    expect(await skusOf(model)).toHaveLength(3);
  });
});

describe("catalog deletes", () => {
  it("blocks deleting anything that still has variants, allows unused entries", async () => {
    const line = await makeLine();
    const model = await makeModel(line);
    const color = await makeColor();
    const size = await makeSize(`M${tag()}`.slice(0, 4), 1);
    await makeVariantRow(model, color, size, `SKU-${tag()}`);

    await expectPgError(withUser(admin, (c) => c.query("delete from models where id = $1", [model])), "23503");
    await expectPgError(withUser(admin, (c) => c.query("delete from colors where id = $1", [color])), "23503");
    await expectPgError(withUser(admin, (c) => c.query("delete from product_lines where id = $1", [line])), "23503");

    const unused = await makeColor();
    await withUser(admin, (c) => c.query("delete from colors where id = $1", [unused]));
    const { rowCount } = await systemQuery("select 1 from colors where id = $1", [unused]);
    expect(rowCount).toBe(0);
  });

  it("sellers cannot delete catalog rows", async () => {
    const color = await makeColor();
    await expectPgError(withUser(seller, (c) => c.query("delete from colors where id = $1", [color])), "42501");
  });

  it("colors and sizes can be deactivated", async () => {
    const color = await makeColor();
    await withUser(admin, (c) => c.query("update colors set active = false where id = $1", [color]));
    const { rows } = await systemQuery("select active from colors where id = $1", [color]);
    expect(rows[0].active).toBe(false);
  });
});
