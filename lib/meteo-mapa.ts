/**
 * meteo-mapa — capa de nubes por zonas para la Vista Mapa: previsión de
 * nubosidad de Open-Meteo sobre una rejilla gruesa de puntos que cubre la
 * Franja de totalidad más un margen, para la ventana del eclipse del
 * 12-08-2026 ("si Ferrol amanece cubierto, ¿hacia dónde conduzco?").
 *
 * Separación igual que en `lib/meteo.ts` (el panel del Observador, que no
 * se toca): lógica pura testeable sin mocks (muestreo de puntos,
 * clasificación por color, agrupación de peticiones) y acceso de red
 * mockeable en el límite del sistema (global fetch).
 *
 * Open-Meteo admite múltiples coordenadas por petición con listas
 * separadas por comas (`latitude=a,b,c&longitude=x,y,z`) y responde con un
 * array JSON en el mismo orden — verificado contra la API real con 60
 * puntos en una sola petición. Aun así las peticiones se agrupan en lotes
 * de como mucho {@link MAX_COORDS_POR_PETICION} coordenadas.
 */

import type { Position } from "geojson";
import type { BandaTotalidadGeoJSON } from "./geodata";
import { lineaBanda } from "./mapa";
import { FECHA_ECLIPSE } from "./meteo";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Un punto de la rejilla de muestreo. */
export interface Coordenada {
  lat: number;
  lon: number;
}

/** Previsión de nubosidad para un punto de la rejilla. */
export interface PuntoNube extends Coordenada {
  /** Nubosidad total media de la ventana del eclipse, en % [0, 100]. */
  nubosidadMedia: number;
}

/** Categoría de color de la capa de nubes, de mejor a peor pronóstico. */
export type ColorNube = "verde" | "amarillo" | "gris";

// ---------------------------------------------------------------------------
// Clasificación por color (lógica pura)
// ---------------------------------------------------------------------------

/**
 * Clasifica la nubosidad media de un punto en el color de su celda:
 * verde < 25 %, amarillo 25–60 %, gris > 60 %. Mismos umbrales que el
 * veredicto del panel (`lib/meteo.ts`).
 */
export function clasificarColorNube(nubosidadMedia: number): ColorNube {
  if (nubosidadMedia < 25) return "verde";
  if (nubosidadMedia <= 60) return "amarillo";
  return "gris";
}

// ---------------------------------------------------------------------------
// Muestreo de la rejilla (lógica pura)
// ---------------------------------------------------------------------------

/**
 * Tramo de longitudes muestreado: la parte de la Franja de totalidad que
 * cruza España, de la costa gallega (~−9,3°) a Baleares (~4,3°). La banda
 * generada llega hasta −12° por el Atlántico, pero allí no se conduce.
 */
const LON_OESTE = -9.3;
const LON_ESTE = 4.3;

/** Columnas de la rejilla a lo largo de la banda. */
const N_COLUMNAS = 11;

/**
 * Margen fuera de la banda, en grados de latitud (~65 km): una fila de
 * puntos al norte del límite norte y otra al sur del límite sur, para ver
 * el pronóstico también "cerca" de la franja.
 */
const MARGEN_GRADOS = 0.6;

/** Latitud de la línea en la longitud `lon`, interpolando linealmente. */
function latEnLon(coordenadas: Position[], lon: number): number {
  const primera = coordenadas[0];
  if (lon <= primera[0]) return primera[1];
  for (let i = 1; i < coordenadas.length; i++) {
    const [x1, y1] = coordenadas[i];
    if (x1 >= lon) {
      const [x0, y0] = coordenadas[i - 1];
      const f = x1 === x0 ? 0 : (lon - x0) / (x1 - x0);
      return y0 + f * (y1 - y0);
    }
  }
  return coordenadas[coordenadas.length - 1][1];
}

