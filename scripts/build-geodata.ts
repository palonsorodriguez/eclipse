/**
 * build-geodata — genera los datos geográficos estáticos del eclipse solar
 * total del 12 de agosto de 2026 y los escribe en `public/geodata/`.
 *
 * Ejecución:
 *
 *     npx tsx scripts/build-geodata.ts [--paso 0.1]
 *
 * `--paso` es el paso de la rejilla de isolíneas en grados (0,1° por
 * defecto, ~11 km). Los ficheros generados se versionan en el repo: son
 * estáticos y reproducibles con este script.
 *
 * Ficheros generados
 * ------------------
 *
 * 1. `banda-totalidad.geojson` — límites norte/sur y línea central de la
 *    Franja de totalidad, de Galicia a Baleares con margen atlántico y
 *    mediterráneo (lon −12° a 6°).
 *
 *    Método: en lugar de digitalizar la tabla de NASA
 *    (https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2026Aug12Tpath.html,
 *    dominio público, usada como contraste visual), los límites se calculan
 *    con el propio eclipse-engine: para cada meridiano se busca por
 *    bisección la latitud donde las Circunstancias locales pasan de
 *    `total` a `parcial` (límite norte y sur), y la línea central se
 *    obtiene maximizando la duración de la Totalidad entre ambos límites
 *    (búsqueda por sección áurea). Así la banda es exactamente coherente
 *    con lo que el motor calcula para cada Municipio.
 *
 * 2. `isolineas.geojson` — Isolíneas de Oscurecimiento máximo al 80%, 90%,
 *    95% y 99% sobre la península + Baleares + margen (lon −10° a 5°,
 *    lat 35° a 45°).
 *
 *    Método: rejilla regular de paso `--paso`, Oscurecimiento máximo por
 *    punto con `circunstanciasLocales`, y contornos por marching squares
 *    con d3-contour. Cada feature es un MultiPolygon (la región con
 *    Oscurecimiento ≥ nivel) con la propiedad `nivel`.
 *
 * 3. `umbra.json` — posición del centro de la umbra y su contorno
 *    aproximado (elipse: centro, semiejes en km y orientación) cada 30 s
 *    entre las 17:55 y las 18:40 UT (la entrada atlántica queda dentro de
 *    la serie: la sombra se ve venir desde el noroeste).
 *
 *    Método: para cada instante `t` se minimiza la separación angular
 *    topocéntrica Sol–Luna sobre la superficie (refinamiento sucesivo de
 *    rejilla): el mínimo es el punto donde el eje de la sombra corta el
 *    suelo, es decir, el centro de la umbra. Desde el centro se lanza un
 *    haz de 32 rumbos y se busca por bisección la distancia a la que el
 *    Oscurecimiento instantáneo deja de ser 1 (ampliando el alcance de
 *    búsqueda si hace falta: cerca de la puesta de sol la sombra es
 *    rasante y se estira cientos o miles de km — no hay tope artificial).
 *    La orientación de la elipse es el eje principal (momentos de segundo
 *    orden / PCA) de los 32 puntos del borde proyectados a un plano local
 *    en km — continua, no cuantizada al rumbo ganador del haz — y los
 *    semiejes se miden por bisección a lo largo de los ejes principales
 *    (media de los dos radios opuestos de cada eje), y el centro de la
 *    elipse se desplaza hacia el radio largo para anclar el borde trasero
 *    del óvalo asimétrico rasante. Los instantes en los
 *    que la umbra no toca la superficie con el Sol sobre el horizonte
 *    (antes de entrar por el Atlántico o tras la puesta de sol en el
 *    Mediterráneo) se omiten y quedan anotados en `instantesSinUmbra`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contours } from "d3-contour";
import {
  circunstanciasLocales,
  oscurecimientoInstantaneo,
  posicionesSolLunaEn,
  type CircunstanciasLocales,
} from "../lib/eclipse-engine";
import type {
  BandaTotalidadGeoJSON,
  InstanteUmbra,
  IsolineasGeoJSON,
  UmbraJSON,
} from "../lib/geodata";

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

/** Niveles de las Isolíneas de Oscurecimiento máximo. */
const NIVELES_ISOLINEAS = [0.8, 0.9, 0.95, 0.99];

