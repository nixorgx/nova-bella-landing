import { describe, expect, it } from "vitest";
import { canAccess, homeFor, navFor } from "@/lib/auth/routes";

describe("route access", () => {
  it("sends each role to its home", () => {
    expect(homeFor("superadmin")).toBe("/dashboard");
    expect(homeFor("seller")).toBe("/ventas");
  });

  it.each(["/dashboard", "/catalogo", "/compras", "/cajas", "/cajas/abc", "/sucursales", "/usuarios", "/usuarios/nuevo"])(
    "blocks sellers from %s",
    (path) => {
      expect(canAccess("seller", path)).toBe(false);
      expect(canAccess("superadmin", path)).toBe(true);
    },
  );

  it.each(["/ventas", "/clientes", "/stock", "/stock/zapatos", "/reportes", "/reportes/exportar/ventas"])("allows both roles on %s", (path) => {
    expect(canAccess("seller", path)).toBe(true);
    expect(canAccess("superadmin", path)).toBe(true);
  });

  it("does not confuse prefixes", () => {
    expect(canAccess("seller", "/ventas-extra")).toBe(true);
    expect(canAccess("seller", "/usuarios-x")).toBe(true);
    expect(canAccess("seller", "/usuariosx/admin")).toBe(true);
    expect(canAccess("seller", "/usuarios/x")).toBe(false);
  });

  it("builds a menu per role", () => {
    expect(navFor("superadmin").map((n) => n.label)).toEqual([
      "Dashboard", "Catálogo", "Compras", "Ventas", "Pedidos web", "Clientes", "Stock", "Cajas", "Reportes", "Sucursales", "Tienda online", "Usuarios",
    ]);
    expect(navFor("seller").map((n) => n.label)).toEqual(["Ventas", "Pedidos web", "Clientes", "Stock", "Reportes"]);
  });
});
