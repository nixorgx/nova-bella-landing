import { describe, expect, it } from "vitest";
import { generatePassphrase, PASSPHRASE_WORDS } from "@/features/account/passphrase";

describe("generatePassphrase", () => {
  it("uses unique, typeable real words", () => {
    expect(PASSPHRASE_WORDS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(PASSPHRASE_WORDS).size).toBe(PASSPHRASE_WORDS.length);
    for (const word of PASSPHRASE_WORDS) expect(word).toMatch(/^[A-Z][a-z]+$/);
  });

  it("makes four words and a two-digit number joined by hyphens, always >= 12 characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const phrase = generatePassphrase();
      expect(phrase).toMatch(/^([A-Z][a-z]+-){4}[1-9][0-9]$/);
      expect(phrase.length).toBeGreaterThanOrEqual(12);
      expect(new TextEncoder().encode(phrase).length).toBeLessThanOrEqual(72);
    }
  });

  it("is driven by the injected source (deterministic in tests, CSPRNG in production)", () => {
    expect(generatePassphrase(() => 0)).toBe(`${PASSPHRASE_WORDS[0]}-${PASSPHRASE_WORDS[0]}-${PASSPHRASE_WORDS[0]}-${PASSPHRASE_WORDS[0]}-10`);
  });
});
