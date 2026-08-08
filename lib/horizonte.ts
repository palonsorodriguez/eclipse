/**
 * horizonte — Perfil real del horizonte por relieve para un Observador.
 *
 * Con el sol a 2–12° durante el eclipse del 12-08-2026, la pregunta decisiva
 * es "¿me lo tapará ese monte?". Este módulo muestrea la elevación del
 * terreno a lo largo del sector de acimuts del eclipse (acimut del sol en
 * C1→C4 ± 20°, paso 2°) en radios de 1 a 50 km y deriva, por acimut, el
 * ángulo de obstrucción del horizonte:
 *
 *     α = atan((h_terreno − h_observador − d²/(2·R_Tierra)) / d)
 *
 * donde el término d²/(2R) es la caída por curvatura terrestre (~7,8 m a
 * 10 km, ~196 m a 50 km): un monte lejano asoma menos de lo que sugiere su
 * altura.
 *
 * Fuente de elevación: **Open-Meteo Elevation**
 * (https://api.open-meteo.com/v1/elevation — Copernicus GLO-90). Verificada
 * el 08-08-2026: sin clave API, CORS abierto (`access-control-allow-origin:
 * *`), admite listas de coordenadas separadas por comas con un límite de
 * **100 coordenadas por petición** (con 101 responde
 * `"must not exceed 100 coordinates"`), por lo que las peticiones se agrupan
 * en lotes de 100, en secuencia y con reintento ante 429 (límite medido:
 * ~600 coordenadas/minuto). Alternativa probada y descartada: Open Topo
 * Data (api.opentopodata.org/v1/srtm90m) responde sin clave, pero no envía
 * `access-control-allow-origin` — inviable desde el navegador — y además
 * limita a 1 petición/segundo.
 *
 * Separación lógica pura / red, como en `lib/meteo.ts`: la geometría
 * (ángulo, curvatura, sector, agrupación) es pura y testeable; el acceso de
 * red se mockea en el límite del sistema (global fetch). Los resultados se
 * cachean por Observador.
 */

/** Radio medio de la Tierra en metros. */
const RADIO_TIERRA_M = 6_371_000;

/** Límite de coordenadas por petición de Open-Meteo Elevation (verificado). */
export const MAX_COORDS_POR_PETICION = 100;

/** Margen del sector de acimuts a cada lado del recorrido del sol (grados). */
export const MARGEN_SECTOR = 20;

/** Paso entre acimuts muestreados (grados). */
export const PASO_ACIMUT = 2;

/**
 * Radios de muestreo del terreno a lo largo de cada acimut, en km,
 * aproximadamente logarítmicos de 1 a 50 km: densos cerca (donde un
 * monte modesto puede subtender varios grados) y espaciados lejos.
 */
export const RADIOS_KM = [
  1, 1.3, 1.7, 2.2, 2.9, 3.7, 4.8, 6.3, 8.1, 10.5, 13.6, 17.7, 22.9, 29.7,
  38.5, 50,
] as const;

/** Elevación (m) por debajo de la cual una muestra se considera mar. */
const UMBRAL_MAR_M = 0.5;

/**
 * Fracción mínima de muestras radiales marinas para clasificar un acimut
 * como horizonte marino.
 */
const FRACCION_MAR_MINIMA = 0.7;

/**
 * Obstrucción máxima (grados) compatible con un veredicto de horizonte
 * marino: por encima, algo de relieve asoma en el recorrido.
 */
const OBSTRUCCION_MARINA_MAX = 0.5;

/** Un punto geográfico lat/lon en grados. */
export interface PuntoGeo {
  lat: number;
  lon: number;
}

/** Muestra de terreno sobre un radio: distancia al Observador y elevación. */
export interface MuestraRadial {
  /** Distancia horizontal al Observador en km. */
  distanciaKm: number;
  /** Elevación del terreno sobre el nivel del mar en metros. */
  elevacion: number;
}

