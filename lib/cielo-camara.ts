/**
 * cielo-camara — Lógica pura de la cámara inmersiva de la Vista Cielo
 * (issue #39): paneo de acimut 360° por arrastre con inercia suave.
 *
 * Sin canvas, sin React y sin reloj propio: el estado es un valor inmutable
 * y cada función devuelve el estado siguiente. El componente guarda el
 * estado en un ref y lo hace avanzar en su `onFrame` con el dt real.
 *
 * Convención de arrastre: "agarrar el cielo" — arrastrar el puntero hacia
 * la derecha (+px) trae hacia el centro lo que estaba a la izquierda, es
 * decir, disminuye el acimut del centro de la cámara.
 *
 * También vive aquí el encuadre inmersivo: la misma proyección cilíndrica
 * de `cielo-render` (ConfigEscena) pero derivada del tamaño real del
 * canvas, con campo de visión horizontal amplio y zoom de discos fijo.
 */

import type { ConfigEscena } from "./cielo-render";

/** Campo de visión horizontal objetivo del encuadre inmersivo (grados). */
export const FOV_HORIZONTAL = 100;

/**
 * Altitud máxima representable por la proyección cilíndrica (grados): por
 * encima la distorsión ya no es aceptable, así que en pantallas muy
 * verticales se estrecha el FOV en lugar de subir más el encuadre.
 */
export const ALTITUD_MAX_CILINDRICA = 60;

/** Fracción de la altura a la que va el horizonte (deja ~28% de suelo). */
export const FRACCION_HORIZONTE_INMERSIVA = 0.72;

/**
 * Zoom fijo de los discos en el encuadre inmersivo: el Sol real (~0,26° de
 * radio) se amplía ×12 (~6,3° de diámetro aparente, el "teleobjetivo" de
 * los documentales). La geometría relativa Sol–Luna se conserva porque
 * `escenaSolLuna` aplica el mismo factor a separación y radios.
 */
export const ZOOM_DISCOS = 12;

/**
 * ConfigEscena del encuadre inmersivo para un canvas `ancho`×`alto` px:
 * FOV horizontal de ~{@link FOV_HORIZONTAL}° (recortado si la pantalla es
 * tan vertical que superaría {@link ALTITUD_MAX_CILINDRICA}° de altitud) y
 * `fraccionDiscoSolar` elegida para que `factorZoom` dé exactamente
 * {@link ZOOM_DISCOS}. Compatible con todas las funciones de
 * `cielo-render` (proyectarAltAz, escenaSolLuna…).
 */
export function configVistaInmersiva(
  ancho: number,
  alto: number,
  acimutCentro: number,
  radioSolarGrados: number,
): ConfigEscena {
  const ppg = Math.max(
    ancho / FOV_HORIZONTAL,
    (alto * FRACCION_HORIZONTE_INMERSIVA) / ALTITUD_MAX_CILINDRICA,
  );
  return {
    ancho,
    alto,
    acimutCentro,
    altitudMax: (alto * FRACCION_HORIZONTE_INMERSIVA) / ppg,
    fraccionHorizonte: FRACCION_HORIZONTE_INMERSIVA,
    fraccionDiscoSolar: (2 * ZOOM_DISCOS * radioSolarGrados * ppg) / alto,
  };
}

/** Estado de la cámara: hacia dónde mira y cuánta inercia lleva. */
export interface CamaraCielo {
  /** Acimut (grados, [0, 360)) del centro del encuadre. */
  acimutCentro: number;
  /** Velocidad de paneo en grados/segundo (inercia tras soltar). */
  velocidad: number;
}

/** Constante de tiempo del frenado exponencial de la inercia (s). */
export const TAU_INERCIA_S = 0.55;

/** Velocidad (grados/s) por debajo de la cual la inercia se considera 0. */
export const VELOCIDAD_MINIMA = 0.02;

/** Velocidad máxima de inercia admitida (grados/s): evita "latigazos". */
export const VELOCIDAD_MAXIMA = 540;

/** Normaliza un acimut a [0, 360). */
export function normalizarAcimut(acimut: number): number {
  const a = acimut % 360;
  return a < 0 ? a + 360 : a;
}

/** Cámara quieta mirando a `acimutInicial`. */
export function crearCamara(acimutInicial: number): CamaraCielo {
  return { acimutCentro: normalizarAcimut(acimutInicial), velocidad: 0 };
}

/**
 * Aplica un arrastre de `dxPx` píxeles (positivo = hacia la derecha) con
 * una escala de `pxPorGrado`. Arrastrar anula la inercia previa: el dedo
 * manda mientras toca.
 */
export function arrastrarCamara(
  cam: CamaraCielo,
  dxPx: number,
  pxPorGrado: number,
): CamaraCielo {
  return {
    acimutCentro: normalizarAcimut(cam.acimutCentro - dxPx / pxPorGrado),
    velocidad: 0,
  };
}

/**
 * Suelta el arrastre con la velocidad final del puntero (px/s, positiva =
 * hacia la derecha): la cámara hereda la velocidad angular equivalente,
 * recortada a {@link VELOCIDAD_MAXIMA}.
 */
export function soltarCamara(
  cam: CamaraCielo,
  velPxPorS: number,
  pxPorGrado: number,
): CamaraCielo {
  const v = -velPxPorS / pxPorGrado;
  return {
    acimutCentro: cam.acimutCentro,
    velocidad: Math.max(-VELOCIDAD_MAXIMA, Math.min(VELOCIDAD_MAXIMA, v)),
  };
}

/**
 * Avanza la inercia `dtS` segundos: la cámara sigue girando con frenado
 * exponencial (constante {@link TAU_INERCIA_S}) hasta pararse del todo
 * (velocidad < {@link VELOCIDAD_MINIMA}). Idempotente con velocidad 0.
 */
export function pasoInercia(cam: CamaraCielo, dtS: number): CamaraCielo {
  if (cam.velocidad === 0 || dtS <= 0) return cam;
  const decaimiento = Math.exp(-dtS / TAU_INERCIA_S);
  // Desplazamiento exacto de la exponencial en el intervalo, no v·dt:
  // integra v(t) = v0·e^(−t/τ) entre 0 y dt.
  const desplazamiento = cam.velocidad * TAU_INERCIA_S * (1 - decaimiento);
  const velocidad = cam.velocidad * decaimiento;
  return {
    acimutCentro: normalizarAcimut(cam.acimutCentro + desplazamiento),
    velocidad: Math.abs(velocidad) < VELOCIDAD_MINIMA ? 0 : velocidad,
  };
}

/** ¿Está la cámara en reposo? (sin inercia pendiente). */
export function camaraQuieta(cam: CamaraCielo): boolean {
  return cam.velocidad === 0;
}
