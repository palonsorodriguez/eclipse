/**
 * horizonte-estado — Estados honestos de la tarjeta "¿Me tapará el monte?"
 * (issue #61).
 *
 * QA en producción: la API de elevación se satura ("Hourly API request
 * limit exceeded") y la tarjeta se quedaba en "Midiendo el relieve…" para
 * siempre — el usuario creía que la detección mar/montaña no existía. Esta
 * máquina de estados pura pone palabras a lo que pasa de verdad:
 *
 * - `midiendo`: petición en vuelo, con límite de tiempo
 *   ({@link LIMITE_MIDIENDO_MS}) — nunca un "midiendo…" infinito.
 * - `ok`: perfil medido, veredicto en pantalla. Un éxito tardío (la
 *   promesa seguía viva tras agotar el límite de tiempo) siempre gana.
 * - `saturado`: la API limita (429 por minuto u "Hourly limit" con HTTP
 *   200, ver `ErrorSaturacionElevacion` en `lib/horizonte.ts`) o la
 *   medición agotó su límite de tiempo (la causa realista de una espera
 *   tan larga son los reintentos del propio límite). La tarjeta lo dice
 *   claro y programa un reintento automático en la ventana del límite
 *   ({@link esperaReintentoSaturacion}).
 * - `error`: fallo definitivo (sin red, respuesta rota) — mensaje suave;
 *   el render mantiene el paisaje genérico (ya lo hacía).
 *
 * La transición es pura y testeable; el componente solo despacha eventos
 * (respuesta de red, temporizadores) y pinta el estado.
 */

import type { PerfilHorizonte } from "./horizonte";

/** Tiempo máximo (ms) mostrando "midiendo…" antes de pasar a `saturado`. */
export const LIMITE_MIDIENDO_MS = 15_000;

/**
 * Espera mínima (ms) antes del reintento automático tras una saturación:
 * por debajo de un minuto ni siquiera se ha reiniciado la ventana del 429.
 */
export const ESPERA_SATURACION_MIN_MS = 60_000;

/**
 * Espera máxima (ms) antes del reintento automático: aunque el límite
 * horario tarde más en reiniciarse, reintentar cada pocos minutos cuesta
 * una sola petición y recupera el veredicto en cuanto la API respira —
 * "en unos minutos", como promete la tarjeta.
 */
export const ESPERA_SATURACION_MAX_MS = 5 * 60_000;

/** Margen (ms) tras el reinicio de la ventana horaria antes de reintentar. */
const MARGEN_VENTANA_MS = 10_000;

/** Estado de la tarjeta del horizonte. */
export type EstadoTarjetaHorizonte =
  | { estado: "midiendo" }
  | { estado: "ok"; perfil: PerfilHorizonte }
  | { estado: "saturado" }
  | { estado: "error" };

/** Evento que hace avanzar la tarjeta. */
export type EventoHorizonte =
  /** Empieza (o vuelve a empezar) una medición. */
  | { tipo: "medir" }
  /** El perfil llegó — aunque sea tarde, el veredicto siempre gana. */
  | { tipo: "perfil"; perfil: PerfilHorizonte }
  /** La petición falló; `saturado` distingue límite de la API de fallo duro. */
  | { tipo: "fallo"; saturado: boolean }
  /** La medición agotó {@link LIMITE_MIDIENDO_MS} sin respuesta. */
  | { tipo: "tiempo-agotado" };

/**
 * Transición de la tarjeta: estado siguiente a partir del actual y un
 * evento. Reglas no obvias:
 *
 * - `perfil` gana siempre: si el límite de tiempo ya la puso en `saturado`
 *   pero la promesa original acaba resolviendo, el veredicto se muestra.
 * - `fallo` y `tiempo-agotado` nunca pisan un `ok`: un veredicto en
 *   pantalla no se borra por el eco tardío de una petición vieja.
 * - `tiempo-agotado` solo interrumpe `midiendo` → `saturado`: la espera
 *   larga realista es el propio límite de la API (sus reintentos de 30 s);
 *   el reintento programado también rescata a una red simplemente lenta.
 */
export function transicionHorizonte(
  estado: EstadoTarjetaHorizonte,
  evento: EventoHorizonte,
): EstadoTarjetaHorizonte {
  switch (evento.tipo) {
    case "medir":
      return { estado: "midiendo" };
    case "perfil":
      return { estado: "ok", perfil: evento.perfil };
    case "fallo":
      if (estado.estado === "ok") return estado;
      return evento.saturado ? { estado: "saturado" } : { estado: "error" };
    case "tiempo-agotado":
      return estado.estado === "midiendo" ? { estado: "saturado" } : estado;
  }
}

/**
 * Espera (ms) hasta el reintento automático tras una saturación,
 * respetando la ventana horaria del límite: apunta a justo después del
 * próximo cambio de hora (los cupos horarios de Open-Meteo se reinician
 * ahí), recortada al rango [{@link ESPERA_SATURACION_MIN_MS},
 * {@link ESPERA_SATURACION_MAX_MS}] — a las 14:58 espera al reinicio de
 * las 15:00; a las 14:10 no espera 50 minutos: sondea cada 5.
 */
export function esperaReintentoSaturacion(ahora: Date): number {
  const HORA_MS = 3_600_000;
  const hastaProximaHora =
    HORA_MS - (ahora.getTime() % HORA_MS) + MARGEN_VENTANA_MS;
  return Math.min(
    Math.max(hastaProximaHora, ESPERA_SATURACION_MIN_MS),
    ESPERA_SATURACION_MAX_MS,
  );
}
