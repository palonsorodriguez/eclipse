import { describe, expect, it } from "vitest";
import {
  alfaContornoLunar,
  FUNDIDO_CONTORNO_MS,
  hintGafasVisible,
  hudActivoPorDefecto,
  marcasHorarias,
} from "./cielo-hud";

const C1 = Date.UTC(2026, 7, 12, 17, 34, 0);
const C4 = Date.UTC(2026, 7, 12, 19, 28, 0);
const C2 = Date.UTC(2026, 7, 12, 18, 27, 0);
const C3 = Date.UTC(2026, 7, 12, 18, 29, 0);

describe("alfaContornoLunar", () => {
  it("visible antes del eclipse y durante toda la parcialidad (#56)", () => {
    expect(alfaContornoLunar(C1 - 10 * 60_000, C2, C3)).toBe(1);
    expect(alfaContornoLunar(C1 + 60_000, C2, C3)).toBe(1); // parcialidad
    expect(alfaContornoLunar(C3 + 10 * 60_000, C2, C3)).toBe(1);
    expect(alfaContornoLunar(C4 + 10 * 60_000, C2, C3)).toBe(1);
  });

  it("se apaga solo en la Totalidad, con fundido suave en C2/C3", () => {
    expect(alfaContornoLunar((C2 + C3) / 2, C2, C3)).toBe(0);
    expect(alfaContornoLunar(C2, C2, C3)).toBe(0);
    expect(alfaContornoLunar(C2 - FUNDIDO_CONTORNO_MS / 2, C2, C3)).toBeCloseTo(0.5);
    expect(alfaContornoLunar(C3 + FUNDIDO_CONTORNO_MS / 2, C2, C3)).toBeCloseTo(0.5);
  });

  it("sin Totalidad local (eclipse parcial) nunca se apaga", () => {
    expect(alfaContornoLunar((C1 + C4) / 2, null, null)).toBe(1);
  });
});

describe("hintGafasVisible", () => {
  it("aparece solo en la parcialidad apreciable (5–95%)", () => {
    expect(hintGafasVisible(0, false)).toBe(false);
    expect(hintGafasVisible(0.02, false)).toBe(false);
    expect(hintGafasVisible(0.05, false)).toBe(true);
    expect(hintGafasVisible(0.5, false)).toBe(true);
    expect(hintGafasVisible(0.95, false)).toBe(true);
    expect(hintGafasVisible(0.97, false)).toBe(false);
    expect(hintGafasVisible(1, false)).toBe(false); // Totalidad
  });

  it("con las gafas puestas no hace falta el hint", () => {
    expect(hintGafasVisible(0.5, true)).toBe(false);
  });
});

describe("hudActivoPorDefecto", () => {
  it("activo fuera del eclipse, apagado dentro", () => {
    expect(hudActivoPorDefecto(C1 - 1000, C1, C4)).toBe(true);
    expect(hudActivoPorDefecto((C1 + C4) / 2, C1, C4)).toBe(false);
    expect(hudActivoPorDefecto(C4 + 1000, C1, C4)).toBe(true);
  });
});

describe("marcasHorarias", () => {
  it("la ventana 19:15–21:30 CEST con paso de 1 h da las 20:00 y las 21:00", () => {
    const tMin = Date.UTC(2026, 7, 12, 17, 15, 0);
    const tMax = Date.UTC(2026, 7, 12, 19, 30, 0);
    const marcas = marcasHorarias(tMin, tMax, 3_600_000);
    expect(marcas).toEqual([
      Date.UTC(2026, 7, 12, 18, 0, 0), // 20:00 CEST
      Date.UTC(2026, 7, 12, 19, 0, 0), // 21:00 CEST
    ]);
  });

  it("incluye los extremos cuando caen en un múltiplo exacto", () => {
    expect(marcasHorarias(0, 7_200_000, 3_600_000)).toEqual([
      0, 3_600_000, 7_200_000,
    ]);
  });
});
