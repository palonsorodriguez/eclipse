/**
 * mapa — helpers puros para la Vista Mapa (MapLibre GL).
 *
 * Módulo sin React ni MapLibre: geometría y datos que el componente
 * `app/components/VistaMapa.tsx` convierte en capas del mapa.
 *
 * - Banda: polígono relleno de la Franja de totalidad a partir de sus
 *   límites norte/sur, y acceso a cada línea.
 * - Isolíneas: selección por nivel y punto de anclaje de la etiqueta.
 * - Umbra: interpolación entre los instantes de `umbra.json` (lerp del
 *   centro y de cada radio del contorno) y reconstrucción del polígono
 *   real con `destino(centro, rumbo_i, radio_i)`.
 * - Isolínea en vivo: rejilla gruesa de Oscurecimiento máximo calculada al
 *   vuelo con `lib/eclipse-engine` (memoizada por quien la usa) y contorno
 *   a cualquier nivel con d3-contour — la misma técnica que
 *   `scripts/build-geodata.ts`, con paso mayor para que quepa en el
 *   navegador (~4.000 puntos, ~2 s repartidos en trozos).
 * - Observador: municipio más cercano a un clic en el mapa.
 */

import { contours } from "d3-contour";
import type {
  Feature,
  LineString,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import { oscurecimientoInstantaneo } from "./eclipse-engine";
import {
  destino,
  distanciaKm,
  puntoEnMultiPolygon,
  rumboUmbra,
  type BandaTotalidadGeoJSON,
  type InstanteUmbra,
  type IsolineasGeoJSON,
  type LimiteBanda,
} from "./geodata";
import type { Municipio } from "./municipios";

// ---------------------------------------------------------------------------
// Banda de totalidad
// ---------------------------------------------------------------------------

/** La línea `limite` de la banda. Lanza si el GeoJSON no la trae. */
export function lineaBanda(
  banda: BandaTotalidadGeoJSON,
  limite: LimiteBanda,
): Feature<LineString, { limite: LimiteBanda }> {
  const feature = banda.features.find((f) => f.properties.limite === limite);
  if (!feature) {
    throw new Error(`Falta la línea "${limite}" en banda-totalidad.geojson`);
  }
  return feature;
}

/**
 * Polígono relleno de la Franja de totalidad: anillo formado por el límite
 * norte (oeste → este) y el límite sur recorrido al revés (este → oeste).
 */
export function poligonoBanda(banda: BandaTotalidadGeoJSON): Polygon {
  const norte = lineaBanda(banda, "norte").geometry.coordinates;
  const sur = lineaBanda(banda, "sur").geometry.coordinates;
  const anillo = [...norte, ...[...sur].reverse(), norte[0]];
  return { type: "Polygon", coordinates: [anillo] };
}

// ---------------------------------------------------------------------------
// Isolíneas precalculadas
// ---------------------------------------------------------------------------

/** La Isolínea precalculada de `nivel` exacto (0.8, 0.9, …), si existe. */
export function seleccionarIsolinea(
  isolineas: IsolineasGeoJSON,
  nivel: number,
): Feature<MultiPolygon, { nivel: number }> | undefined {
  return isolineas.features.find((f) => f.properties.nivel === nivel);
}

/**
 * Punto de anclaje para etiquetar una Isolínea: el vértice más meridional
 * de su anillo exterior más largo. Como las regiones de distinto nivel
 * están anidadas, los puntos quedan escalonados hacia el sur y las
 * etiquetas no se pisan. `undefined` si la geometría está vacía.
 */
export function puntoEtiquetaIsolinea(
  multiPoligono: MultiPolygon,
): Position | undefined {
  let mayor: Position[] | undefined;
  for (const poligono of multiPoligono.coordinates) {
    const exterior = poligono[0];
    if (exterior && (!mayor || exterior.length > mayor.length)) {
      mayor = exterior;
    }
  }
  if (!mayor || mayor.length === 0) return undefined;
  return mayor.reduce((sur, p) => (p[1] < sur[1] ? p : sur));
}

// ---------------------------------------------------------------------------
// Umbra
// ---------------------------------------------------------------------------

/**
 * La umbra en el instante `t`, interpolando linealmente el centro y cada
 * radio del contorno (`radiosKm[i]`, mismo índice de rumbo en ambos
 * extremos) entre los dos instantes de `umbra.json` que lo encierran.
 * `null` si `t` cae fuera de la ventana con umbra (antes del primer
 * instante o después del último): la Vista Mapa no la dibuja entonces.
 *
 * @param instantes - `UmbraJSON.instantes`, en orden temporal.
 */
export function interpolarUmbra(
  instantes: readonly InstanteUmbra[],
  t: Date,
): InstanteUmbra | null {
  if (instantes.length === 0) return null;
  const tMs = t.getTime();
  const tiempos = instantes.map((i) => new Date(i.t).getTime());
  if (tMs < tiempos[0] || tMs > tiempos[tiempos.length - 1]) return null;

  let i = 0;
  while (i < tiempos.length - 2 && tiempos[i + 1] < tMs) i++;
  const a = instantes[i];
  const b = instantes[Math.min(i + 1, instantes.length - 1)];
  const dt = tiempos[i + 1] - tiempos[i];
  const f = dt > 0 ? (tMs - tiempos[i]) / dt : 0;

  const lerp = (x: number, y: number): number => x + f * (y - x);
  return {
    t: t.toISOString(),
    centro: {
      lat: lerp(a.centro.lat, b.centro.lat),
      lon: lerp(a.centro.lon, b.centro.lon),
    },
    radiosKm: a.radiosKm.map((radio, k) => lerp(radio, b.radiosKm[k])),
  };
}

/**
 * Contorno real de la umbra como polígono GeoJSON: un vértice por rumbo,
 * `destino(centro, rumbo_i, radio_i)` por gran círculo — la misma fórmula
 * con la que el generador midió los radios, así los vértices caen sobre
 * el borde exacto de la Totalidad (lágrima incluida, sin modelo de
 * elipse).
 *
 * @param umbra - Instante (real o interpolado) a convertir.
 * @param escala - Factor sobre los radios: 1 es el contorno tal cual;
 *   valores mayores generan el halo del borde difuso.
 */
export function contornoUmbra(umbra: InstanteUmbra, escala = 1): Polygon {
  const { centro, radiosKm } = umbra;
  const anillo: Position[] = radiosKm.map((radio, i) => {
    const p = destino(centro.lat, centro.lon, rumboUmbra(i), radio * escala);
    return [p.lon, p.lat];
  });
  anillo.push(anillo[0]);
  return { type: "Polygon", coordinates: [anillo] };
}

/** Trayectoria de la umbra: línea que une los centros de sus instantes. */
export function trayectoriaUmbra(
  instantes: readonly InstanteUmbra[],
): LineString {
  return {
    type: "LineString",
    coordinates: instantes.map((i) => [i.centro.lon, i.centro.lat]),
  };
}

/**
 * ¿Cae el punto `[lon, lat]` dentro del contorno de la umbra? Ray casting
 * sobre el polígono de {@link contornoUmbra} (reutiliza el mismo
 * `puntoEnMultiPolygon` de `lib/geodata.ts` que usan las isolíneas).
 */
export function puntoEnUmbra(
  umbra: InstanteUmbra,
  punto: Position,
): boolean {
  const poligono = contornoUmbra(umbra);
  return puntoEnMultiPolygon(punto, {
    type: "MultiPolygon",
    coordinates: [poligono.coordinates],
  });
}

/**
 * Instante (ms de época) en que el contorno de la umbra toca por primera
 * vez el punto `[lon, lat]`, o `null` si no lo toca en toda la serie.
 * Se evalúa sobre los instantes tabulados (paso 30 s): resolución de
 * sobra para el "llega HH:MM" del indicador de borde de la Vista Mapa.
 */
export function llegadaUmbra(
  instantes: readonly InstanteUmbra[],
  punto: Position,
): number | null {
  for (const instante of instantes) {
    if (puntoEnUmbra(instante, punto)) return new Date(instante.t).getTime();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Isolínea en vivo: rejilla de Oscurecimiento máximo + contorno d3
// ---------------------------------------------------------------------------

/**
 * Rejilla regular de Oscurecimiento máximo sobre península + Baleares,
 * en orden fila a fila desde el suroeste (mismo convenio que
 * `scripts/build-geodata.ts`): `valores[j * nx + i]` es el punto
 * (latMin + j·paso, lonMin + i·paso).
 */
export interface RejillaOscurecimiento {
  lonMin: number;
  latMin: number;
  paso: number;
  nx: number;
  ny: number;
  valores: Float64Array;
}

/** Dominio de la rejilla en vivo (el de las isolíneas precalculadas). */
export const REJILLA_VIVA = {
  lonMin: -10,
  lonMax: 5,
  latMin: 35,
  latMax: 45,
  /** 0,2° ≈ 20 km: suficiente para resaltar la franja, y ~4× más barato
   * que el 0,1° del cálculo offline. */
  paso: 0.2,
} as const;

/** Ventana temporal que encierra el Máximo local de toda España (UT). */
const T_BUSQUEDA_INICIO = Date.UTC(2026, 7, 12, 18, 5, 0);
const T_BUSQUEDA_FIN = Date.UTC(2026, 7, 12, 18, 55, 0);

/** Tolerancia temporal de la búsqueda del Máximo (ms). El Oscurecimiento
 * es cuadrático y plano en torno a su máximo: 15 s de error temporal
 * cambian el valor en menos de 10⁻⁴. */
const TOLERANCIA_MS = 15_000;

/**
 * Oscurecimiento máximo en un punto, buscado por sección áurea sobre el
 * tiempo (el Oscurecimiento es unimodal dentro de la ventana). Cuesta
 * ~11 evaluaciones de `oscurecimientoInstantaneo` (~0,4 ms por punto);
 * es la versión "en vivo" del `circunstanciasLocales(...).
 * oscurecimientoMaximo` que usa el script offline, sin la búsqueda de
 * Contactos, que es mucho más cara.
 */
export function maxOscurecimientoEn(lat: number, lon: number): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  const f = (ms: number): number =>
    -oscurecimientoInstantaneo({ lat, lon }, new Date(ms));
  let a = T_BUSQUEDA_INICIO;
  let b = T_BUSQUEDA_FIN;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > TOLERANCIA_MS) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = f(d);
    }
  }
  return -Math.min(fc, fd);
}