/** Dominio de la banda: Galicia → Baleares con margen (grados). */
const BANDA_LON_MIN = -12;
const BANDA_LON_MAX = 6;
const BANDA_PASO_LON = 0.1;
const BANDA_LAT_MIN = 35;
/**
 * Techo del barrido en latitud: en el extremo atlántico (lon −12°) el
 * límite norte de la banda ronda los 47,5°, así que el techo debe quedar
 * por encima para no recortar la banda (el mapa la recorta al pintar).
 */
const BANDA_LAT_MAX = 50;

/** Dominio de la rejilla de isolíneas: península + Baleares + margen. */
const REJILLA_LON_MIN = -10;
const REJILLA_LON_MAX = 5;
const REJILLA_LAT_MIN = 35;
const REJILLA_LAT_MAX = 45;

/** Ventana temporal de la umbra (UT) y paso en segundos. */
const UMBRA_INICIO = new Date("2026-08-12T17:55:00Z");
const UMBRA_FIN = new Date("2026-08-12T18:40:00Z");
const UMBRA_PASO_S = 30;

/** Radio medio terrestre en km, para pasar de km a grados de arco. */
const RADIO_TIERRA_KM = 6371;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Redondeo a `n` decimales para mantener los GeoJSON compactos. */
function redondear(x: number, n: number): number {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

/**
 * Circunstancias locales del 12-08-2026, o `undefined` si el primer
 * eclipse local que encuentra el motor desde ese punto no es el del
 * 12-08-2026 (puntos muy alejados de la trayectoria; no ocurre sobre
 * España pero protege los bordes marinos del dominio).
 */
function circunstancias12Ago(
  lat: number,
  lon: number,
): CircunstanciasLocales | undefined {
  const c = circunstanciasLocales({ lat, lon });
  return c.c1.instante.toISOString().startsWith("2026-08-12") ? c : undefined;
}

/** ¿Hay Totalidad en este punto el 12-08-2026? */
function esTotal(lat: number, lon: number): boolean {
  return circunstancias12Ago(lat, lon)?.tipo === "total";
}

/**
 * Punto de destino a `distanciaKm` del origen siguiendo el rumbo `rumbo`
 * (grados desde el norte), sobre la esfera media.
 */
function destino(
  lat: number,
  lon: number,
  rumbo: number,
  distanciaKm: number,
): { lat: number; lon: number } {
  const d = distanciaKm / RADIO_TIERRA_KM;
  const th = rumbo * DEG2RAD;
  const la1 = lat * DEG2RAD;
  const lo1 = lon * DEG2RAD;
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(th),
  );
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(th) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2),
    );
  return { lat: la2 * RAD2DEG, lon: lo2 * RAD2DEG };
}

// ---------------------------------------------------------------------------
// 1. Banda de totalidad
// ---------------------------------------------------------------------------

interface ColumnaBanda {
  lon: number;
  latSur: number;
  latCentral: number;
  latNorte: number;
}

/**
 * Busca por bisección la latitud de transición total/parcial entre una
 * latitud `latTotal` (con Totalidad) y otra `latParcial` (sin ella), a
 * longitud fija. Devuelve la latitud del lado "total" con ~0,002°
 * (~200 m) de resolución.
 */
function bisecarLimite(lon: number, latTotal: number, latParcial: number): number {
  let a = latTotal;
  let b = latParcial;
  while (Math.abs(b - a) > 0.002) {
    const m = (a + b) / 2;
    if (esTotal(m, lon)) {
      a = m;
    } else {
      b = m;
    }
  }
  return a;
}

/** Ventana temporal del paso de la sombra por el dominio, para búsquedas. */
const SOMBRA_T_INICIO = new Date("2026-08-12T18:10:00Z").getTime();
const SOMBRA_T_FIN = new Date("2026-08-12T18:45:00Z").getTime();

/** Minimiza `f` en [a, b] por sección áurea con tolerancia `tol`. */
function seccionAurea(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number,
): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tol) {
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
  return (a + b) / 2;
}

/**
 * Mínimo sobre el tiempo de la separación angular Sol–Luna vista desde un
 * punto (grados): se anula justo donde pasa el eje de la sombra.
 */
function separacionMinima(lat: number, lon: number): number {
  const enT = (ms: number): number => separacion(lat, lon, new Date(ms));
  const tMin = seccionAurea(enT, SOMBRA_T_INICIO, SOMBRA_T_FIN, 500);
  return enT(tMin);
}

