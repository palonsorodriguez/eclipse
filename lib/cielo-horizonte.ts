/**
 * cielo-horizonte — El paisaje real del Observador para la Vista Cielo
 * (issue #48): une el perfil de elevación del sector del eclipse
 * (`lib/horizonte.ts`, issue #43) con el render WebGL (issue #39).
 *
 * El paneo de la Vista Cielo recorre 360° de acimut, pero el perfil del
 * panel solo cubre el sector del eclipse (±20° del recorrido del sol, paso
 * 2°). Este módulo amplía el muestreo al resto del círculo con paso mayor
 * (12°, menos radios: allí solo hay paisaje, no veredicto) y funde
 * ambas mitades en un perfil por grado de acimut — alturas angulares
 * suavizadas y máscara de mar — listo para subirse al shader del terreno
 * como textura 1D (`lib/cielo-gl.ts`).
 *
 * ## Presupuesto de peticiones (límite medido en #43: ~600 coords/min;
 * ## además la API tiene límite HORARIO, ver `ErrorSaturacionElevacion`)
 *
 * Por Observador nuevo, contra Open-Meteo Elevation (lotes de ≤ 100).
 * Para el eclipse real el sector C1→C4 ± 20° son 27–30 acimuts (medido
 * sobre municipios de toda España el 09-08-2026):
 *
 * - Sector del eclipse: 1 + ≤30 acimuts × 9 radios ≤ 271 coordenadas →
 *   **3 peticiones**. Compartidas con el panel: es la misma promesa
 *   cacheada de `fetchPerfilHorizonte`, nunca se piden dos veces.
 * - Resto del círculo: ≤25 acimuts × 4 radios ≤ 100 coordenadas →
 *   **1 petición** más, en secuencia tras el sector.
 *
 * Total ≤ 371 coordenadas en **≤ 4 peticiones por municipio nuevo**
 * (issue #61) — apenas media ventana del límite por minuto, y el gasto
 * horario baja a la mitad respecto a las 7 peticiones anteriores. El
 * resto del círculo además solo se pide si el render WebGL está activo y
 * visible (el llamante, `VistaCielo`, gatea la llamada): con el fallback
 * 2D o sin llegar a ver el canvas, un municipio cuesta 3 peticiones.
 * En el caso normal el perfil completo llega en segundos; si aun así la
 * API limita o falla (offline), la Vista Cielo mantiene su terreno
 * procedural. El resultado se cachea por Observador en memoria y de forma
 * persistente (`lib/almacen-local.ts`, sin caducidad): volver al mismo
 * municipio — incluso tras recargar — no repite ninguna petición.
 */

import { guardarAlmacen, leerAlmacen } from "./almacen-local";
import {
  claveDePerfil,
  esAcimutMarino,
  fetchElevaciones,
  fetchPerfilHorizonte,
  obstruccionDeMuestras,
  puntoDestino,
  MARGEN_SECTOR,
  type MuestraRadial,
  type ObstruccionAcimut,
  type PerfilHorizonte,
  type PuntoGeo,
} from "./horizonte";

/**
 * Paso entre acimuts fuera del sector del eclipse (grados): solo paisaje.
 * Era 8°; con 12° el resto del círculo de un municipio real cabe en una
 * única petición de ≤ 100 coordenadas (issue #61) y el suavizado + la
 * interpolación por grado siguen dando una silueta continua.
 */
export const PASO_ACIMUT_RESTO = 12;

/**
 * Radios de muestreo fuera del sector del eclipse, en km: un subconjunto
 * de `RADIOS_KM` cubriendo de 1 a ~25 km. El paisaje de espaldas al
 * eclipse no decide ningún veredicto y el suavizado de la silueta absorbe
 * la pérdida de precisión; a cambio, el presupuesto total cabe en la
 * ventana del límite de la API (ver cabecera). Cuatro radios bastan además
 * para la máscara de mar (3/4 marinos ≥ el umbral de 0,7 de
 * `esAcimutMarino`).
 */
export const RADIOS_KM_RESTO = [1, 2.7, 7.4, 25.5] as const;