/**
 * Calcula la rejilla de Oscurecimiento máximo cediendo el hilo tras cada
 * fila (~30 ms), para no congelar la interfaz. Total ~2 s en un portátil;
 * quien la usa la memoiza (una vez calculada sirve para cualquier nivel).
 *
 * @param onProgreso - Recibe la fracción completada [0, 1] tras cada fila.
 */
export async function calcularRejillaOscurecimiento(
  onProgreso?: (fraccion: number) => void,
): Promise<RejillaOscurecimiento> {
  const { lonMin, lonMax, latMin, latMax, paso } = REJILLA_VIVA;
  const nx = Math.round((lonMax - lonMin) / paso) + 1;
  const ny = Math.round((latMax - latMin) / paso) + 1;
  const valores = new Float64Array(nx * ny);

  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * paso;
    for (let i = 0; i < nx; i++) {
      valores[j * nx + i] = maxOscurecimientoEn(lat, lonMin + i * paso);
    }
    onProgreso?.((j + 1) / ny);
    await new Promise((listo) => setTimeout(listo, 0));
  }

  return { lonMin, latMin, paso, nx, ny, valores };
}

/**
 * Techo del umbral del contorno en vivo: dentro de la Franja el valor es
 * exactamente 1, y un umbral de 1.0 justo degenera en marching squares.
 * Al 99,95 % la región es indistinguible de la propia Franja.
 */
