import { describe, expect, it } from "vitest";
import { DEFAULT_BRANCHES, parseBranches, readBootstrapConfig } from "../../scripts/lib/bootstrap";

const PASSWORD = "una-clave-larga-123";

describe("parseBranches", () => {
  it("reads name, city and state; La Paz of the default plan opens later", () => {
    expect(parseBranches(DEFAULT_BRANCHES)).toEqual([
      { name: "Central", city: "Santa Cruz", active: true },
      { name: "La Paz", city: "La Paz", active: false },
    ]);
  });

  it("accepts a branch without city and rejects bad input", () => {
    expect(parseBranches("Única")).toEqual([{ name: "Única", city: null, active: true }]);
    expect(() => parseBranches("")).toThrow(/al menos una sucursal/);
    expect(() => parseBranches("A")).toThrow(/no válida/);
    expect(() => parseBranches("Central:SC:quizás")).toThrow(/Estado no válido/);
    expect(() => parseBranches("Central;central")).toThrow(/repetidas/);
    expect(() => parseBranches("Central:SC:inactiva")).toThrow(/activa/);
  });
});

describe("readBootstrapConfig", () => {
  it("requires a strong password from the environment (never defaulted)", () => {
    expect(() => readBootstrapConfig({})).toThrow(/BOOTSTRAP_SUPERADMIN_PASSWORD/);
    expect(() => readBootstrapConfig({ BOOTSTRAP_SUPERADMIN_PASSWORD: "corta" })).toThrow(/mínimo 12/);
  });

  it("normalizes the username and exposes --reset-password", () => {
    const config = readBootstrapConfig({ BOOTSTRAP_SUPERADMIN_PASSWORD: PASSWORD, BOOTSTRAP_SUPERADMIN_USERNAME: " Naty " }, ["--reset-password"]);
    expect(config.username).toBe("naty");
    expect(config.resetPassword).toBe(true);
    expect(() => readBootstrapConfig({ BOOTSTRAP_SUPERADMIN_PASSWORD: PASSWORD, BOOTSTRAP_SUPERADMIN_USERNAME: "a b" })).toThrow(/USERNAME/);
  });
});
