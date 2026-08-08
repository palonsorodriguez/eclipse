import { describe, expect, test } from "vitest";
import { circunstanciasLocales } from "./eclipse-engine";
import {
  ANTICIPO_SALTO_MS,
  MARGEN_ANILLO_MS,
  VELOCIDAD_CONTACTO_PARCIAL,
  VELOCIDAD_LEJOS,
  VELOCIDAD_LENTA,
  VELOCIDAD_MAXIMO_PARCIAL,
  crearCurvaResumen,
  destinosSalto,
  duracionResumenSegundos,
  type ContactosMs,
} from "./linea-tiempo-velocidad";

/** Rango de la Línea de tiempo: 19:15–21:30 CEST del 12-08-2026. */
const T_MIN = Date.UTC(2026, 7, 12, 17, 15, 0);
const T_MAX = Date.UTC(2026, 7, 12, 19, 30, 0);

/** Ferrol: dentro de la Franja de totalidad (~93 s de Totalidad). */
const FERROL = { lat: 43.4832, lon: -8.2369 };
/** Sevilla: eclipse parcial (~95 % de Oscurecimiento máximo). */
const SEVILLA = { lat: 37.3891, lon: -5.9845 };

function contactosDe(observador: { lat: number; lon: number }): ContactosMs {
  const circ = circunstanciasLocales(observador);
  return {
    c1: circ.c1.instante.getTime(),
    c2: circ.c2 ? circ.c2.instante.getTime() : null,
    maximo: circ.maximo.instante.getTime(),
    c3: circ.c3 ? circ.c3.instante.getTime() : null,
    c4: circ.c4.instante.getTime(),
  };
}

const contactosTotal = contactosDe(FERROL);
const contactosParcial = contactosDe(SEVILLA);
const curvaTotal = crearCurvaResumen(contactosTotal);
const curvaParcial = crearCurvaResumen(contactosParcial);

describe("curva del modo resumen (eclipse total)", () => {
  test("lejos de todo vuela a ×600", () => {
    expect(curvaTotal(T_MIN)).toBe(VELOCIDAD_LEJOS);
    // Mitad de la parcialidad creciente: a >10 min de C1 y de C2.
    const mitad = (contactosTotal.c1 + contactosTotal.c2!) / 2;
    expect(curvaTotal(mitad)).toBe(VELOCIDAD_LEJOS);
    expect(curvaTotal(T_MAX)).toBe(VELOCIDAD_LEJOS);
  });

  test("al llegar a C1 y C4 frena a ×120", () => {
    expect(curvaTotal(contactosTotal.c1)).toBeCloseTo(
      VELOCIDAD_CONTACTO_PARCIAL,
      6,
    );
    expect(curvaTotal(contactosTotal.c4)).toBeCloseTo(
      VELOCIDAD_CONTACTO_PARCIAL,
      6,
    );
  });

  test("el último minuto antes de C2 (y el primero tras C3) ronda ×30", () => {
    const antesDeC2 = curvaTotal(contactosTotal.c2! - 60_000);
    const trasC3 = curvaTotal(contactosTotal.c3! + 60_000);
    for (const v of [antesDeC2, trasC3]) {
      expect(v).toBeGreaterThan(15);
      expect(v).toBeLessThan(60);
    }
  });

  test("ventana del anillo (±8 s de C2/C3) y Totalidad a ×5", () => {
    const { c2, c3, maximo } = contactosTotal;
    for (const t of [c2! - MARGEN_ANILLO_MS, c2!, maximo, c3!, c3! + MARGEN_ANILLO_MS]) {
      expect(curvaTotal(t)).toBe(VELOCIDAD_LENTA);
    }
  });

  test("monótona por tramos: frena hacia la ventana y acelera al salir", () => {
    const { c2, c3 } = contactosTotal;
    // Acercándose a C2 desde 4 min antes: no crece nunca.
    for (let t = c2! - 240_000; t < c2!; t += 1_000) {
      expect(curvaTotal(t + 1_000)).toBeLessThanOrEqual(curvaTotal(t) + 1e-9);
    }
    // Alejándose de C3 hasta 4 min después: no decrece nunca.
    for (let t = c3!; t < c3! + 240_000; t += 1_000) {
      expect(curvaTotal(t + 1_000)).toBeGreaterThanOrEqual(curvaTotal(t) - 1e-9);
    }
  });

  test("transiciones en rampa, sin escalones", () => {
    // Muestreada cada segundo simulado, la velocidad nunca cambia más de
    // un ~10 % entre muestras: rampas exponenciales, no saltos.
    for (let t = T_MIN; t < T_MAX; t += 1_000) {
      const a = curvaTotal(t);
      const b = curvaTotal(t + 1_000);
      expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(1.1);
    }
  });

  test("el resumen completo dura ~35–45 s con las horas reales", () => {
    const segundos = duracionResumenSegundos(contactosTotal, T_MIN, T_MAX);
    expect(segundos).toBeGreaterThan(35);
    expect(segundos).toBeLessThan(45);
  });
});