/** Obstrucción del horizonte en un acimut concreto. */
export interface ObstruccionAcimut {
  /** Acimut en grados (0 = norte, 90 = este), normalizado a [0, 360). */
  acimut: number;
  /**
   * Ángulo de obstrucción en grados: el máximo ángulo de elevación
   * aparente del terreno en este acimut. Puede ser ligeramente negativo
   * (horizonte por debajo de la horizontal, p. ej. mar visto desde un
   * acantilado).
   */
  angulo: number;
  /** Distancia (km) de la muestra que domina el horizonte en este acimut. */
  distanciaKm: number;
  /** Fracción [0, 1] de muestras radiales al nivel del mar (mar). */
  fraccionMar: number;
}

/** Perfil de horizonte de un Observador hacia el sector del eclipse. */
export interface PerfilHorizonte {
  /** Elevación del Observador (m) según el modelo digital del terreno. */
  elevacionObservador: number;
  /** Obstrucción por acimut, en orden creciente de acimut. */
  acimuts: ObstruccionAcimut[];
}

/** Clase de horizonte hacia el sol: de mejor a peor. */
export type TipoHorizonte = "marino" | "despejado" | "obstruido";

/** Veredicto del horizonte frente a la posición del sol. */
export interface VeredictoHorizonte {
  tipo: TipoHorizonte;
  /** Obstrucción máxima del sector en grados (nunca negativa). */
  obstruccionMax: number;
  /** Acimut (grados) donde se da la obstrucción máxima del sector. */
  acimutObstruccionMax: number;
  /** Obstrucción (grados, nunca negativa) en el acimut del sol. */
  obstruccionEnSol: number;
}

/**
 * Ángulo de obstrucción (grados) de un conjunto de muestras radiales vistas
 * por un observador a `elevacionObservador` metros: para cada muestra,
 * `atan((Δh − d²/(2R)) / d)` con la corrección de curvatura terrestre, y se
 * devuelve el máximo junto a la distancia de la muestra dominante.
 *
 * Con terreno a la misma cota que el observador el resultado es ligeramente
 * negativo (la curvatura hunde el horizonte); no se recorta a cero para que
 * la geometría sea honesta — el recorte es cosa de la capa de presentación.
 *
 * @param elevacionObservador - Elevación del observador en metros.
 * @param muestras - Muestras (distancia, elevación) de un acimut, no vacías.
 */
export function anguloObstruccion(
  elevacionObservador: number,
  muestras: readonly MuestraRadial[],
): { angulo: number; distanciaKm: number } {
  if (muestras.length === 0) {
    throw new Error("anguloObstruccion necesita al menos una muestra");
  }
  let mejor = { angulo: -Infinity, distanciaKm: 0 };
  for (const { distanciaKm, elevacion } of muestras) {
    const d = distanciaKm * 1000;
    const caidaCurvatura = (d * d) / (2 * RADIO_TIERRA_M);
    const angulo =
      (Math.atan2(elevacion - elevacionObservador - caidaCurvatura, d) * 180) /
      Math.PI;
    if (angulo > mejor.angulo) {
      mejor = { angulo, distanciaKm };
    }
  }
  return mejor;
}

/**
 * Obstrucción completa de un acimut a partir de sus muestras radiales:
 * ángulo dominante con curvatura ({@link anguloObstruccion}) más la
 * fracción de muestras marinas. La usa `calcularPerfil` para el sector del
 * eclipse y `cielo-horizonte` para el resto del círculo (issue #48), de
 * modo que ambas mitades del perfil se derivan con la misma geometría.
 */
export function obstruccionDeMuestras(
  elevacionObservador: number,
  acimut: number,
  muestras: readonly MuestraRadial[],
): ObstruccionAcimut {
  const { angulo, distanciaKm } = anguloObstruccion(
    elevacionObservador,
    muestras,
  );
  const marinas = muestras.filter((m) => m.elevacion <= UMBRAL_MAR_M).length;
  return { acimut, angulo, distanciaKm, fraccionMar: marinas / muestras.length };
}

