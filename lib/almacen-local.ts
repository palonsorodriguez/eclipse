/**
 * almacen-local — Lectura/escritura tolerante de `localStorage` para las
 * cachés persistentes de la app (issue #61).
 *
 * El relieve de un municipio no cambia: una vez medido, su perfil se guarda
 * sin caducidad y ni una petición más sale nunca hacia la API de elevación,
 * ni siquiera tras recargar. Este módulo es el único punto que toca
 * `localStorage`, y lo hace de forma tolerante:
 *
 * - SSR y tests (sin `localStorage`): no-op — leer devuelve `null`.
 * - Cuota llena o modo privado que lanza en `setItem`: se ignora (la caché
 *   persistente es una optimización, nunca un requisito).
 * - JSON corrupto en una clave: se devuelve `null` (como si no existiera).
 *
 * NOTA: la caché de elevación es de aplicación, no del service worker — el
 * SW no debe cachear `/v1/elevation` (ver `scripts/sw.template.js`).
 */

/** Lee y parsea una clave; `null` si no existe, no hay storage o está corrupta. */
export function leerAlmacen<T>(clave: string): T | null {
  try {
    const crudo = globalThis.localStorage?.getItem(clave);
    return crudo === null || crudo === undefined
      ? null
      : (JSON.parse(crudo) as T);
  } catch {
    return null;
  }
}

/** Serializa y guarda un valor; los fallos (cuota, SSR) se ignoran. */
export function guardarAlmacen(clave: string, valor: unknown): void {
  try {
    globalThis.localStorage?.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin storage o sin cuota: la caché persistente es solo una mejora.
  }
}