/** Muestras del perfil fundido: una por grado de acimut. */
export const GRADOS_PERFIL = 360;

/**
 * Ancho de la textura 1D del perfil: potencia de dos para poder usar
 * `REPEAT` en WebGL1 (el paneo de 360° la muestrea sin costura).
 */
export const TAM_TEXTURA_PERFIL = 512;

/**
 * Altura angular (grados) que corresponde al valor máximo (255) del canal
 * de altura de la textura: el `altitudMax` del encuadre — nada por encima
 * de 30° entra en el canvas. El shader decodifica con esta misma constante.
 */
export const ALTURA_MAX_TEXTURA = 30;

/** Radio (grados) de la media móvil circular que suaviza las alturas. */
const RADIO_SUAVIZADO_ALTURAS = 2;

/** Radio (grados) del suavizado de la máscara de mar (borde tierra-agua). */
const RADIO_SUAVIZADO_MAR = 1;

/**
 * Perfil real del horizonte para el render: una muestra por grado de
 * acimut (índice = acimut en [0, 360)).
 */
export interface PerfilCielo {
  /** Altura angular del terreno en grados, suavizada y nunca negativa. */
  alturas: Float32Array;
  /** Fracción de mar [0, 1]: 1 = horizonte marino en ese acimut. */
  mar: Float32Array;
}

function normalizarAcimut(a: number): number {
  return ((a % 360) + 360) % 360;
}

/**
 * Acimuts del resto del círculo: el complemento del sector del eclipse
 * ({@link acimutsSector}) recorrido con paso {@link PASO_ACIMUT_RESTO},
 * normalizado a [0, 360) y sin solaparse con el sector. Los huecos de
 * hasta un paso entre la última muestra de una mitad y la primera de la
 * otra los cubre la interpolación de {@link construirPerfilCielo}.
 */
export function acimutsResto(
  acimutC1: number,
  acimutC4: number,
  margen: number = MARGEN_SECTOR,
  paso: number = PASO_ACIMUT_RESTO,
): number[] {
  // Bordes del sector, con el mismo redondeo que acimutsSector.
  const a1 = normalizarAcimut(acimutC1);
  let a2 = normalizarAcimut(acimutC4);
  if (a2 - a1 > 180) a2 -= 360;
  if (a1 - a2 > 180) a2 += 360;
  const desde = Math.round(Math.min(a1, a2) - margen);
  const hasta = Math.round(Math.max(a1, a2) + margen);

  const acimuts: number[] = [];
  for (let a = hasta + paso; a < desde + 360; a += paso) {
    acimuts.push(normalizarAcimut(a));
  }
  return acimuts;
}

/**
 * Media móvil circular de radio `radio` (en muestras): el índice envuelve
 * en los extremos, así el perfil no tiene costura en el acimut 0/360.
 */
export function suavizarCircular(
  valores: Float32Array,
  radio: number,
): Float32Array {
  const n = valores.length;
  const salida = new Float32Array(n);
  const ancho = 2 * radio + 1;
  for (let i = 0; i < n; i++) {
    let suma = 0;
    for (let k = -radio; k <= radio; k++) {
      suma += valores[(i + k + n) % n]!;
    }
    salida[i] = suma / ancho;
  }
  return salida;
}

/**
 * Valor del perfil en un acimut cualquiera: interpolación lineal circular
 * entre los grados enteros del array (índice = acimut).
 */
export function alturaPerfil(valores: Float32Array, acimut: number): number {
  const n = valores.length;
  const pos = (normalizarAcimut(acimut) / 360) * n;
  const i = Math.floor(pos) % n;
  const t = pos - Math.floor(pos);
  return valores[i]! * (1 - t) + valores[(i + 1) % n]! * t;
}

/**
 * Funde el sector del eclipse (paso 2°) y el resto del círculo (paso
 * {@link PASO_ACIMUT_RESTO}) en el perfil por grado de acimut que consume
 * el render:
 *
 * - Altura: el ángulo de obstrucción recortado a ≥ 0 (el recorte es de
 *   presentación, ver `anguloObstruccion`), interpolado linealmente entre
 *   muestras y suavizado con media móvil circular — la silueta pierde el
 *   dentado del muestreo pero conserva los cordales.
 * - Mar: 1 donde el acimut es horizonte marino ({@link esAcimutMarino}),
 *   interpolado y ligeramente suavizado para que el borde tierra-agua
 *   funda en vez de cortar.
 */