/**
 * Rejilla gruesa de muestreo sobre la Franja de totalidad y su margen:
 * {@link N_COLUMNAS} columnas equiespaciadas en longitud entre
 * {@link LON_OESTE} y {@link LON_ESTE}, y en cada columna cinco filas —
 * margen norte (fuera), mitad norte de la banda, línea central, mitad sur
 * de la banda y margen sur (fuera) — interpoladas sobre las tres líneas
 * de la banda (55 puntos en total).
 *
 * @param banda - La Franja de totalidad de `lib/geodata.ts`.
 */
export function puntosMuestreo(banda: BandaTotalidadGeoJSON): Coordenada[] {
  const norte = lineaBanda(banda, "norte").geometry.coordinates;
  const central = lineaBanda(banda, "central").geometry.coordinates;
  const sur = lineaBanda(banda, "sur").geometry.coordinates;

  const puntos: Coordenada[] = [];
  const paso = (LON_ESTE - LON_OESTE) / (N_COLUMNAS - 1);
  for (let i = 0; i < N_COLUMNAS; i++) {
    const lon = LON_OESTE + i * paso;
    const latNorte = latEnLon(norte, lon);
    const latSur = latEnLon(sur, lon);
    for (const lat of [
      latNorte + MARGEN_GRADOS,
      latSur + 0.9 * (latNorte - latSur),
      latEnLon(central, lon),
      latSur + 0.1 * (latNorte - latSur),
      latSur - MARGEN_GRADOS,
    ]) {
      puntos.push({ lat, lon });
    }
  }
  return puntos;
}

// ---------------------------------------------------------------------------
// Agrupación de peticiones (lógica pura)
// ---------------------------------------------------------------------------

/**
 * Máximo de coordenadas por petición a Open-Meteo. La API acepta listas
 * separadas por comas de hasta ~100 posiciones; con la rejilla de 55
 * puntos toda la capa cabe en una sola petición.
 */
export const MAX_COORDS_POR_PETICION = 100;

/**
 * Parte `elementos` en grupos consecutivos de como mucho `maxPorGrupo`,
 * conservando el orden. Con ella la capa hace 1 petición para 55 puntos
 * en vez de 55 peticiones de 1 punto.
 */
export function agruparCoordenadas<T>(
  elementos: readonly T[],
  maxPorGrupo: number,
): T[][] {
  if (maxPorGrupo < 1) {
    throw new Error("agruparCoordenadas necesita maxPorGrupo >= 1");
  }
  const grupos: T[][] = [];
  for (let i = 0; i < elementos.length; i += maxPorGrupo) {
    grupos.push(elementos.slice(i, i + maxPorGrupo));
  }
  return grupos;
}

// ---------------------------------------------------------------------------
// Acceso de red (fetch global, mockeable en tests)
// ---------------------------------------------------------------------------

/**
 * Horas locales (Europe/Madrid) cuya nubosidad se promedia por punto:
 * los valores horarios de Open-Meteo que cubren la ventana 19:30–21:30
 * del 12-08-2026 (parcialidad, totalidad ~20:20–20:34 y ocaso).
 */
export const HORAS_VENTANA_MAPA = ["19:00", "20:00", "21:00"] as const;

/**
 * URL de la petición a Open-Meteo para un grupo de puntos: nubosidad
 * total horaria del 12-08-2026 en hora local Europe/Madrid, con las
 * coordenadas como listas separadas por comas. Sin clave API.
 */