/**
 * ¿Es este acimut un horizonte marino? La mayor parte del recorrido radial
 * es mar y no asoma relieve por encima de {@link OBSTRUCCION_MARINA_MAX}.
 * El mismo criterio que usa `evaluarHorizonte` para el veredicto `marino`,
 * compartido con la Vista Cielo para dibujar agua (issue #48).
 */
export function esAcimutMarino(
  o: Pick<ObstruccionAcimut, "angulo" | "fraccionMar">,
): boolean {
  return (
    o.fraccionMar >= FRACCION_MAR_MINIMA &&
    Math.max(0, o.angulo) <= OBSTRUCCION_MARINA_MAX
  );
}

/**
 * Punto de destino sobre la esfera terrestre partiendo de `origen` con un
 * `acimut` (grados, 0 = norte) y una `distanciaKm` sobre la superficie.
 * Fórmula geodésica esférica estándar; error < 0,5 % frente al elipsoide,
 * irrelevante para muestrear un modelo de terreno de ~90 m de celda.
 */
export function puntoDestino(
  origen: PuntoGeo,
  acimut: number,
  distanciaKm: number,
): PuntoGeo {
  const DEG2RAD = Math.PI / 180;
  const lat1 = origen.lat * DEG2RAD;
  const lon1 = origen.lon * DEG2RAD;
  const rumbo = acimut * DEG2RAD;
  const delta = (distanciaKm * 1000) / RADIO_TIERRA_M;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) +
      Math.cos(lat1) * Math.sin(delta) * Math.cos(rumbo),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(rumbo) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: lat2 / DEG2RAD, lon: (((lon2 / DEG2RAD) + 540) % 360) - 180 };
}

/**
 * Acimuts a muestrear para el sector del eclipse: del menor al mayor de los
 * acimuts del sol en C1 y C4, ampliado ± {@link MARGEN_SECTOR} y con paso
 * {@link PASO_ACIMUT}. Los valores se normalizan a [0, 360); si el sector
 * cruzara el norte, la secuencia sigue siendo contigua (creciente antes de
 * normalizar).
 */
export function acimutsSector(
  acimutC1: number,
  acimutC4: number,
  margen: number = MARGEN_SECTOR,
  paso: number = PASO_ACIMUT,
): number[] {
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const a1 = norm(acimutC1);
  let a2 = norm(acimutC4);
  // Recorrido por el arco corto entre ambos acimuts (el sol no cruza 180°
  // de acimut durante un eclipse).
  if (a2 - a1 > 180) a2 -= 360;
  if (a1 - a2 > 180) a2 += 360;

  // Bordes redondeados al grado: acimuts "limpios" en la UI y claves de
  // caché estables aunque el acimut del sol llegue con decimales.
  const desde = Math.round(Math.min(a1, a2) - margen);
  const hasta = Math.round(Math.max(a1, a2) + margen);

  const acimuts: number[] = [];
  for (let a = desde; a <= hasta + 1e-9; a += paso) {
    acimuts.push(norm(a));
  }
  return acimuts;
}

/**
 * Parte `items` en grupos consecutivos de como mucho `tamano` elementos,
 * conservando el orden. Para agrupar coordenadas en peticiones de como
 * mucho {@link MAX_COORDS_POR_PETICION} puntos.
 */
export function agrupar<T>(items: readonly T[], tamano: number): T[][] {
  if (tamano < 1) {
    throw new Error("agrupar necesita un tamaño de grupo >= 1");
  }
  const grupos: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    grupos.push(items.slice(i, i + tamano));
  }
  return grupos;
}

/**
 * URL de Open-Meteo Elevation para una lista de puntos (máx.
 * {@link MAX_COORDS_POR_PETICION}): listas de latitudes y longitudes
 * separadas por comas, sin clave API.
 */
