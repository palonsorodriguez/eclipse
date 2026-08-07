/**
 * circunstancias-format — Formateo puro para el panel de circunstancias
 * locales: horas en hora peninsular (Europe/Madrid), duración de la
 * Totalidad, porcentajes a la española, puntos cardinales y cuenta atrás.
 *
 * Módulo puro (sin React, sin red): todo es determinista y testeable.
 */

/**
 * Nombres abreviados de los 16 puntos cardinales en español (O = oeste),
 * en orden horario empezando por el norte.
 */
const PUNTOS_CARDINALES = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSO",
  "SO",
  "OSO",
  "O",
  "ONO",
  "NO",
  "NNO",
] as const;

/**
 * Punto cardinal (rosa de 16 rumbos, abreviaturas en español) más cercano a
 * un acimut en grados (0 = norte, 90 = este). Acepta cualquier valor real y
 * lo normaliza a [0, 360).
 *
 * @example puntoCardinal(285) // "ONO"
 */
export function puntoCardinal(acimut: number): string {
  const normalizado = ((acimut % 360) + 360) % 360;
  const indice = Math.round(normalizado / 22.5) % 16;
  return PUNTOS_CARDINALES[indice]!;
}

/**
 * Duración de la Totalidad en formato m:ss a partir de segundos
 * (redondeando al segundo).
 *
 * @example formatDuracionTotalidad(105.4) // "1:45"
 */
export function formatDuracionTotalidad(segundos: number): string {
  const total = Math.round(segundos);
  const minutos = Math.floor(total / 60);
  const resto = total % 60;
  return `${minutos}:${String(resto).padStart(2, "0")}`;
}

/**
 * Oscurecimiento [0, 1] como porcentaje a la española con un decimal.
 *
 * @example formatPorcentaje(0.924) // "92,4%"
 */
export function formatPorcentaje(fraccion: number): string {
  return `${(fraccion * 100).toFixed(1).replace(".", ",")}%`;
}

/**
 * Hora local peninsular (Europe/Madrid, CEST en agosto) de un instante,
 * en formato HH:MM:SS de 24 horas.
 */
export function formatHoraLocal(instante: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(instante);
}

/** Desglose de una cuenta atrás en días, horas, minutos y segundos. */
export interface CuentaAtras {
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
}

/**
 * Desglosa el tiempo restante hasta `objetivo` desde `ahora` en
 * días/h/min/s, o `null` si el instante ya pasó.
 */
export function cuentaAtrasHasta(objetivo: Date, ahora: Date): CuentaAtras | null {
  const restanteMs = objetivo.getTime() - ahora.getTime();
  if (restanteMs <= 0) return null;
  const totalSegundos = Math.floor(restanteMs / 1000);
  return {
    dias: Math.floor(totalSegundos / 86400),
    horas: Math.floor((totalSegundos % 86400) / 3600),
    minutos: Math.floor((totalSegundos % 3600) / 60),
    segundos: totalSegundos % 60,
  };
}
