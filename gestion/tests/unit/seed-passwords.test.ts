import { describe, expect, it } from "vitest";
import { generatePassword, MIN_SEED_PASSWORD_LENGTH, resolveSeedUsers } from "../../scripts/lib/seed-passwords";

describe("resolveSeedUsers", () => {
  it("uses the passwords from the environment without marking them generated", () => {
    const users = resolveSeedUsers({
      SEED_SUPERADMIN_PASSWORD: "admin-password-123",
      SEED_SELLER_PASSWORD: "seller-password-123",
    });
    expect(users.map((u) => [u.username, u.password, u.generated])).toEqual([
      ["naty", "admin-password-123", false],
      ["vendedor1", "seller-password-123", false],
    ]);
  });

  it("generates the missing ones and flags them", () => {
    const users = resolveSeedUsers({ SEED_SELLER_PASSWORD: "seller-password-123" }, () => "generated-value-xyz");
    expect(users[0]).toMatchObject({ username: "naty", password: "generated-value-xyz", generated: true });
    expect(users[1].generated).toBe(false);
  });

  it("treats an empty value as missing", () => {
    expect(resolveSeedUsers({ SEED_SUPERADMIN_PASSWORD: "" }, () => "generated-value-xyz")[0].generated).toBe(true);
  });

  it("takes the superadmin username from SEED_SUPERADMIN_USERNAME, stored in lowercase", () => {
    const users = resolveSeedUsers({ SEED_SUPERADMIN_USERNAME: " Admin.Boutique ", SEED_SUPERADMIN_PASSWORD: "admin-password-123" });
    expect(users[0].username).toBe("admin.boutique");
    expect(users[1].username).toBe("vendedor1");
  });

  it("rejects an invalid superadmin username", () => {
    expect(() => resolveSeedUsers({ SEED_SUPERADMIN_USERNAME: "a b" })).toThrow(/SEED_SUPERADMIN_USERNAME/);
  });

  it("rejects passwords shorter than the policy", () => {
    expect(() => resolveSeedUsers({ SEED_SUPERADMIN_PASSWORD: "short" })).toThrow(/SEED_SUPERADMIN_PASSWORD/);
  });
});

describe("generatePassword", () => {
  it("is random and satisfies the minimum length", () => {
    const a = generatePassword();
    expect(a.length).toBeGreaterThanOrEqual(MIN_SEED_PASSWORD_LENGTH);
    expect(a).not.toBe(generatePassword());
  });
});
