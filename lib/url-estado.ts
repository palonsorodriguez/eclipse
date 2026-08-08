/**
 * url-estado — el estado compartible de la app en la URL (#42).
 *
 * Formato: `?m=<municipio-slug>&t=<HHMMSS>` — p. ej. `?m=ferrol&t=202757`
 * aterriza en Ferrol a las 20:27:57 (hora peninsular, CEST).
 *
 * - `m`: slug del nombre del Municipio, normalizado (minúsculas, sin
 *   acentos, espacios → guiones). Se resuelve contra el Nomenclátor de
 *   `lib/municipios`; ante nombres duplicados gana la primera entrada
 *   del dataset.
 * - `t`: hora local peninsular `HHMMSS`. El eclipse cae en pleno CEST
 *   (UT+2), así que la conversión a ms de época es un desplazamiento
 *   fijo sobre la fecha del eclipse (12-08-2026).
 *
 * Este módulo es puro (sin React ni `window`): quien lee/escribe la URL
 * real es `app/page.tsx`. OJO: no importa `lib/municipios` (su JSON de
 * ~620 KB no debe entrar en el bundle inicial); el llamante pasa la lista
 * ya cargada con `import()` dinámico.
 */

import type { Municipio } from "@/lib/municipios";

/** Fecha del eclipse (UTC) y desfase CEST (UT+2) de la hora peninsular. */
const ANO = 2026;
const MES_INDICE = 7; // agosto
const DIA = 12;
const DESFASE_CEST_HORAS = 2;

/**
 * Slug de un nombre de municipio: minúsculas, sin diacríticos, cualquier
 * tramo no alfanumérico → un guion. "A Coruña" → "a-coruna",
 * "Alcalá de Henares" → "alcala-de-henares".
 */
export function slugMunicipio(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resuelve un slug contra el Nomenclátor. Devuelve la primera entrada
 * cuyo nombre produce ese slug, o `null` si no hay ninguna.
 */
export function municipioPorSlug(
  slug: string,
  municipios: readonly Municipio[],
): Municipio | null {
  for (const municipio of municipios) {
    if (slugMunicipio(municipio.nombre) === slug) return municipio;
  }
  return null;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Instante simulado (ms de época) → parámetro `t` en hora peninsular:
 * `Date.UTC(2026, 7, 12, 18, 27, 57)` → "202757".
 */
export function formatearT(t: number): string {
  const fecha = new Date(t);
  const horas = (fecha.getUTCHours() + DESFASE_CEST_HORAS) % 24;
  return `${pad2(horas)}${pad2(fecha.getUTCMinutes())}${pad2(fecha.getUTCSeconds())}`;
}

/**
 * Parámetro `t` (`HHMMSS`, hora peninsular) → ms de época sobre la fecha
 * del eclipse, o `null` si no es una hora válida. No recorta al rango de
 * la Línea de tiempo: de eso se encarga `saltarA` del reloj.
 */
export function parsearT(parametro: string): number | null {
  if (!/^\d{6}$/.test(parametro)) return null;
  const horas = Number(parametro.slice(0, 2));
  const minutos = Number(parametro.slice(2, 4));
  const segundos = Number(parametro.slice(4, 6));
  if (horas > 23 || minutos > 59 || segundos > 59) return null;
  return Date.UTC(
    ANO,
    MES_INDICE,
    DIA,
    horas - DESFASE_CEST_HORAS,
    minutos,
    segundos,
  );
}

/** Estado compartible leído de (o destinado a) la URL. */
export interface EstadoUrl {
  /** Slug del Municipio, o `null` si la URL no lo trae. */
  slug: string | null;
  /** Instante simulado en ms de época, o `null` si falta o es inválido. */
  t: number | null;
}

/**
 * Lee `?m=…&t=…` de una query string (con o sin `?`). Parámetros ausentes
 * o inválidos → `null`, sin lanzar nunca: una URL manipulada degrada a la
 * pantalla inicial.
 */
export function leerEstado(search: string): EstadoUrl {
  const parametros = new URLSearchParams(search);
  const slug = parametros.get("m");
  const parametroT = parametros.get("t");
  return {
    slug: slug ? slug : null,
    t: parametroT === null ? null : parsearT(parametroT),
  };
}

/**
 * Query string (`?m=…&t=…`) para el estado dado, o `""` si no hay nada
 * que compartir. Pensada para `history.replaceState`.
 */
export function construirQuery(estado: {
  municipio: Pick<Municipio, "nombre"> | null;
  t: number | null;
}): string {
  const parametros = new URLSearchParams();
  if (estado.municipio) parametros.set("m", slugMunicipio(estado.municipio.nombre));
  if (estado.t !== null) parametros.set("t", formatearT(estado.t));
  const query = parametros.toString();
  return query === "" ? "" : `?${query}`;
}
