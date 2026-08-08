import { describe, expect, it } from "vitest";
import {
  alfaAparicion,
  CATALOGO_CIELO_COMPLETO,
  colorDesdeBV,
  cuerposDomo,
  tamanoPunto,
  umbralAparicion,
} from "./cielo-estrellas";

/** Ferrol, dentro de la Franja de totalidad. */
const FERROL = { lat: 43.4832, lon: -8.2369 };

/** Instante dentro de la Totalidad en Ferrol (~20:27 CEST). */
const T_TOTALIDAD = new Date("2026-08-12T18:27:30Z");

describe("catálogo de cielo completo", () => {
  it("amplía el catálogo a ~50 estrellas brillantes", () => {
    expect(CATALOGO_CIELO_COMPLETO.length).toBeGreaterThanOrEqual(50);
  });

  it("todas las entradas llevan magnitud y B−V en rangos plausibles", () => {
    for (const e of CATALOGO_CIELO_COMPLETO) {
      expect(e.magnitud).toBeGreaterThan(-2);
      expect(e.magnitud).toBeLessThan(2.5);
      expect(e.bv).toBeGreaterThan(-0.5);
      expect(e.bv).toBeLessThan(2.1);
    }
  });
});

describe("colorDesdeBV", () => {
  it("azuladas con B−V negativo, anaranjadas con B−V alto", () => {
    const rigel = colorDesdeBV(-0.03);
    expect(rigel[2]).toBeGreaterThan(rigel[0]); // más azul que rojo
    const betelgeuse = colorDesdeBV(1.85);
    expect(betelgeuse[0]).toBeGreaterThan(betelgeuse[2]); // más rojo que azul
  });

  it("el canal azul decrece monótonamente con B−V", () => {
    let previo = Infinity;
    for (let bv = -0.3; bv <= 2.0; bv += 0.1) {
      const [, , b] = colorDesdeBV(bv);
      expect(b).toBeLessThanOrEqual(previo + 1e-9);
      previo = b;
    }
  });
});

describe("tamanoPunto y umbralAparicion", () => {
  it("más brillante (menor magnitud) → punto mayor y aparición más temprana", () => {
    expect(tamanoPunto(-1.46)).toBeGreaterThan(tamanoPunto(2));
    expect(umbralAparicion(-4.4)).toBeGreaterThan(umbralAparicion(1));
    expect(umbralAparicion(-4.4)).toBeLessThanOrEqual(0.3);
    expect(umbralAparicion(2.3)).toBeGreaterThanOrEqual(0.02);
  });

  it("el alfa funde de 0 (cielo claro) a 1 (cielo apagado)", () => {
    expect(alfaAparicion(1, 1)).toBe(0);
    expect(alfaAparicion(1, 0)).toBe(1);
    const u = umbralAparicion(1);
    expect(alfaAparicion(1, u / 2)).toBeCloseTo(0.5);
  });

  it("con el mismo cielo, la estrella brillante luce más que la débil", () => {
    const brillo = 0.05;
    expect(alfaAparicion(-1.46, brillo)).toBeGreaterThan(
      alfaAparicion(2.2, brillo),
    );
  });
});

describe("cuerposDomo", () => {
  const cuerpos = cuerposDomo(FERROL, T_TOTALIDAD);

  it("incluye los 3 planetas y el catálogo completo", () => {
    expect(cuerpos.filter((c) => c.tipo === "planeta")).toHaveLength(3);
    expect(cuerpos.filter((c) => c.tipo === "estrella")).toHaveLength(
      CATALOGO_CIELO_COMPLETO.length,
    );
  });

  it("Venus está sobre el horizonte y al oeste durante la Totalidad", () => {
    const venus = cuerpos.find((c) => c.nombre === "Venus")!;
    expect(venus.altitud).toBeGreaterThan(0);
    expect(venus.acimut).toBeGreaterThan(180);
    expect(venus.acimut).toBeLessThan(360);
    expect(venus.magnitud).toBeLessThan(-3); // brillante de verdad
  });

  it("Arturo (visible al atardecer de agosto) está alto; Sirio bajo el horizonte", () => {
    const arturo = cuerpos.find((c) => c.nombre === "Arturo")!;
    expect(arturo.altitud).toBeGreaterThan(10);
    const sirio = cuerpos.find((c) => c.nombre === "Sirio")!;
    expect(sirio.altitud).toBeLessThan(0);
  });
});
