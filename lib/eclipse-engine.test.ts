/**
 * Validación del eclipse-engine contra las circunstancias locales publicadas
 * para el eclipse solar total del 12 de agosto de 2026.
 *
 * Fuentes de los valores esperados:
 * - IGN: https://eclipses.ign.es/eclipse-total-sol-de-12-de-agosto-2026.html
 * - Wikipedia (basada en IGN): máximo en Oviedo a las 20:27:59 CEST,
 *   totalidad de 1m48s.
 * - Contraste adicional: theskylive.com (Oviedo ~1m51s de totalidad),
 *   snowy.es y absoluteeclipse.eu (Ferrol: máximo ~20:27 CEST, sol a ~12°,
 *   totalidad 1m18s–1m33s).
 *
 * Tolerancias acordadas en el ticket #3: ±60 s en horas de contacto,
 * ±2 puntos porcentuales en Oscurecimiento, ±15 s en duración de Totalidad.
 *
 * Nota horaria: España peninsular y Baleares están en CEST (UT+2) en agosto;
 * todas las horas de este fichero se expresan en UT.
 */

import { describe, expect, test } from "vitest";
import { createEclipseEngine } from "./eclipse-engine";

const TOLERANCIA_CONTACTO_MS = 60_000;
const TOLERANCIA_OSCURECIMIENTO = 0.02;
const TOLERANCIA_TOTALIDAD_S = 15;

function expectInstanteCerca(actual: Date, esperadoIso: string) {
  const esperado = new Date(esperadoIso).getTime();
  expect(Math.abs(actual.getTime() - esperado)).toBeLessThanOrEqual(
    TOLERANCIA_CONTACTO_MS,
  );
}

describe("Oviedo (43.3614, -5.8593) — Totalidad plena", () => {
  const engine = createEclipseEngine({ lat: 43.3614, lon: -5.8593 });
  const c = engine.circunstancias;

  test("el eclipse es total", () => {
    expect(c.tipo).toBe("total");
  });

  test("el Máximo ocurre a las ~20:28 CEST (18:27:59 UT según IGN/Wikipedia)", () => {
    expectInstanteCerca(c.maximo.instante, "2026-08-12T18:27:59Z");
  });

  test("la Totalidad dura ~1m48s (IGN; theskylive da 1m51s)", () => {
    // IGN/Wikipedia publican 1m48s; theskylive.com calcula ~1m51s para las
    // mismas coordenadas. Nuestro motor da ~111 s, dentro de la tolerancia
    // de ±15 s respecto al dato del IGN (108 s).
    expect(c.duracionTotalidadSegundos).toBeDefined();
    expect(c.duracionTotalidadSegundos!).toBeGreaterThanOrEqual(
      108 - TOLERANCIA_TOTALIDAD_S,
    );
    expect(c.duracionTotalidadSegundos!).toBeLessThanOrEqual(
      108 + TOLERANCIA_TOTALIDAD_S,
    );
  });

  test("el Oscurecimiento máximo es 100%", () => {
    expect(c.oscurecimientoMaximo).toBeCloseTo(1, 5);
  });

  test("obscurationAt vale 1 en pleno intervalo C2–C3", () => {
    const medioTotalidad = new Date(
      (c.c2!.instante.getTime() + c.c3!.instante.getTime()) / 2,
    );
    expect(engine.obscurationAt(medioTotalidad)).toBe(1);
  });

  test("obscurationAt vale 0 fuera del intervalo C1–C4", () => {
    const antesDeC1 = new Date(c.c1.instante.getTime() - 10 * 60_000);
    const despuesDeC4 = new Date(c.c4.instante.getTime() + 10 * 60_000);
    expect(engine.obscurationAt(antesDeC1)).toBe(0);
    expect(engine.obscurationAt(despuesDeC4)).toBe(0);
  });
});

describe("Madrid (40.4168, -3.7038) — parcial profundo, borde sur de la Franja", () => {
  const engine = createEclipseEngine({ lat: 40.4168, lon: -3.7038 });
  const c = engine.circunstancias;

  test("Oscurecimiento máximo ≥ 99% (IGN: ~99,9%)", () => {
    expect(c.oscurecimientoMaximo).toBeGreaterThanOrEqual(0.99);
  });

  test("sin Totalidad, o Totalidad marginal de pocos segundos", () => {
    // El borde sur de la Franja de totalidad pasa muy cerca del norte del
    // municipio: el centro de Madrid queda fuera (parcial ~99,9% según IGN),
    // pero se acepta una totalidad marginal por sensibilidad del límite.
    if (c.tipo === "total") {
      expect(c.duracionTotalidadSegundos!).toBeLessThan(10);
    } else {
      expect(c.c2).toBeUndefined();
      expect(c.c3).toBeUndefined();
      expect(c.duracionTotalidadSegundos).toBeUndefined();
    }
  });

  test("obscurationAt en el Máximo coincide con el Oscurecimiento máximo", () => {
    const enElMaximo = engine.obscurationAt(c.maximo.instante);
    expect(
      Math.abs(enElMaximo - c.oscurecimientoMaximo),
    ).toBeLessThanOrEqual(TOLERANCIA_OSCURECIMIENTO);
  });
});