/**
 * Latitud de la línea central de la banda: donde el eje de la sombra corta
 * el suelo, es decir, la que anula (minimiza) la separación angular mínima
 * Sol–Luna. Este objetivo tiene un mínimo afilado y sin ruido numérico, al
 * contrario que la duración de la Totalidad, cuya meseta plana produce
 * zigzag de varios km entre columnas vecinas.
 */
function latitudCentral(lon: number, latSur: number, latNorte: number): number {
  return seccionAurea(
    (lat) => separacionMinima(lat, lon),
    latSur,
    latNorte,
    0.002,
  );
}

/**
 * Calcula una columna de la banda (límites sur/norte y línea central) en el
 * meridiano `lon`. `latPista` es la latitud central de la columna anterior,
 * que acelera la búsqueda del primer punto con Totalidad; `NaN` si no hay
 * pista. Devuelve `undefined` si la banda no cruza ese meridiano.
 */
function columnaBanda(lon: number, latPista: number): ColumnaBanda | undefined {
  // Barrido grueso para encontrar un punto con Totalidad.
  let semilla = NaN;
  const barridos: Array<[number, number, number]> = Number.isNaN(latPista)
    ? [[BANDA_LAT_MIN, BANDA_LAT_MAX, 0.25]]
    : [
        [Math.max(BANDA_LAT_MIN, latPista - 2), Math.min(BANDA_LAT_MAX, latPista + 2), 0.25],
        [BANDA_LAT_MIN, BANDA_LAT_MAX, 0.25],
      ];
  for (const [desde, hasta, paso] of barridos) {
    for (let lat = desde; lat <= hasta; lat += paso) {
      if (esTotal(lat, lon)) {
        semilla = lat;
        break;
      }
    }
    if (!Number.isNaN(semilla)) break;
  }
  if (Number.isNaN(semilla)) return undefined;

  // Extremos parciales por encima y por debajo de la semilla.
  let arriba = semilla;
  while (arriba < BANDA_LAT_MAX && esTotal(arriba + 0.25, lon)) arriba += 0.25;
  let abajo = semilla;
  while (abajo > BANDA_LAT_MIN && esTotal(abajo - 0.25, lon)) abajo -= 0.25;

  const latNorte = bisecarLimite(lon, arriba, arriba + 0.25);
  const latSur = bisecarLimite(lon, abajo, abajo - 0.25);
  const latCentral = latitudCentral(lon, latSur, latNorte);
  return { lon, latSur, latCentral, latNorte };
}

function generarBanda(): { geojson: BandaTotalidadGeoJSON; columnas: ColumnaBanda[] } {
  const columnas: ColumnaBanda[] = [];
  let pista = NaN;
  const nLon = Math.round((BANDA_LON_MAX - BANDA_LON_MIN) / BANDA_PASO_LON);
  for (let i = 0; i <= nLon; i++) {
    const lon = BANDA_LON_MIN + i * BANDA_PASO_LON;
    const col = columnaBanda(lon, pista);
    if (col) {
      columnas.push(col);
      pista = col.latCentral;
    }
    if (i % 30 === 0) {
      console.error(`  banda: lon ${lon.toFixed(1)}° (${columnas.length} columnas)`);
    }
  }

  const linea = (selector: (c: ColumnaBanda) => number): [number, number][] =>
    columnas.map((c) => [redondear(c.lon, 4), redondear(selector(c), 4)]);

  const geojson: BandaTotalidadGeoJSON = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { limite: "norte" },
        geometry: { type: "LineString", coordinates: linea((c) => c.latNorte) },
      },
      {
        type: "Feature",
        properties: { limite: "central" },
        geometry: { type: "LineString", coordinates: linea((c) => c.latCentral) },
      },
      {
        type: "Feature",
        properties: { limite: "sur" },
        geometry: { type: "LineString", coordinates: linea((c) => c.latSur) },
      },
    ],
  };
  return { geojson, columnas };
}

// ---------------------------------------------------------------------------
// 2. Isolíneas de Oscurecimiento máximo
// ---------------------------------------------------------------------------

