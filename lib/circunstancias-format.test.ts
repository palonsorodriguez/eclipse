import { describe, expect, test } from "vitest";
import {
  cuentaAtrasHasta,
  formatDuracionTotalidad,
  formatPorcentaje,
  puntoCardinal,
} from "./circunstancias-format";

describe("formatDuracionTotalidad", () => {
  test("formatea minutos y segundos como m:ss", () => {
    expect(formatDuracionTotalidad(105)).toBe("1:45");
  });

  test("rellena los segundos con cero a la izquierda", () => {
    expect(formatDuracionTotalidad(62)).toBe("1:02");
  });

  test("redondea al segundo más cercano", () => {
    expect(formatDuracionTotalidad(89.6)).toBe("1:30");
  });

  test("duraciones menores de un minuto", () => {
    expect(formatDuracionTotalidad(42)).toBe("0:42");
  });
});

describe("puntoCardinal", () => {
  test("acimut del ocaso del eclipse (~285°) es ONO", () => {
    expect(puntoCardinal(285)).toBe("ONO");
  });

  test("puntos cardinales principales", () => {
    expect(puntoCardinal(0)).toBe("N");
    expect(puntoCardinal(90)).toBe("E");
    expect(puntoCardinal(180)).toBe("S");
    expect(puntoCardinal(270)).toBe("O");
  });

  test("redondea al rumbo más cercano y normaliza el círculo completo", () => {
    expect(puntoCardinal(354)).toBe("N");
    expect(puntoCardinal(360 + 45)).toBe("NE");
    expect(puntoCardinal(-90)).toBe("O");
  });
});

describe("formatPorcentaje", () => {
  test("usa coma decimal y un decimal", () => {
    expect(formatPorcentaje(0.924)).toBe("92,4%");
  });
});

describe("cuentaAtrasHasta", () => {
  test("desglosa el tiempo restante en días, horas, minutos y segundos", () => {
    const ahora = new Date("2026-08-08T10:00:00Z");
    const objetivo = new Date("2026-08-12T18:30:45Z");
    expect(cuentaAtrasHasta(objetivo, ahora)).toEqual({
      dias: 4,
      horas: 8,
      minutos: 30,
      segundos: 45,
    });
  });

  test("devuelve null cuando el instante ya pasó", () => {
    const ahora = new Date("2026-08-13T00:00:00Z");
    const objetivo = new Date("2026-08-12T18:30:00Z");
    expect(cuentaAtrasHasta(objetivo, ahora)).toBeNull();
  });
});
