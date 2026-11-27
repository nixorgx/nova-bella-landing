import { describe, expect, it } from "vitest";
import {
  barcodeSchema,
  colorSchema,
  generateVariantsSchema,
  lineSchema,
  modelSchema,
  sizeSchema,
} from "@/features/catalog/schemas";

const UUID = "7f9c24e8-3d4b-4f3a-9b1a-2c7d8e5f6a10";
const UUID2 = "8a0d35f9-4e5c-4a4b-8c2b-3d8e9f6a7b21";

describe("modelSchema", () => {
  const valid = { lineId: UUID, name: "  Alba  ", description: "", basePrice: "189,5", active: "on" };

  it("trims, normalizes money and treats an empty description as null", () => {
    const parsed = modelSchema.parse(valid);
    expect(parsed.name).toBe("Alba");
    expect(parsed.basePrice).toBe("189.50");
    expect(parsed.description).toBeNull();
    expect(parsed.active).toBe(true);
  });

  it("accepts one-letter names", () => {
    expect(modelSchema.safeParse({ ...valid, name: "A" }).success).toBe(true);
  });

  it("rejects empty and overlong names with Spanish messages", () => {
    const empty = modelSchema.safeParse({ ...valid, name: "   " });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0].message).toBe("Ingrese el nombre del modelo.");
    const long = modelSchema.safeParse({ ...valid, name: "x".repeat(61) });
    expect(long.error?.issues[0].message).toBe("El nombre no puede pasar de 60 caracteres.");
  });

  it("rejects bad prices", () => {
    for (const basePrice of ["abc", "-5", "100000", ""]) {
      const result = modelSchema.safeParse({ ...valid, basePrice });
      expect(result.success, basePrice).toBe(false);
      expect(result.error?.issues[0].message).toBe("Ingrese un precio válido en Bs (ej. 189,50).");
    }
  });

  it("requires a line and defaults active to false when the checkbox is absent", () => {
    expect(modelSchema.safeParse({ ...valid, lineId: "nope" }).error?.issues[0].message).toBe("Seleccione una línea.");
    expect(modelSchema.parse({ ...valid, active: undefined }).active).toBe(false);
  });
});

describe("barcodeSchema", () => {
  it("normalizes empty input to null", () => {
    expect(barcodeSchema.parse("")).toBeNull();
    expect(barcodeSchema.parse("   ")).toBeNull();
  });

  it("trims valid codes", () => {
    expect(barcodeSchema.parse(" 7750001234567 ")).toBe("7750001234567");
  });

  it("rejects spaces inside, control characters and extreme lengths", () => {
    for (const code of ["77 50", "ab", "x".repeat(49), "añb12", "a\tb12"]) {
      expect(barcodeSchema.safeParse(code).success, code).toBe(false);
    }
  });
});

describe("lineSchema, colorSchema, sizeSchema", () => {
  it("validates line names", () => {
    expect(lineSchema.parse({ name: " Dama " }).name).toBe("Dama");
    expect(lineSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("requires a six digit hex for colors", () => {
    expect(colorSchema.parse({ name: "Rojo", hex: "#B3261E" }).hex).toBe("#b3261e");
    expect(colorSchema.safeParse({ name: "Rojo", hex: "red" }).error?.issues[0].message).toBe(
      "Elija un color válido.",
    );
  });

  it("validates size labels and order", () => {
    expect(sizeSchema.parse({ label: " 38.5 ", sortOrder: "385" })).toEqual({ label: "38.5", sortOrder: 385 });
    expect(sizeSchema.safeParse({ label: "", sortOrder: "1" }).success).toBe(false);
    expect(sizeSchema.safeParse({ label: "38", sortOrder: "-1" }).success).toBe(false);
    expect(sizeSchema.safeParse({ label: "38", sortOrder: "x" }).success).toBe(false);
  });
});

describe("generateVariantsSchema", () => {
  it("accepts ids as arrays or repeated form values", () => {
    const parsed = generateVariantsSchema.parse({ modelId: UUID, colorIds: [UUID, UUID2], sizeIds: UUID });
    expect(parsed.colorIds).toHaveLength(2);
    expect(parsed.sizeIds).toEqual([UUID]);
  });

  it("requires at least one color and one size", () => {
    const result = generateVariantsSchema.safeParse({ modelId: UUID, colorIds: [], sizeIds: [UUID] });
    expect(result.error?.issues[0].message).toBe("Marque al menos un color.");
    const sizes = generateVariantsSchema.safeParse({ modelId: UUID, colorIds: [UUID], sizeIds: [] });
    expect(sizes.error?.issues[0].message).toBe("Marque al menos una talla.");
  });

  it("caps the number of combinations", () => {
    const many = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const result = generateVariantsSchema.safeParse({ modelId: UUID, colorIds: many, sizeIds: many });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("400");
  });
});