describe("curva del modo resumen (eclipse parcial)", () => {
  test("sin C2/C3 nunca hay cámara lenta ×5; el Máximo frena a ×15", () => {
    let minima = Infinity;
    for (let t = T_MIN; t <= T_MAX; t += 1_000) {
      minima = Math.min(minima, curvaParcial(t));
    }
    expect(minima).toBeCloseTo(VELOCIDAD_MAXIMO_PARCIAL, 6);
    expect(curvaParcial(contactosParcial.maximo)).toBeCloseTo(
      VELOCIDAD_MAXIMO_PARCIAL,
      6,
    );
  });

  test("el resumen parcial es aún más corto que el total", () => {
    const segundos = duracionResumenSegundos(contactosParcial, T_MIN, T_MAX);
    expect(segundos).toBeGreaterThan(10);
    expect(segundos).toBeLessThan(
      duracionResumenSegundos(contactosTotal, T_MIN, T_MAX),
    );
  });
});

describe("saltos a los Contactos", () => {
  test("eclipse total: los cinco botones, en orden", () => {
    const saltos = destinosSalto(contactosTotal, T_MIN, T_MAX);
    expect(saltos.map((s) => s.etiqueta)).toEqual([
      "C1",
      "C2",
      "Máx",
      "C3",
      "C4",
    ]);
  });

  test("eclipse parcial: sin C2/C3", () => {
    const saltos = destinosSalto(contactosParcial, T_MIN, T_MAX);
    expect(saltos.map((s) => s.etiqueta)).toEqual(["C1", "Máx", "C4"]);
  });

  test("cada salto aterriza un poco antes del Contacto, dentro del rango", () => {
    for (const salto of destinosSalto(contactosTotal, T_MIN, T_MAX)) {
      expect(salto.destino).toBe(salto.t - ANTICIPO_SALTO_MS);
      expect(salto.destino).toBeGreaterThanOrEqual(T_MIN);
      expect(salto.destino).toBeLessThanOrEqual(T_MAX);
    }
  });

  test("un Contacto pegado al arranque se recorta a tMin", () => {
    const contactos: ContactosMs = {
      c1: T_MIN + 2_000,
      c2: null,
      maximo: T_MIN + 3_600_000,
      c3: null,
      c4: T_MAX - 1_000,
    };
    const saltos = destinosSalto(contactos, T_MIN, T_MAX);
    expect(saltos[0]).toEqual({ etiqueta: "C1", t: T_MIN + 2_000, destino: T_MIN });
  });

  test("los Contactos fuera de la Línea de tiempo no generan botón", () => {
    const contactos: ContactosMs = {
      c1: T_MIN - 60_000, // antes del arranque: sin botón
      c2: null,
      maximo: T_MIN + 3_600_000,
      c3: null,
      c4: T_MAX + 60_000, // después del final: sin botón
    };
    expect(destinosSalto(contactos, T_MIN, T_MAX).map((s) => s.etiqueta)).toEqual([
      "Máx",
    ]);
  });
});