function generarIsolineas(paso: number): IsolineasGeoJSON {
  const nx = Math.round((REJILLA_LON_MAX - REJILLA_LON_MIN) / paso) + 1;
  const ny = Math.round((REJILLA_LAT_MAX - REJILLA_LAT_MIN) / paso) + 1;
  const valores = new Float64Array(nx * ny);

  for (let j = 0; j < ny; j++) {
    const lat = REJILLA_LAT_MIN + j * paso;
    for (let i = 0; i < nx; i++) {
      const lon = REJILLA_LON_MIN + i * paso;
      valores[j * nx + i] =
        circunstancias12Ago(lat, lon)?.oscurecimientoMaximo ?? 0;
    }
    if (j % 10 === 0) {
      console.error(`  isolíneas: fila ${j + 1}/${ny} (lat ${lat.toFixed(1)}°)`);
    }
  }

  const generador = contours().size([nx, ny]).thresholds(NIVELES_ISOLINEAS);
  const multiPoligonos = generador(Array.from(valores));

  return {
    type: "FeatureCollection",
    features: multiPoligonos.map((mp) => ({
      type: "Feature",
      properties: { nivel: mp.value },
      geometry: {
        type: "MultiPolygon",
        // d3-contour devuelve coordenadas en el espacio de la rejilla y
        // sitúa la muestra (i, j) en (i + 0,5, j + 0,5): hay que restar
        // media celda al transformar a lon/lat (misma convención que
        // `lib/mapa.ts`).
        coordinates: mp.coordinates.map((poligono) =>
          poligono.map((anillo) =>
            anillo.map(([x, y]) => [
              redondear(REJILLA_LON_MIN + (x - 0.5) * paso, 3),
              redondear(REJILLA_LAT_MIN + (y - 0.5) * paso, 3),
            ]),
          ),
        ),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// 3. Umbra
// ---------------------------------------------------------------------------

/**
 * Separación angular topocéntrica Sol–Luna (grados) vista desde un punto.
 * Es la función objetivo de la búsqueda del centro de la umbra: se anula
 * exactamente donde el eje de la sombra corta la superficie.
 */
function separacion(lat: number, lon: number, t: Date): number {
  return posicionesSolLunaEn({ lat, lon }, t).separacionAngular;
}

/**
 * Minimiza la separación angular Sol–Luna sobre (lat, lon) por
 * refinamiento sucesivo de rejilla 5×5 centrada en la mejor estimación,
 * dividiendo el paso a la mitad hasta bajar de 0,002° (~200 m). A cada
 * paso la rejilla se re-explora mientras siga mejorando ("camina" hacia
 * el mínimo), así la búsqueda converge aunque la estimación inicial esté
 * a muchos grados del centro real (p. ej. el primer instante de la serie,
 * con la umbra aún en mitad del Atlántico norte).
 */
function minimizarSeparacion(
  t: Date,
  lat0: number,
  lon0: number,
  paso0: number,
): { lat: number; lon: number; separacion: number } {
  let mejor = { lat: lat0, lon: lon0, separacion: separacion(lat0, lon0, t) };
  let paso = paso0;
  while (paso > 0.002) {
    let mejora = true;
    while (mejora) {
      mejora = false;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          if (di === 0 && dj === 0) continue;
          const lat = mejor.lat + dj * paso;
          const lon = mejor.lon + di * paso;
          const s = separacion(lat, lon, t);
          if (s < mejor.separacion) {
            mejor = { lat, lon, separacion: s };
            mejora = true;
          }
        }
      }
    }
    paso /= 2;
  }
  return mejor;
}

/**
 * Alcance inicial de la búsqueda del borde de la umbra (km). Si el borde
 * queda más lejos, el alcance se duplica hasta encerrarlo: no hay tope
 * artificial (el antiguo tope de 600 km recortaba el semieje mayor cerca
 * de la puesta de sol, cuando la sombra rasante se estira de verdad).
 */
const ALCANCE_INICIAL_KM = 600;

/**
 * Salvaguarda geométrica del alcance: media circunferencia terrestre. La
 * intersección del cono de umbra con la esfera no puede superarla.
 */
const ALCANCE_MAXIMO_KM = Math.PI * RADIO_TIERRA_KM;

/**
 * Radio del contorno de la umbra (km) desde su centro siguiendo un rumbo:
 * bisección de la distancia a la que el Oscurecimiento instantáneo deja de
 * ser 1. Devuelve 0 si ni siquiera el centro está en Totalidad. El alcance
 * de búsqueda parte de {@link ALCANCE_INICIAL_KM} y se amplía duplicándolo
 * mientras el punto siga en Totalidad, hasta {@link ALCANCE_MAXIMO_KM}.
 */
function radioUmbra(
  centro: { lat: number; lon: number },
  rumbo: number,
  t: Date,
): number {
  const enUmbra = (d: number): boolean => {
    const p = destino(centro.lat, centro.lon, rumbo, d);
    return oscurecimientoInstantaneo({ lat: p.lat, lon: p.lon }, t) >= 1;
  };
  if (!enUmbra(0)) return 0;
  let fuera = ALCANCE_INICIAL_KM;
  while (enUmbra(fuera)) {
    if (fuera >= ALCANCE_MAXIMO_KM) return ALCANCE_MAXIMO_KM;
    fuera = Math.min(fuera * 2, ALCANCE_MAXIMO_KM);
  }
  let dentro = fuera > ALCANCE_INICIAL_KM ? fuera / 2 : 0;
  while (fuera - dentro > 0.5) {
    const m = (dentro + fuera) / 2;
    if (enUmbra(m)) {
      dentro = m;
    } else {
      fuera = m;
    }
  }
  return (dentro + fuera) / 2;
}

function generarUmbra(columnas: ColumnaBanda[]): UmbraJSON {
  const instantes: InstanteUmbra[] = [];
  const instantesSinUmbra: string[] = [];

  // Estimación inicial: el extremo occidental de la línea central (la
  // umbra entra por el Atlántico); después, el centro del instante previo.
  let estLat = columnas[0]?.latCentral ?? 45;
  let estLon = columnas[0]?.lon ?? -12;
  let paso0 = 4; // grados: la primera búsqueda es amplia

  const nPasos =
    Math.round((UMBRA_FIN.getTime() - UMBRA_INICIO.getTime()) / (UMBRA_PASO_S * 1000));
  for (let k = 0; k <= nPasos; k++) {
    const t = new Date(UMBRA_INICIO.getTime() + k * UMBRA_PASO_S * 1000);
    const min = minimizarSeparacion(t, estLat, estLon, paso0);
    const centro = { lat: min.lat, lon: min.lon };

    const solSobreHorizonte =
      posicionesSolLunaEn(centro, t).sol.altitud >= -0.27;
    const hayUmbra =
      solSobreHorizonte && oscurecimientoInstantaneo(centro, t) >= 1;

    if (!hayUmbra) {
      instantesSinUmbra.push(t.toISOString());
      continue;
    }

    // Contorno: haz de 32 rumbos, radio por bisección en cada uno. Los
    // puntos del borde se proyectan a un plano local en km (este/norte).
    const N_RUMBOS = 32;
    const borde: Array<{ x: number; y: number }> = [];
    for (let r = 0; r < N_RUMBOS; r++) {
      const rumbo = (r * 360) / N_RUMBOS;
      const radio = radioUmbra(centro, rumbo, t);
      borde.push({
        x: radio * Math.sin(rumbo * DEG2RAD), // este
        y: radio * Math.cos(rumbo * DEG2RAD), // norte
      });
    }

    // Orientación continua: eje principal de los puntos del borde por
    // momentos de segundo orden (PCA) respecto a su centroide — nada de
    // quedarse con el rumbo del haz más largo, que cuantizaba la
    // orientación a saltos de 360/32 = 11,25° (el "volantazo").
    const cx = borde.reduce((s, p) => s + p.x, 0) / N_RUMBOS;
    const cy = borde.reduce((s, p) => s + p.y, 0) / N_RUMBOS;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of borde) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    // Ángulo del eje principal desde el este (antihorario) → rumbo desde
    // el norte (horario), normalizado a [0, 180) por la simetría 180° de
    // la elipse.
    const anguloEste = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let orientacionGrados = (((90 - anguloEste * RAD2DEG) % 180) + 180) % 180;

    // Semiejes medidos por bisección a lo largo de los ejes principales
    // (media de los dos radios opuestos de cada eje): continuos entre
    // instantes, al contrario que el radio máximo/mínimo del haz, que
    // salta cuando el eje real cae entre dos rumbos.
    const radiosEje = (rumbo: number): [number, number] => [
      radioUmbra(centro, rumbo, t),
      radioUmbra(centro, rumbo + 180, t),
    ];
    let [rMayor1, rMayor2] = radiosEje(orientacionGrados);
    let [rMenor1, rMenor2] = radiosEje(orientacionGrados + 90);
    let semiejeMayorKm = (rMayor1 + rMayor2) / 2;
    let semiejeMenorKm = (rMenor1 + rMenor2) / 2;
    if (semiejeMenorKm > semiejeMayorKm) {
      [semiejeMayorKm, semiejeMenorKm] = [semiejeMenorKm, semiejeMayorKm];
      [rMayor1, rMayor2] = [rMenor1, rMenor2];
      orientacionGrados = (orientacionGrados + 90) % 180;
    }

    // La sombra rasante no es simétrica: la punta hacia el terminador se
    // alarga mucho más que el borde trasero. Si la elipse simétrica se
    // centra en el eje, ese estirón la hincha también hacia atrás (efecto
    // "despegue"). Se ancla el borde trasero desplazando el centro de la
    // elipse hacia el lado del radio largo.
    const desplazamientoKm = (rMayor1 - rMayor2) / 2;
    const centroElipse =
      desplazamientoKm >= 0
        ? destino(centro.lat, centro.lon, orientacionGrados, desplazamientoKm)
        : destino(
            centro.lat,
            centro.lon,
            orientacionGrados + 180,
            -desplazamientoKm,
          );

    instantes.push({
      t: t.toISOString(),
      centro: {
        lat: redondear(centroElipse.lat, 4),
        lon: redondear(centroElipse.lon, 4),
      },
      semiejeMayorKm: redondear(semiejeMayorKm, 1),
      semiejeMenorKm: redondear(semiejeMenorKm, 1),
      orientacionGrados: redondear(orientacionGrados, 1),
    });

    estLat = centro.lat;
    estLon = centro.lon;
    paso0 = 0.5; // las siguientes búsquedas parten del centro anterior
    if (k % 10 === 0) {
      console.error(
        `  umbra: ${t.toISOString().slice(11, 19)} UT → (${centro.lat.toFixed(2)}, ${centro.lon.toFixed(2)})`,
      );
    }
  }

  return {
    metodo:
      "Centro: mínimo de la separación angular topocéntrica Sol–Luna sobre la superficie (donde el eje de la sombra corta el suelo). Contorno: haz de 32 rumbos desde el centro y bisección de la distancia a la que el Oscurecimiento instantáneo deja de ser 1, ampliando el alcance de búsqueda sin tope artificial (cerca de la puesta de sol la sombra rasante se estira cientos o miles de km). Orientación: eje principal (momentos de segundo orden / PCA) de los 32 puntos del borde proyectados a un plano local en km — continua, en grados desde el norte, mod 180. Semiejes: bisección a lo largo de los ejes principales, media de los dos radios opuestos de cada eje; como el óvalo real se alarga más hacia el terminador, el centro de la elipse se desplaza hacia el radio largo para anclar el borde trasero (sin esto, el estirón rasante hinchaba la elipse también hacia atrás). En el último instante la umbra roza el terminador y el centro deja de avanzar hacia el este. Calculado con lib/eclipse-engine (astronomy-engine).",
    instantes,
    instantesSinUmbra,
  };
}

// ---------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------

function main(): void {
  const argPaso = process.argv.indexOf("--paso");
  const paso = argPaso >= 0 ? Number(process.argv[argPaso + 1]) : 0.1;
  if (!(paso > 0.005 && paso <= 1)) {
    throw new Error(`--paso fuera de rango (0.005–1]: ${paso}`);
  }

  const dirSalida = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "public",
    "geodata",
  );
  mkdirSync(dirSalida, { recursive: true });

  console.error("Generando banda de totalidad…");
  const { geojson: banda, columnas } = generarBanda();
  writeFileSync(join(dirSalida, "banda-totalidad.geojson"), JSON.stringify(banda));
  console.error(`  → banda-totalidad.geojson (${columnas.length} columnas)`);

  console.error(`Generando isolíneas (paso ${paso}°)…`);
  const isolineas = generarIsolineas(paso);
  writeFileSync(join(dirSalida, "isolineas.geojson"), JSON.stringify(isolineas));
  console.error("  → isolineas.geojson");

  console.error("Generando umbra…");
  const umbra = generarUmbra(columnas);
  writeFileSync(join(dirSalida, "umbra.json"), JSON.stringify(umbra, null, 2));
  console.error(
    `  → umbra.json (${umbra.instantes.length} instantes con umbra, ${umbra.instantesSinUmbra.length} sin)`,
  );
}

main();