export function construirPerfilCielo(
  sector: PerfilHorizonte,
  resto: readonly ObstruccionAcimut[],
): PerfilCielo {
  const muestras = [...sector.acimuts, ...resto]
    .map((o) => ({
      acimut: normalizarAcimut(o.acimut),
      altura: Math.max(0, o.angulo),
      mar: esAcimutMarino(o) ? 1 : 0,
    }))
    .sort((a, b) => a.acimut - b.acimut);
  if (muestras.length === 0) {
    throw new Error("construirPerfilCielo necesita al menos una muestra");
  }

  const n = muestras.length;
  const alturas = new Float32Array(GRADOS_PERFIL);
  const mar = new Float32Array(GRADOS_PERFIL);
  let j = 0; // primera muestra con acimut > d (avanza con d)
  for (let d = 0; d < GRADOS_PERFIL; d++) {
    while (j < n && muestras[j]!.acimut <= d) j++;
    const ant = muestras[(j + n - 1) % n]!;
    const sig = muestras[j % n]!;
    // En los extremos, la vecina viene de dar la vuelta al círculo.
    const azAnt = j === 0 ? ant.acimut - 360 : ant.acimut;
    const azSig = j === n ? sig.acimut + 360 : sig.acimut;
    const t = azSig === azAnt ? 0 : (d - azAnt) / (azSig - azAnt);
    alturas[d] = ant.altura + (sig.altura - ant.altura) * t;
    mar[d] = ant.mar + (sig.mar - ant.mar) * t;
  }

  return {
    alturas: suavizarCircular(alturas, RADIO_SUAVIZADO_ALTURAS),
    mar: suavizarCircular(mar, RADIO_SUAVIZADO_MAR),
  };
}

/**
 * Serializa el perfil como textura 1D de {@link TAM_TEXTURA_PERFIL} × 1
 * texels `LUMINANCE_ALPHA` (2 bytes por texel): luminancia = altura
 * angular cuantizada (255 ↔ {@link ALTURA_MAX_TEXTURA} grados), alfa =
 * fracción de mar. El remuestreo 360 → 512 interpola circularmente, y el
 * filtrado LINEAR + REPEAT de la GPU añade el último suavizado.
 */
export function texturaPerfil(perfil: PerfilCielo): Uint8Array {
  const datos = new Uint8Array(TAM_TEXTURA_PERFIL * 2);
  for (let i = 0; i < TAM_TEXTURA_PERFIL; i++) {
    const acimut = (i * 360) / TAM_TEXTURA_PERFIL;
    const altura = alturaPerfil(perfil.alturas, acimut) / ALTURA_MAX_TEXTURA;
    const mar = alturaPerfil(perfil.mar, acimut);
    datos[i * 2] = Math.round(Math.min(1, Math.max(0, altura)) * 255);
    datos[i * 2 + 1] = Math.round(Math.min(1, Math.max(0, mar)) * 255);
  }
  return datos;
}

/** Caché en memoria de perfiles completos por Observador y sector. */
const cachePerfilesCielo = new Map<string, Promise<PerfilCielo>>();

/**
 * Prefijo de la caché persistente del perfil de 360°. La versión va en la
 * clave: súbela si cambia {@link PerfilCielo} o el muestreo del resto
 * ({@link PASO_ACIMUT_RESTO}, {@link RADIOS_KM_RESTO}).
 */
const PREFIJO_CIELO_PERSISTIDO = "eclipse.cielo.v1|";

/** Forma persistida del perfil: arrays JSON redondeados (~7 KB por clave). */
interface PerfilCieloPersistido {
  alturas: number[];
  mar: number[];
}

/** Redondeo a 3 decimales: 0,001° sobra para una silueta suavizada. */
function compactar(valores: Float32Array): number[] {
  return Array.from(valores, (v) => Math.round(v * 1000) / 1000);
}