const NIVEL_MAXIMO_CONTORNO = 0.9995;

/**
 * Región con Oscurecimiento máximo ≥ `nivel` como MultiPolygon lon/lat,
 * por marching squares (d3-contour) sobre la rejilla. Con geometría vacía
 * si ningún punto alcanza el nivel.
 *
 * @param nivel - Umbral en [0, 1]; se recorta a {@link NIVEL_MAXIMO_CONTORNO}.
 */
export function contornoNivel(
  rejilla: RejillaOscurecimiento,
  nivel: number,
): MultiPolygon {
  const { lonMin, latMin, paso, nx, ny, valores } = rejilla;
  const umbral = Math.min(nivel, NIVEL_MAXIMO_CONTORNO);
  const generador = contours().size([nx, ny]).thresholds([umbral]);
  const [contorno] = generador(Array.from(valores));
  return {
    type: "MultiPolygon",
    // d3-contour sitúa la muestra (i, j) en (i + 0,5, j + 0,5): hay que
    // restar media celda al transformar a lon/lat.
    coordinates: (contorno?.coordinates ?? []).map((poligono) =>
      poligono.map((anillo) =>
        anillo.map(([x, y]) => [
          lonMin + (x - 0.5) * paso,
          latMin + (y - 0.5) * paso,
        ]),
      ),
    ),
  };
}

// ---------------------------------------------------------------------------
// Observador
// ---------------------------------------------------------------------------

/**
 * El Municipio más cercano a un punto (clic en el mapa), por distancia
 * haversine. Barrido lineal del Nomenclátor (~8.100 entradas): sobra para
 * un clic. Lanza si la lista está vacía.
 */
export function municipioMasCercano(
  lat: number,
  lon: number,
  municipios: readonly Municipio[],
): Municipio {
  if (municipios.length === 0) {
    throw new Error("Lista de municipios vacía");
  }
  let mejor = municipios[0];
  let mejorKm = Infinity;
  for (const municipio of municipios) {
    const km = distanciaKm([lon, lat], [municipio.lon, municipio.lat]);
    if (km < mejorKm) {
      mejorKm = km;
      mejor = municipio;
    }
  }
  return mejor;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** Milisegundos de desfase CEST (UT+2), el huso peninsular el 12-08-2026. */
export const CEST_OFFSET_MS = 2 * 3_600_000;

/** Hora CEST "HH:MM" (o "HH:MM:SS") de un instante en ms de época. */
export function formatoHoraCEST(tMs: number, conSegundos = false): string {
  const iso = new Date(tMs + CEST_OFFSET_MS).toISOString();
  return iso.slice(11, conSegundos ? 19 : 16);
}