describe("Ferrol (43.4832, -8.2369) — dentro de la Franja de totalidad", () => {
  const engine = createEclipseEngine({ lat: 43.4832, lon: -8.2369 });
  const c = engine.circunstancias;

  test("el eclipse es total", () => {
    expect(c.tipo).toBe("total");
  });

  test("el Máximo ocurre a las ~20:27–20:28 CEST (~18:27:57 UT)", () => {
    // El ticket citaba "~20:26 CEST", pero las fuentes consultadas
    // (snowy.es, absoluteeclipse.eu, eclipses.app — todas coherentes con
    // timeanddate) sitúan el máximo en Ferrol a las 20:27 CEST con el sol
    // a ~12° de altitud, en línea con lo calculado (20:27:57 CEST, 12,0°).
    expectInstanteCerca(c.maximo.instante, "2026-08-12T18:27:57Z");
  });

  test("la Totalidad dura ~1m33s (fuentes: 1m18s–1m33s según punto exacto)", () => {
    expect(c.duracionTotalidadSegundos!).toBeGreaterThanOrEqual(
      93 - TOLERANCIA_TOTALIDAD_S,
    );
    expect(c.duracionTotalidadSegundos!).toBeLessThanOrEqual(
      93 + TOLERANCIA_TOTALIDAD_S,
    );
  });
});

describe("Palma (39.5696, 2.6502) — total con el sol muy bajo", () => {
  const engine = createEclipseEngine({ lat: 39.5696, lon: 2.6502 });
  const c = engine.circunstancias;

  test("el eclipse es total", () => {
    expect(c.tipo).toBe("total");
  });

  test("en el Máximo el sol está a menos de 5° de altitud", () => {
    expect(c.maximo.altitudSolar).toBeGreaterThan(0);
    expect(c.maximo.altitudSolar).toBeLessThan(5);
  });

  test("sunMoonPositions en el Máximo: discos solapados y sol bajo", () => {
    const p = engine.sunMoonPositions(c.maximo.instante);
    expect(p.sol.altitud).toBeLessThan(5);
    // Radios aparentes plausibles (~0,25°–0,28°) y Luna mayor que el Sol
    // (condición necesaria para un eclipse total).
    expect(p.sol.radioAparente).toBeGreaterThan(0.25);
    expect(p.sol.radioAparente).toBeLessThan(0.28);
    expect(p.luna.radioAparente).toBeGreaterThan(p.sol.radioAparente);
    // En el Máximo de una Totalidad los centros casi coinciden.
    expect(p.separacionAngular).toBeLessThan(
      p.luna.radioAparente - p.sol.radioAparente,
    );
  });
});

describe("Sevilla (37.3891, -5.9845) — parcial", () => {
  const engine = createEclipseEngine({ lat: 37.3891, lon: -5.9845 });
  const c = engine.circunstancias;

  test("el eclipse es parcial", () => {
    expect(c.tipo).toBe("parcial");
    expect(c.c2).toBeUndefined();
    expect(c.c3).toBeUndefined();
  });

  test("Oscurecimiento máximo ~93–96% (calculado: 94,6%)", () => {
    expect(c.oscurecimientoMaximo).toBeGreaterThanOrEqual(0.93);
    expect(c.oscurecimientoMaximo).toBeLessThanOrEqual(0.96);
  });
});

describe("Franja de totalidad en España", () => {
  test("la Totalidad cae entre las 18:24 y las 18:35 UT en toda la franja", () => {
    const ciudadesTotales = [
      { lat: 43.3614, lon: -5.8593 }, // Oviedo
      { lat: 43.4832, lon: -8.2369 }, // Ferrol
      { lat: 39.5696, lon: 2.6502 }, // Palma
    ];
    const inicioVentana = new Date("2026-08-12T18:24:00Z").getTime();
    const finVentana = new Date("2026-08-12T18:35:00Z").getTime();

    for (const observador of ciudadesTotales) {
      const { circunstancias } = createEclipseEngine(observador);
      expect(circunstancias.c2!.instante.getTime()).toBeGreaterThanOrEqual(
        inicioVentana,
      );
      expect(circunstancias.c3!.instante.getTime()).toBeLessThanOrEqual(
        finVentana,
      );
    }
  });
});
