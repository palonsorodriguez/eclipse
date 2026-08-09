import { describe, expect, test } from "vitest";
import {
  esperaReintentoSaturacion,
  transicionHorizonte,
  ESPERA_SATURACION_MAX_MS,
  ESPERA_SATURACION_MIN_MS,
  LIMITE_MIDIENDO_MS,
  type EstadoTarjetaHorizonte,
} from "./horizonte-estado";
import type { PerfilHorizonte } from "./horizonte";

const PERFIL: PerfilHorizonte = {
  elevacionObservador: 40,
  acimuts: [{ acimut: 285, angulo: 1.2, distanciaKm: 4.4, fraccionMar: 0 }],
};

const MIDIENDO: EstadoTarjetaHorizonte = { estado: "midiendo" };
const OK: EstadoTarjetaHorizonte = { estado: "ok", perfil: PERFIL };
const SATURADO: EstadoTarjetaHorizonte = { estado: "saturado" };
const ERROR: EstadoTarjetaHorizonte = { estado: "error" };

describe("transicionHorizonte", () => {
  test("midiendo + perfil → ok, con el perfil a mano para el veredicto", () => {
    const siguiente = transicionHorizonte(MIDIENDO, {
      tipo: "perfil",
      perfil: PERFIL,
    });
    expect(siguiente).toEqual({ estado: "ok", perfil: PERFIL });
  });

  test("midiendo + fallo por saturación → saturado (la API limita)", () => {
    expect(
      transicionHorizonte(MIDIENDO, { tipo: "fallo", saturado: true }),
    ).toEqual(SATURADO);
  });

  test("midiendo + fallo duro → error (mensaje suave, paisaje genérico)", () => {
    expect(
      transicionHorizonte(MIDIENDO, { tipo: "fallo", saturado: false }),
    ).toEqual(ERROR);
  });

  test("el límite de tiempo interrumpe la medición: midiendo → saturado", () => {
    // Nunca más un "midiendo…" infinito (QA del issue #61).
    expect(transicionHorizonte(MIDIENDO, { tipo: "tiempo-agotado" })).toEqual(
      SATURADO,
    );
  });

  test("un perfil tardío gana incluso tras agotar el tiempo (saturado → ok)", () => {
    const siguiente = transicionHorizonte(SATURADO, {
      tipo: "perfil",
      perfil: PERFIL,
    });
    expect(siguiente.estado).toBe("ok");
  });

  test("un fallo tardío no pisa un veredicto ya en pantalla (ok se queda)", () => {
    expect(
      transicionHorizonte(OK, { tipo: "fallo", saturado: true }),
    ).toBe(OK);
    expect(transicionHorizonte(OK, { tipo: "tiempo-agotado" })).toBe(OK);
  });

  test("el tiempo agotado no toca los estados que ya son finales", () => {
    expect(transicionHorizonte(ERROR, { tipo: "tiempo-agotado" })).toBe(ERROR);
    expect(transicionHorizonte(SATURADO, { tipo: "tiempo-agotado" })).toBe(
      SATURADO,
    );
  });

  test("medir reinicia la tarjeta desde cualquier estado (el reintento programado)", () => {
    expect(transicionHorizonte(SATURADO, { tipo: "medir" })).toEqual(MIDIENDO);
    expect(transicionHorizonte(ERROR, { tipo: "medir" })).toEqual(MIDIENDO);
  });

  test("ciclo completo del QA: midiendo → saturado (límite) → reintento → ok", () => {
    let estado: EstadoTarjetaHorizonte = MIDIENDO;
    estado = transicionHorizonte(estado, { tipo: "fallo", saturado: true });
    expect(estado).toEqual(SATURADO);
    estado = transicionHorizonte(estado, { tipo: "medir" });
    expect(estado).toEqual(MIDIENDO);
    estado = transicionHorizonte(estado, { tipo: "perfil", perfil: PERFIL });
    expect(estado.estado).toBe("ok");
  });
});

describe("esperaReintentoSaturacion", () => {
  test("cerca del cambio de hora apunta justo después del reinicio de la ventana", () => {
    // 14:58:00 UTC → 2 min hasta las 15:00 + margen de 10 s.
    const espera = esperaReintentoSaturacion(
      new Date("2026-08-12T14:58:00Z"),
    );
    expect(espera).toBe(2 * 60_000 + 10_000);
  });

  test("a mitad de hora no espera al reinicio: sondea cada pocos minutos", () => {
    const espera = esperaReintentoSaturacion(
      new Date("2026-08-12T14:10:00Z"),
    );
    expect(espera).toBe(ESPERA_SATURACION_MAX_MS);
  });

  test("nunca reintenta antes del minuto (la ventana del 429 no se ha reiniciado)", () => {
    const espera = esperaReintentoSaturacion(
      new Date("2026-08-12T14:59:58Z"),
    );
    expect(espera).toBe(ESPERA_SATURACION_MIN_MS);
  });

  test("el límite del 'midiendo…' es más corto que cualquier reintento", () => {
    // Sanidad de constantes: primero se avisa, después se reintenta.
    expect(LIMITE_MIDIENDO_MS).toBeLessThan(ESPERA_SATURACION_MIN_MS);
  });
});
