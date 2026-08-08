import { describe, expect, it } from "vitest";
import {
  alfaLunaFantasma,
  FUNDIDO_FANTASMA_MS,
  hudActivoPorDefecto,
  marcasHorarias,
} from "./cielo-hud";

const C1 = Date.UTC(2026, 7, 12, 17, 34, 0);
const C4 = Date.UTC(2026, 7, 12, 19, 28, 0);

describe("alfaLunaFantasma", () => {
  it("plena lejos del eclipse, invisible durante C1–C4", () => {
    expect(alfaLunaFantasma(C1 - 10 * 60_000, C1, C4)).toBe(1);
    expect(alfaLunaFantasma(C1 + 1, C1, C4)).toBe(0);
    expect(alfaLunaFantasma((C1 + C4) / 2, C1, C4)).toBe(0);
    expect(alfaLunaFantasma(C4 + 10 * 60_000, C1, C4)).toBe(1);
  });

  it("se funde suavemente pegada a C1 y reaparece tras C4 (sin pop)", () => {
    expect(alfaLunaFantasma(C1 - FUNDIDO_FANTASMA_MS / 2, C1, C4)).toBeCloseTo(0.5);
    expect(alfaLunaFantasma(C4 + FUNDIDO_FANTASMA_MS / 2, C1, C4)).toBeCloseTo(0.5);
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
