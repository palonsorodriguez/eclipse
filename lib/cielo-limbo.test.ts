import { describe, expect, it } from "vitest";
import {
  ARCO_PERLAS_LIMBO,
  ARMONICOS_ECLIPSE,
  armonicosLimbo,
  NUM_ARMONICOS_LIMBO,
  perlasDesdeLimbo,
  rugosidadLimbo,
  SEMILLA_LIMBO,
} from "./cielo-limbo";

describe("armonicosLimbo", () => {
  it("es determinista: la misma semilla produce el mismo relieve", () => {
    expect(armonicosLimbo(SEMILLA_LIMBO)).toEqual(armonicosLimbo(SEMILLA_LIMBO));
    expect(armonicosLimbo(1)).not.toEqual(armonicosLimbo(2));
  });

  it("produce los armónicos esperados con amplitudes normalizadas", () => {
    const armonicos = armonicosLimbo(SEMILLA_LIMBO);
    expect(armonicos).toHaveLength(NUM_ARMONICOS_LIMBO);
    const suma = armonicos.reduce((acc, a) => acc + a.amplitud, 0);
    expect(suma).toBeCloseTo(1);
    for (const a of armonicos) {
      expect(Number.isInteger(a.frecuencia)).toBe(true);
      expect(a.frecuencia).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("rugosidadLimbo", () => {
  it("es periódica en 2π (el limbo es un contorno cerrado)", () => {
    for (const ang of [0, 0.7, 2.4, 5.9]) {
      expect(rugosidadLimbo(ang + 2 * Math.PI)).toBeCloseTo(
        rugosidadLimbo(ang),
        10,
      );
    }
  });

  it("está acotada en [-1, 1] y tiene montañas y valles", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let ang = 0; ang < 2 * Math.PI; ang += 0.01) {
      const r = rugosidadLimbo(ang);
      expect(Math.abs(r)).toBeLessThanOrEqual(1);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min).toBeLessThan(-0.1); // hay valles de verdad
    expect(max).toBeGreaterThan(0.1); // y montañas
  });
});

describe("perlasDesdeLimbo", () => {
  it("ancla cada perla a un valle real (mínimo local negativo)", () => {
    const perlas = perlasDesdeLimbo(1.2);
    expect(perlas.length).toBeGreaterThanOrEqual(1);
    expect(perlas.length).toBeLessThanOrEqual(6);
    const eps = 0.04;
    for (const p of perlas) {
      const r = rugosidadLimbo(p.angulo);
      expect(r).toBeLessThan(0); // un valle, no una montaña
      expect(r).toBeLessThanOrEqual(rugosidadLimbo(p.angulo - eps) + 1e-9);
      expect(r).toBeLessThanOrEqual(rugosidadLimbo(p.angulo + eps) + 1e-9);
    }
  });

  it("todas las perlas caen dentro del arco alrededor del contacto", () => {
    const contacto = -2.1;
    for (const p of perlasDesdeLimbo(contacto)) {
      expect(Math.abs(p.angulo - contacto)).toBeLessThanOrEqual(
        ARCO_PERLAS_LIMBO + 0.05,
      );
    }
  });

  it("es determinista y depende del punto de contacto", () => {
    expect(perlasDesdeLimbo(1.2)).toEqual(perlasDesdeLimbo(1.2));
    // Con el contacto en el lado opuesto del limbo, otros valles.
    const a = perlasDesdeLimbo(0).map((p) => p.angulo);
    const b = perlasDesdeLimbo(Math.PI).map((p) => p.angulo);
    expect(a).not.toEqual(b);
  });

  it("usa los armónicos del eclipse por defecto", () => {
    expect(perlasDesdeLimbo(1, ARMONICOS_ECLIPSE)).toEqual(perlasDesdeLimbo(1));
  });
});