function esPerfilCieloPersistidoValido(
  valor: unknown,
): valor is PerfilCieloPersistido {
  if (typeof valor !== "object" || valor === null) return false;
  const perfil = valor as PerfilCieloPersistido;
  return (
    Array.isArray(perfil.alturas) &&
    perfil.alturas.length === GRADOS_PERFIL &&
    Array.isArray(perfil.mar) &&
    perfil.mar.length === GRADOS_PERFIL &&
    perfil.alturas.every((v) => typeof v === "number") &&
    perfil.mar.every((v) => typeof v === "number")
  );
}

/**
 * Perfil real de 360° del Observador para la Vista Cielo. Primero espera
 * el perfil del sector del eclipse — la misma promesa cacheada que usa el
 * panel (`fetchPerfilHorizonte`), así que esas peticiones jamás se
 * duplican — y después muestrea el resto del círculo con paso
 * {@link PASO_ACIMUT_RESTO} y radios {@link RADIOS_KM_RESTO} (presupuesto
 * completo en la cabecera del módulo). El llamante debe pedirlo solo con
 * el render WebGL activo y visible: es la mitad del ahorro del issue #61.
 *
 * Se cachea por Observador y sector, en memoria y de forma persistente
 * (sin caducidad — el relieve no cambia): volver a un municipio ya medido,
 * incluso tras recargar, no toca la red. Un fallo de red no envenena
 * ninguna caché (se reintenta al volver a montar la vista) y el llamante
 * degrada al terreno procedural.
 */
export function fetchPerfilCielo(
  observador: PuntoGeo,
  acimutSolC1: number,
  acimutSolC4: number,
): Promise<PerfilCielo> {
  const clave = claveDePerfil(observador, acimutSolC1, acimutSolC4);

  const cacheado = cachePerfilesCielo.get(clave);
  if (cacheado) return cacheado;

  const persistido = leerAlmacen<PerfilCieloPersistido>(
    PREFIJO_CIELO_PERSISTIDO + clave,
  );
  if (esPerfilCieloPersistidoValido(persistido)) {
    const promesa = Promise.resolve<PerfilCielo>({
      alturas: Float32Array.from(persistido.alturas),
      mar: Float32Array.from(persistido.mar),
    });
    cachePerfilesCielo.set(clave, promesa);
    return promesa;
  }

  const promesa = calcularPerfilCielo(
    observador,
    acimutSolC1,
    acimutSolC4,
  ).then((perfil) => {
    guardarAlmacen(PREFIJO_CIELO_PERSISTIDO + clave, {
      alturas: compactar(perfil.alturas),
      mar: compactar(perfil.mar),
    } satisfies PerfilCieloPersistido);
    return perfil;
  });
  cachePerfilesCielo.set(clave, promesa);
  promesa.catch(() => cachePerfilesCielo.delete(clave));
  return promesa;
}

async function calcularPerfilCielo(
  observador: PuntoGeo,
  acimutSolC1: number,
  acimutSolC4: number,
): Promise<PerfilCielo> {
  // 1) Sector del eclipse: caché compartida con el panel.
  const sector = await fetchPerfilHorizonte(
    observador,
    acimutSolC1,
    acimutSolC4,
  );

  // 2) Resto del círculo, en secuencia (respeta el límite por minuto).
  const acimuts = acimutsResto(acimutSolC1, acimutSolC4);
  const puntos: PuntoGeo[] = [];
  for (const acimut of acimuts) {
    for (const radio of RADIOS_KM_RESTO) {
      puntos.push(puntoDestino(observador, acimut, radio));
    }
  }
  const elevaciones = await fetchElevaciones(puntos);

  const resto = acimuts.map((acimut, i) => {
    const desde = i * RADIOS_KM_RESTO.length;
    const muestras: MuestraRadial[] = RADIOS_KM_RESTO.map(
      (distanciaKm, j) => ({
        distanciaKm,
        elevacion: elevaciones[desde + j]!,
      }),
    );
    return obstruccionDeMuestras(sector.elevacionObservador, acimut, muestras);
  });

  return construirPerfilCielo(sector, resto);
}
