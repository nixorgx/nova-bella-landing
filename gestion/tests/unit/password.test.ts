import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSellerSchema, MIN_PASSWORD_LENGTH } from "@/features/users/schemas";

describe("password hashing", () => {
  it("hashes with the configured work factor (BCRYPT_COST, 4 under test) and verifies", async () => {
    const hash = await hashPassword("una-clave-segura-1");
    expect(bcrypt.getRounds(hash)).toBe(Number(process.env.BCRYPT_COST));
    expect(await verifyPassword("una-clave-segura-1", hash)).toBe(true);
    expect(await verifyPassword("otra-clave-segura", hash)).toBe(false);
  });

  it("an unknown user (no stored hash) never verifies but still burns a real bcrypt comparison", async () => {
    expect(await verifyPassword("lo-que-sea", null)).toBe(false);
    // The dummy hash must cost the same as real hashes or timing would reveal which users exist.
    const real = bcrypt.getRounds(await hashPassword("x".repeat(12)));
    const compare = bcrypt.compare;
    let comparedRounds = 0;
    bcrypt.compare = (async (password: string, hash: string) => {
      comparedRounds = bcrypt.getRounds(hash);
      return compare(password, hash);
    }) as typeof bcrypt.compare;
    try {
      await verifyPassword("lo-que-sea", null);
    } finally {
      bcrypt.compare = compare;
    }
    expect(comparedRounds).toBe(real);
  });
});

describe("new seller passwords", () => {
  const base = { username: "ana", fullName: "Ana Perez", branchId: "11111111-1111-4111-8111-111111111111" };

  it("require at least 12 characters, with the message in Spanish", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    const short = createSellerSchema.safeParse({ ...base, password: "onceletras1" });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0].message).toBe("La contraseña debe tener al menos 12 caracteres.");
    expect(createSellerSchema.safeParse({ ...base, password: "docecaracter" }).success).toBe(true);
  });

  it("still rejects passwords bcrypt would silently truncate (> 72 bytes)", () => {
    expect(createSellerSchema.safeParse({ ...base, password: "a".repeat(73) }).success).toBe(false);
  });
});
