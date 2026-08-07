import { describe, expect, it } from "vitest";
import { buscarMunicipios, municipios, normalizar } from "./municipios";

describe("dataset de municipios", () => {
  it("contiene ~8.100 municipios con coordenadas válidas", () => {
    expect(municipios.length).toBeGreaterThan(8000);
    for (const m of municipios) {
      expect(m.nombre.length).toBeGreaterThan(0);
      expect(m.provincia.length).toBeGreaterThan(0);
      // España (península, Baleares, Canarias, Ceuta y Melilla).
      expect(m.lat).toBeGreaterThan(27);
      expect(m.lat).toBeLessThan(44.5);
      expect(m.lon).toBeGreaterThan(-18.5);
      expect(m.lon).toBeLessThan(5);
    }
  });

  it("incluye municipios grandes y pequeños", () => {
    const nombres = new Set(municipios.map((m) => m.nombre));
    for (const esperado of ["Ferrol", "Oviedo", "Madrid", "Palma", "Cantiveros"]) {
      expect(nombres.has(esperado)).toBe(true);
    }
  });
});

describe("normalizar", () => {
  it("quita acentos y mayúsculas", () => {
    expect(normalizar("Córdoba")).toBe("cordoba");
    expect(normalizar("  A Coruña ")).toBe("a coruna");
    expect(normalizar("VALÈNCIA")).toBe("valencia");
  });
});

describe("buscarMunicipios", () => {
  it('"ferrol" devuelve Ferrol (A Coruña) primero', () => {
    const [primero] = buscarMunicipios("ferrol");
    expect(primero).toMatchObject({ nombre: "Ferrol", provincia: "A Coruña" });
    expect(primero!.lat).toBeCloseTo(43.5, 0);
    expect(primero!.lon).toBeCloseTo(-8.1, 0);
  });

  it('"oviedo" devuelve Oviedo primero', () => {
    const [primero] = buscarMunicipios("oviedo");
    expect(primero).toMatchObject({ nombre: "Oviedo", provincia: "Asturias" });
  });

  it('"cordoba" sin tilde encuentra Córdoba', () => {
    const [primero] = buscarMunicipios("cordoba");
    expect(primero).toMatchObject({ nombre: "Córdoba", provincia: "Córdoba" });
  });

  it('"sant" devuelve varios resultados', () => {
    const resultados = buscarMunicipios("sant");
    expect(resultados.length).toBeGreaterThan(3);
    for (const m of resultados) {
      expect(normalizar(m.nombre)).toContain("sant");
    }
  });

  it("prioriza la coincidencia por prefijo sobre la subcadena", () => {
    const resultados = buscarMunicipios("madrid");
    expect(resultados[0]!.nombre).toBe("Madrid");
  });

  it("respeta el límite y la consulta vacía", () => {
    expect(buscarMunicipios("sant", 3)).toHaveLength(3);
    expect(buscarMunicipios("")).toHaveLength(0);
    expect(buscarMunicipios("   ")).toHaveLength(0);
    expect(buscarMunicipios("xyzqw")).toHaveLength(0);
  });
});
