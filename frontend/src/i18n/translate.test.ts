import { describe, expect, it } from "vitest";
import { ES } from "./es";
import { toSpanish } from "./translate";

describe("toSpanish", () => {
  it("translates a known text and keeps the spaces around it", () => {
    expect(toSpanish("My account")).toBe("Mi cuenta");
    expect(toSpanish("  My account ")).toBe("  Mi cuenta ");
  });

  it("returns an unknown text unchanged", () => {
    expect(toSpanish("Zxqv wholly unknown text")).toBe("Zxqv wholly unknown text");
    expect(toSpanish("12.500")).toBe("12.500");
    expect(toSpanish("")).toBe("");
  });

  it("fills the values of a template", () => {
    expect(toSpanish("Edit Factura 12")).toBe("Editar Factura 12");
    expect(toSpanish("Row 4: 2026-13 has not closed yet and was skipped.")).toBe("Fila 4: 2026-13 aún no ha cerrado y se omitió.");
  });

  it("translates each part of a text joined with a middle dot", () => {
    expect(toSpanish("Delete · Edit")).toBe("Eliminar · Editar");
  });

  it("every template uses the same placeholders in both languages", () => {
    const holes = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join(",");
    const broken = Object.entries(ES).filter(([en, es]) => holes(en) !== holes(es)).map(([en]) => en);
    expect(broken).toEqual([]);
  });

  it("no translation is empty", () => {
    expect(Object.entries(ES).filter(([, es]) => es.trim() === "").map(([en]) => en)).toEqual([]);
  });
});