export function urlElevacion(puntos: readonly PuntoGeo[]): string {
  const latitude = puntos.map((p) => p.lat.toFixed(5)).join(",");
  const longitude = puntos.map((p) => p.lon.toFixed(5)).join(",");
  return `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`;
}

/** Respuesta cruda de Open-Meteo Elevation. */
interface RespuestaElevacion {
  elevation?: number[];
}

/**
 * Espera antes de reintentar una petición limitada por 429 (ms). El límite
 * medido de la API es de ~6 peticiones de 100 coordenadas por minuto
 * (≈600 coordenadas/min); 30 s dan margen para cruzar el reinicio de la
 * ventana.
 */
export const ESPERA_REINTENTO_MS = 30_000;

/** Reintentos máximos ante un 429 antes de rendirse. */
export const MAX_REINTENTOS_429 = 2;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGrupo(grupo: readonly PuntoGeo[]): Promise<number[]> {
  const respuesta = await fetch(urlElevacion(grupo));
  if (!respuesta.ok) {
    throw new Error(`Open-Meteo Elevation respondió ${respuesta.status}`);
  }
  const datos = (await respuesta.json()) as RespuestaElevacion;
  if (!datos.elevation || datos.elevation.length !== grupo.length) {
    throw new Error(
      "Open-Meteo Elevation devolvió un número de elevaciones inesperado",
    );
  }
  return datos.elevation;
}

async function fetchGrupoConReintentos(
  grupo: readonly PuntoGeo[],
): Promise<number[]> {
  for (let intento = 0; ; intento++) {
    try {
      return await fetchGrupo(grupo);
    } catch (error) {
      const esLimite =
        error instanceof Error && error.message.includes("429");
      if (!esLimite || intento >= MAX_REINTENTOS_429) throw error;
      await esperar(ESPERA_REINTENTO_MS);
    }
  }
}

/**
 * Descarga las elevaciones (m) de una lista de puntos de cualquier tamaño,
 * agrupando en peticiones de {@link MAX_COORDS_POR_PETICION} coordenadas
 * (límite verificado de la API). Las peticiones van en secuencia — no en
 * paralelo — porque la API limita a ~600 coordenadas por minuto (medido:
 * a la 7.ª petición de 100 coordenadas responde 429); ante un 429 se
 * reintenta hasta {@link MAX_REINTENTOS_429} veces esperando
 * {@link ESPERA_REINTENTO_MS} entre intentos, lo que cruza el reinicio de
 * la ventana del límite.
 *
 * Lanza `Error` si alguna petición falla o devuelve menos elevaciones de
 * las pedidas; el llamante decide cómo degradar.
 */
export async function fetchElevaciones(
  puntos: readonly PuntoGeo[],
): Promise<number[]> {
  const grupos = agrupar(puntos, MAX_COORDS_POR_PETICION);
  const elevaciones: number[] = [];
  for (const grupo of grupos) {
    elevaciones.push(...(await fetchGrupoConReintentos(grupo)));
  }
  return elevaciones;
}

/** Caché de perfiles por Observador y sector (clave lat/lon redondeados). */
const cachePerfiles = new Map<string, Promise<PerfilHorizonte>>();

/**
 * Perfil de elevación del horizonte de un Observador hacia el sector del
 * eclipse (acimut del sol en C1 y C4 ± {@link MARGEN_SECTOR}, paso
 * {@link PASO_ACIMUT}): muestrea el terreno con Open-Meteo Elevation en los
 * radios {@link RADIOS_KM} y deriva el ángulo de obstrucción por acimut con
 * corrección de curvatura terrestre.
 *
 * El resultado se cachea por Observador (y sector): elegir el mismo
 * municipio dos veces no repite las ~6 peticiones. Un fallo de red no
 * envenena la caché (se puede reintentar).
 */