export function urlNubesFranja(puntos: readonly Coordenada[]): string {
  const params = new URLSearchParams({
    latitude: puntos.map((p) => p.lat.toFixed(4)).join(","),
    longitude: puntos.map((p) => p.lon.toFixed(4)).join(","),
    hourly: "cloud_cover",
    timezone: "Europe/Madrid",
    start_date: FECHA_ECLIPSE,
    end_date: FECHA_ECLIPSE,
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

/** Respuesta cruda de Open-Meteo por punto (subconjunto que interesa). */
interface RespuestaPunto {
  hourly?: {
    time?: string[];
    cloud_cover?: number[];
  };
}

/** Nubosidad media de la ventana del eclipse a partir del bloque horario. */
function mediaVentana(hourly: RespuestaPunto["hourly"]): number {
  const tiempos = hourly?.time;
  const nubosidad = hourly?.cloud_cover;
  if (!tiempos || !nubosidad) {
    throw new Error("Respuesta de Open-Meteo sin datos horarios de nubosidad");
  }
  let suma = 0;
  for (const hora of HORAS_VENTANA_MAPA) {
    const indice = tiempos.indexOf(`${FECHA_ECLIPSE}T${hora}`);
    if (indice === -1 || nubosidad[indice] === undefined) {
      throw new Error(
        `Open-Meteo no devolvió la nubosidad de las ${hora} del ${FECHA_ECLIPSE}`,
      );
    }
    suma += nubosidad[indice];
  }
  return suma / HORAS_VENTANA_MAPA.length;
}

/** Descarga y parsea la previsión de un grupo (≤ 100 coordenadas). */
async function fetchGrupo(
  puntos: readonly Coordenada[],
): Promise<PuntoNube[]> {
  const respuesta = await fetch(urlNubesFranja(puntos));
  if (!respuesta.ok) {
    throw new Error(`Open-Meteo respondió ${respuesta.status}`);
  }
  const datos = (await respuesta.json()) as RespuestaPunto | RespuestaPunto[];
  // Con varias coordenadas la API devuelve un array en el mismo orden de
  // la petición; con una sola, el objeto suelto.
  const lista = Array.isArray(datos) ? datos : [datos];
  if (lista.length !== puntos.length) {
    throw new Error(
      `Open-Meteo devolvió ${lista.length} previsiones para ${puntos.length} puntos`,
    );
  }
  return lista.map((punto, i) => ({
    lat: puntos[i].lat,
    lon: puntos[i].lon,
    nubosidadMedia: mediaVentana(punto.hourly),
  }));
}

/**
 * Descarga de Open-Meteo la nubosidad media de la ventana del eclipse
 * para cada punto, agrupando las coordenadas en el mínimo de peticiones
 * (lotes de {@link MAX_COORDS_POR_PETICION}). Devuelve los puntos en el
 * mismo orden de entrada.
 *
 * Lanza `Error` si la red falla, alguna respuesta no es 2xx o el cuerpo
 * no trae las horas esperadas; el llamante decide cómo degradar.
 */
export async function fetchNubesFranja(
  puntos: readonly Coordenada[],
): Promise<PuntoNube[]> {
  const grupos = agruparCoordenadas(puntos, MAX_COORDS_POR_PETICION);
  const resultados = await Promise.all(grupos.map(fetchGrupo));
  return resultados.flat();
}

// ---------------------------------------------------------------------------
// Caché en memoria (30 min)
// ---------------------------------------------------------------------------

/** Vida de la caché de la capa de nubes: 30 minutos. */
export const CADUCIDAD_CACHE_MS = 30 * 60_000;

let cacheNubes: { puntos: PuntoNube[]; expira: number } | null = null;

/**
 * La previsión de nubes de toda la franja, con caché en memoria de
 * {@link CADUCIDAD_CACHE_MS}: la Vista Mapa la pide cada vez que se
 * activa el toggle, pero solo se vuelve a la red cuando la caché caduca.
 * Los fallos no se cachean.
 */
export async function obtenerNubesFranja(
  banda: BandaTotalidadGeoJSON,
): Promise<PuntoNube[]> {
  const ahora = Date.now();
  if (cacheNubes && ahora < cacheNubes.expira) return cacheNubes.puntos;
  const puntos = await fetchNubesFranja(puntosMuestreo(banda));
  cacheNubes = { puntos, expira: ahora + CADUCIDAD_CACHE_MS };
  return puntos;
}

/** Vacía la caché (para tests). */
export function limpiarCacheNubes(): void {
  cacheNubes = null;
}
