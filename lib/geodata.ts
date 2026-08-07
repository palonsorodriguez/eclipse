/**
 * geodata — tipos y carga de los datos geográficos estáticos del eclipse
 * del 12-08-2026, generados por `scripts/build-geodata.ts` y servidos
 * desde `/geodata/` (carpeta `public/geodata/`, versionada en el repo).
 *
 * Los tres ficheros que consume la Vista Mapa:
 * - `banda-totalidad.geojson` — Franja de totalidad (límites norte/sur y
 *   línea central).
 * - `isolineas.geojson` — Isolíneas de Oscurecimiento máximo (regiones
 *   con Oscurecimiento ≥ nivel).
 * - `umbra.json` — centro y elipse aproximada de la umbra cada 30 s.
 */

import type { FeatureCollection, LineString, MultiPolygon, Position } from "geojson";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Cada una de las tres líneas de la Franja de totalidad. */
export type LimiteBanda = "norte" | "central" | "sur";

/**
 * `banda-totalidad.geojson`: tres LineString (norte, central, sur) con
 * coordenadas [lon, lat] ordenadas de oeste a este.
 */
export type BandaTotalidadGeoJSON = FeatureCollection<
  LineString,
  { limite: LimiteBanda }
>;

/**
 * `isolineas.geojson`: un MultiPolygon por nivel — la región donde el
 * Oscurecimiento máximo es ≥ `nivel` (0.8, 0.9, 0.95, 0.99).
 */
export type IsolineasGeoJSON = FeatureCollection<
  MultiPolygon,
  { nivel: number }
>;

/** La umbra en un instante: centro y elipse aproximada de su contorno. */
export interface InstanteUmbra {
  /** Instante UT en ISO 8601. */
  t: string;
  /** Centro de la umbra (donde el eje de la sombra corta el suelo). */
  centro: { lat: number; lon: number };
  /** Semieje mayor de la elipse aproximada, en km. */
  semiejeMayorKm: number;
  /** Semieje menor de la elipse aproximada, en km. */
  semiejeMenorKm: number;
  /**
   * Orientación del semieje mayor: rumbo en grados desde el norte,
   * en [0, 180).
   */
  orientacionGrados: number;
}

/** `umbra.json`: trayectoria de la umbra a intervalos regulares. */
export interface UmbraJSON {
  /** Descripción del método de cálculo (documentación embebida). */
  metodo: string;
  /** Instantes en los que la umbra toca la superficie, en orden temporal. */
  instantes: InstanteUmbra[];
  /**
   * Instantes de la ventana solicitada en los que la umbra no toca la
   * superficie con el Sol sobre el horizonte (ISO 8601).
   */
  instantesSinUmbra: string[];
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

async function cargarJSON<T>(ruta: string): Promise<T> {
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar ${ruta}: HTTP ${respuesta.status}`);
  }
  return (await respuesta.json()) as T;
}

/** Carga la Franja de totalidad desde `/geodata/banda-totalidad.geojson`. */
export function cargarBandaTotalidad(): Promise<BandaTotalidadGeoJSON> {
  return cargarJSON("/geodata/banda-totalidad.geojson");
}

/** Carga las Isolíneas de Oscurecimiento desde `/geodata/isolineas.geojson`. */
export function cargarIsolineas(): Promise<IsolineasGeoJSON> {
  return cargarJSON("/geodata/isolineas.geojson");
}

/** Carga la trayectoria de la umbra desde `/geodata/umbra.json`. */
export function cargarUmbra(): Promise<UmbraJSON> {
  return cargarJSON("/geodata/umbra.json");
}

// ---------------------------------------------------------------------------
// Geometría auxiliar
// ---------------------------------------------------------------------------

const RADIO_TIERRA_KM = 6371;
const DEG2RAD = Math.PI / 180;

/**
 * Distancia haversine en km entre dos puntos `[lon, lat]` (orden GeoJSON).
 */
export function distanciaKm(a: Position, b: Position): number {
  const [lonA, latA] = a;
  const [lonB, latB] = b;
  const dLat = (latB - latA) * DEG2RAD;
  const dLon = (lonB - lonA) * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * DEG2RAD) * Math.cos(latB * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h));
}

/**
 * ¿Está el punto `[lon, lat]` dentro del MultiPolygon? Ray casting sobre
 * cada polígono, respetando agujeros (anillos interiores). Suficiente
 * para las escalas de este proyecto (no cruza el antimeridiano).
 */
export function puntoEnMultiPolygon(
  punto: Position,
  multiPoligono: MultiPolygon,
): boolean {
  return multiPoligono.coordinates.some((poligono) => {
    const [exterior, ...agujeros] = poligono;
    return (
      puntoEnAnillo(punto, exterior) &&
      !agujeros.some((anillo) => puntoEnAnillo(punto, anillo))
    );
  });
}

function puntoEnAnillo(punto: Position, anillo: Position[]): boolean {
  const [x, y] = punto;
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
}