export function fetchPerfilHorizonte(
  observador: PuntoGeo,
  acimutSolC1: number,
  acimutSolC4: number,
): Promise<PerfilHorizonte> {
  const clave = [
    observador.lat.toFixed(4),
    observador.lon.toFixed(4),
    Math.round(acimutSolC1),
    Math.round(acimutSolC4),
  ].join("|");

  const cacheado = cachePerfiles.get(clave);
  if (cacheado) return cacheado;

  const promesa = calcularPerfil(observador, acimutSolC1, acimutSolC4);
  cachePerfiles.set(clave, promesa);
  promesa.catch(() => cachePerfiles.delete(clave));
  return promesa;
}

async function calcularPerfil(
  observador: PuntoGeo,
  acimutSolC1: number,
  acimutSolC4: number,
): Promise<PerfilHorizonte> {
  const acimuts = acimutsSector(acimutSolC1, acimutSolC4);

  // Primer punto: el propio Observador (su elevación según el mismo modelo
  // de terreno). Después, todos los radios de todos los acimuts, en orden.
  const puntos: PuntoGeo[] = [observador];
  for (const acimut of acimuts) {
    for (const radio of RADIOS_KM) {
      puntos.push(puntoDestino(observador, acimut, radio));
    }
  }

  const elevaciones = await fetchElevaciones(puntos);
  const elevacionObservador = elevaciones[0]!;

  const porAcimut: ObstruccionAcimut[] = acimuts.map((acimut, i) => {
    const desde = 1 + i * RADIOS_KM.length;
    const muestras: MuestraRadial[] = RADIOS_KM.map((distanciaKm, j) => ({
      distanciaKm,
      elevacion: elevaciones[desde + j]!,
    }));
    return obstruccionDeMuestras(elevacionObservador, acimut, muestras);
  });

  return { elevacionObservador, acimuts: porAcimut };
}

/** Distancia angular mínima entre dos acimuts, en grados [0, 180]. */
function distanciaAcimutal(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return Math.min(d, 360 - d);
}

/**
 * Evalúa el perfil frente al sol en el instante decisivo (mitad de la
 * Totalidad, o el Máximo si el eclipse es parcial) y clasifica el horizonte:
 *
 * - `obstruido`: la obstrucción en el acimut del sol alcanza o supera la
 *   altitud del sol — el monte te roba el eclipse.
 * - `marino`: en el acimut del sol la mayor parte del recorrido radial es
 *   mar y no asoma relieve — el mejor horizonte posible.
 * - `despejado`: el relieve queda por debajo del sol.
 *
 * @param perfil - Perfil de horizonte del Observador.
 * @param acimutSol - Acimut del sol (grados) en el instante decisivo.
 * @param altitudSol - Altitud del sol (grados) en el instante decisivo.
 */
export function evaluarHorizonte(
  perfil: PerfilHorizonte,
  acimutSol: number,
  altitudSol: number,
): VeredictoHorizonte {
  if (perfil.acimuts.length === 0) {
    throw new Error("evaluarHorizonte necesita un perfil con acimuts");
  }

  let enSol = perfil.acimuts[0]!;
  let maximo = perfil.acimuts[0]!;
  for (const obstruccion of perfil.acimuts) {
    if (
      distanciaAcimutal(obstruccion.acimut, acimutSol) <
      distanciaAcimutal(enSol.acimut, acimutSol)
    ) {
      enSol = obstruccion;
    }
    if (obstruccion.angulo > maximo.angulo) {
      maximo = obstruccion;
    }
  }

  const obstruccionEnSol = Math.max(0, enSol.angulo);
  const obstruccionMax = Math.max(0, maximo.angulo);

  let tipo: TipoHorizonte;
  if (obstruccionEnSol >= altitudSol) {
    tipo = "obstruido";
  } else if (esAcimutMarino(enSol)) {
    tipo = "marino";
  } else {
    tipo = "despejado";
  }

  return {
    tipo,
    obstruccionMax,
    acimutObstruccionMax: maximo.acimut,
    obstruccionEnSol,
  };
}
