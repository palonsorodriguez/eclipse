/**
 * cielo-extras — Lógica pura de los extras de realismo de la Totalidad
 * (issue #10): cuerpos celestes reales visibles durante la Totalidad,
 * anillo de diamante, perlas de Baily y sombra que llega.
 *
 * Sin canvas y sin React, como `cielo-render.ts`: todas las funciones son
 * deterministas y el pintado vive en `cielo-draw.ts`.
 *
 * ## Cuerpos celestes reales
 *
 * Venus, Júpiter y Mercurio se calculan con `Equator`/`Horizon` de
 * astronomy-engine (posición topocéntrica real y magnitud real vía
 * `Illumination`). Las estrellas brillantes salen de un catálogo incrustado
 * de coordenadas J2000; se proyectan con `Horizon` directamente, asumiendo
 * el error de precesión 2000 → 2026 (~0,3°, unos 5 px en el canvas:
 * invisible a este nivel de render).
 *
 * ## Ventanas temporales de los efectos
 *
 * Todos los efectos de contacto usan la misma rampa: intensidad 0 en el
 * borde exterior de la ventana que crece linealmente hasta 1 en el
 * contacto (C2 por la izquierda, C3 por la derecha) y 0 dentro de la
 * Totalidad (ahí mandan corona y cielo nocturno).
 *
 *   - Anillo de diamante: ±4 s alrededor de C2/C3.
 *   - Perlas de Baily:    ±1,5 s alrededor de C2/C3.
 *   - Sombra que llega:   ±30 s alrededor de C2/C3 (gradiente lateral).
 */

import {
  Body,
  Equator,
  Horizon,
  Illumination,
  Observer,
} from "astronomy-engine";
import type { Observador } from "./eclipse-engine";
import {
  deltaAcimut,
  proyectarAltAz,
  type ConfigEscena,
} from "./cielo-render";

/** Tipo de cuerpo celeste extra: planeta (magnitud real) o estrella fija. */
export type TipoCuerpo = "planeta" | "estrella";

/** Cuerpo celeste (planeta o estrella) con su posición alt-az real. */
export interface CuerpoCielo {
  /** Nombre en español para la etiqueta ("Venus", "Régulo"…). */
  nombre: string;
  tipo: TipoCuerpo;
  /** Magnitud visual aparente (menor = más brillante). */
  magnitud: number;
  /** Altitud sobre el horizonte en grados (con refracción). */
  altitud: number;
  /** Acimut en grados (0 = norte, 90 = este). */
  acimut: number;
}

/**
 * Catálogo incrustado de estrellas de primera magnitud candidatas a verse
 * durante la Totalidad (J2000: RA en horas, Dec en grados, magnitud V).
 * La visibilidad real (sobre el horizonte y dentro del encuadre) se decide
 * en tiempo de ejecución; aquí solo va el catálogo completo.
 */
const CATALOGO_ESTRELLAS: Array<{
  nombre: string;
  ra: number;
  dec: number;
  magnitud: number;
}> = [
  { nombre: "Régulo", ra: 10.1395, dec: 11.9672, magnitud: 1.4 },
  { nombre: "Arturo", ra: 14.2612, dec: 19.1824, magnitud: -0.05 },
  { nombre: "Vega", ra: 18.6156, dec: 38.7837, magnitud: 0.03 },
  { nombre: "Capella", ra: 5.2782, dec: 45.998, magnitud: 0.08 },
  { nombre: "Proción", ra: 7.655, dec: 5.225, magnitud: 0.34 },
  { nombre: "Altair", ra: 19.8464, dec: 8.8683, magnitud: 0.77 },
  { nombre: "Deneb", ra: 20.6905, dec: 45.2803, magnitud: 1.25 },
  { nombre: "Espiga", ra: 13.4199, dec: -11.1613, magnitud: 0.98 },
  { nombre: "Pólux", ra: 7.7553, dec: 28.0262, magnitud: 1.14 },
  { nombre: "Antares", ra: 16.4901, dec: -26.432, magnitud: 1.06 },
  { nombre: "Sirio", ra: 6.7525, dec: -16.7161, magnitud: -1.46 },
];

/** Planetas visibles a simple vista cerca del Sol el 12-08-2026. */
const PLANETAS: Array<{ nombre: string; body: Body }> = [
  { nombre: "Venus", body: Body.Venus },
  { nombre: "Júpiter", body: Body.Jupiter },
  { nombre: "Mercurio", body: Body.Mercury },
];

/**
 * Posiciones alt-az reales de los cuerpos extra (planetas + catálogo de
 * estrellas) para un Observador en el instante `t`. No filtra por
 * visibilidad: eso lo hace {@link proyectarCuerpos} con el encuadre.
 *
 * Coste: 3 × `Equator`+`Illumination` (planetas) + 11 × `Horizon`
 * (estrellas). Pensado para llamarse ~1 vez por segundo simulado, no por
 * frame (el llamante cachea; ver VistaCielo).
 */
export function cuerposCielo(observador: Observador, t: Date): CuerpoCielo[] {
  const observer = new Observer(
    observador.lat,
    observador.lon,
    observador.elevacion ?? 0,
  );
  const cuerpos: CuerpoCielo[] = [];

  for (const { nombre, body } of PLANETAS) {
    const eq = Equator(body, t, observer, true, true);
    const hor = Horizon(t, observer, eq.ra, eq.dec, "normal");
    cuerpos.push({
      nombre,
      tipo: "planeta",
      magnitud: Illumination(body, t).mag,
      altitud: hor.altitude,
      acimut: hor.azimuth,
    });
  }

  for (const e of CATALOGO_ESTRELLAS) {
    const hor = Horizon(t, observer, e.ra, e.dec, "normal");
    cuerpos.push({
      nombre: e.nombre,
      tipo: "estrella",
      magnitud: e.magnitud,
      altitud: hor.altitude,
      acimut: hor.azimuth,
    });
  }

  return cuerpos;
}

/**
 * Umbral de brillo de cielo por debajo del cual empiezan a fundirse los
 * planetas. Más alto que el de las estrellas: Venus y Júpiter se ven a
 * simple vista ya en la parcialidad profunda, minutos antes de C2.
 */
export const UMBRAL_BRILLO_PLANETAS = 0.3;

/**
 * Umbral de brillo para las estrellas: el mismo (0.06) con el que emergen
 * las estrellas de fondo de `cielo-draw.ts`, para que todo el firmamento
 * aparezca a la vez.
 */
export const UMBRAL_BRILLO_ESTRELLAS = 0.06;

/**
 * Opacidad [0, 1] de un cuerpo según el brillo del cielo (de
 * `brilloEscena`): 0 por encima de su umbral, fundido lineal hasta 1 con
 * el cielo totalmente apagado. Con el suelo de penumbra (brillo 0.05 fuera
 * de la Totalidad) las estrellas apenas se insinúan antes de C2 y solo
 * lucen plenas dentro de la Totalidad.
 */
export function alfaCuerpo(brillo: number, tipo: TipoCuerpo): number {
  const umbral =
    tipo === "planeta" ? UMBRAL_BRILLO_PLANETAS : UMBRAL_BRILLO_ESTRELLAS;
  return Math.min(1, Math.max(0, 1 - brillo / umbral));
}

/** Cuerpo ya proyectado a coordenadas de canvas, listo para dibujar. */
export interface CuerpoEnEscena {
  cuerpo: CuerpoCielo;
  x: number;
  y: number;
  /** Radio del punto en px, derivado de la magnitud. */
  radio: number;
  /**
   * `true` si cae dentro del encuadre. `false` solo para un planeta muy
   * brillante fuera de encuadre lateral (Venus), con `x` fijada al borde:
   * se dibuja como indicador sutil, no como punto.
   */
  dentro: boolean;
}

/**
 * Altitud mínima para considerar visible un cuerpo: por encima de la
 * silueta de colinas del horizonte (hasta ~1,7° en el canvas por defecto).
 */
const ALTITUD_MIN_CUERPO = 2;

/** Margen del encuadre en px para puntos y etiquetas. */
const MARGEN_ENCUADRE_PX = 12;

/**
 * Magnitud máxima (mínimo brillo) para merecer indicador de borde cuando
 * el cuerpo queda fuera de encuadre lateral. En la práctica solo Venus
 * (mag ≈ −4,4) lo supera: con la cámara fija en el acimut del Sol, Venus
 * (a ~46° del Sol) cae fuera del encuadre de ±31°.
 */
const MAGNITUD_MAX_INDICADOR = -3.5;

/** Radio en px del punto de un cuerpo según su magnitud visual. */
export function radioPuntoCuerpo(magnitud: number): number {
  return Math.min(4.5, Math.max(1.4, 3.0 - 0.5 * magnitud));
}

/**
 * Proyecta los cuerpos al canvas y filtra los visibles: sobre la silueta
 * del horizonte y dentro del encuadre. Un planeta muy brillante fuera de
 * encuadre lateral (Venus) sobrevive con `dentro: false` y la `x` fijada
 * al borde, para dibujarse como indicador.
 */
export function proyectarCuerpos(
  cuerpos: CuerpoCielo[],
  cfg: ConfigEscena,
): CuerpoEnEscena[] {
  const visibles: CuerpoEnEscena[] = [];
  for (const c of cuerpos) {
    if (c.altitud < ALTITUD_MIN_CUERPO) continue;
    const p = proyectarAltAz(c.altitud, c.acimut, cfg);
    if (p.y < MARGEN_ENCUADRE_PX) continue; // fuera por arriba
    const dentro =
      p.x >= MARGEN_ENCUADRE_PX && p.x <= cfg.ancho - MARGEN_ENCUADRE_PX;
    if (!dentro && (c.tipo !== "planeta" || c.magnitud > MAGNITUD_MAX_INDICADOR)) {
      continue;
    }
    visibles.push({
      cuerpo: c,
      x: Math.min(
        cfg.ancho - MARGEN_ENCUADRE_PX,
        Math.max(MARGEN_ENCUADRE_PX, p.x),
      ),
      y: p.y,
      radio: radioPuntoCuerpo(c.magnitud),
      dentro,
    });
  }
  return visibles;
}

/**
 * Ángulo de posición (radianes, convención canvas: 0 = +x, y hacia abajo)
 * del punto de contacto sobre el limbo solar: la dirección desde el centro
 * de la Luna hacia el centro del Sol, prolongada hasta el limbo. Ahí
 * sobrevive el último resto de fotosfera antes de C2 y ahí reaparece el
 * primero tras C3.
 */
export function anguloContacto(
  sol: { x: number; y: number },
  luna: { x: number; y: number },
): number {
  return Math.atan2(sol.y - luna.y, sol.x - luna.x);
}

/**
 * Rampa común de los efectos de contacto: 0 fuera de la ventana, lineal
 * hasta 1 en el contacto (creciendo hacia C2, decayendo desde C3) y 0
 * dentro de la Totalidad. Devuelve 0 si el Observador no tiene Totalidad.
 */
function rampaContacto(
  tMs: number,
  c2Ms: number | null,
  c3Ms: number | null,
  ventanaMs: number,
): number {
  if (c2Ms === null || c3Ms === null) return 0;
  if (tMs < c2Ms) {
    const d = c2Ms - tMs;
    return d <= ventanaMs ? 1 - d / ventanaMs : 0;
  }
  if (tMs > c3Ms) {
    const d = tMs - c3Ms;
    return d <= ventanaMs ? 1 - d / ventanaMs : 0;
  }
  return 0; // dentro de la Totalidad
}

/** Ventana del anillo de diamante: ±4 s alrededor de C2/C3. */
export const VENTANA_ANILLO_MS = 4000;

/** Ventana de las perlas de Baily: ±1,5 s alrededor de C2/C3. */
export const VENTANA_PERLAS_MS = 1500;

/** Ventana de la sombra que llega: ±30 s alrededor de C2/C3. */
export const VENTANA_SOMBRA_MS = 30000;

/**
 * Intensidad [0, 1] del anillo de diamante en `tMs`: crece durante los
 * ~4 s previos a C2, es máxima en el contacto y reaparece decayendo
 * durante los ~4 s posteriores a C3.
 */
export function intensidadAnilloDiamante(
  tMs: number,
  c2Ms: number | null,
  c3Ms: number | null,
): number {
  return rampaContacto(tMs, c2Ms, c3Ms, VENTANA_ANILLO_MS);
}

/**
 * Intensidad [0, 1] de las perlas de Baily: los ~1,5 s finales antes de
 * C2 y los primeros tras C3.
 */
export function intensidadPerlas(
  tMs: number,
  c2Ms: number | null,
  c3Ms: number | null,
): number {
  return rampaContacto(tMs, c2Ms, c3Ms, VENTANA_PERLAS_MS);
}

/** Una perla de Baily sobre el limbo. */
export interface PerlaBaily {
  /** Desfase angular (radianes) respecto al ángulo de contacto. */
  desfase: number;
  /** Tamaño relativo [0.35, 1]. */
  tam: number;
  /** Brillo relativo [0.6, 1]. */
  brillo: number;
}

/** Semilla fija de las perlas: la fecha del eclipse. Render reproducible. */
export const SEMILLA_PERLAS = 20260812;

/** Medio arco (radianes) alrededor del contacto donde caen las perlas. */
export const ARCO_PERLAS_RAD = 0.7;

/**
 * Genera 3–5 perlas de Baily con un LCG de semilla fija (mismo generador
 * de Park–Miller que las estrellas de fondo): irregulares pero idénticas
 * en cada render.
 */
export function perlasBaily(semilla: number): PerlaBaily[] {
  let s = semilla % 2147483647;
  if (s <= 0) s += 2147483646;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const cantidad = 3 + Math.floor(rnd() * 3); // 3–5
  const perlas: PerlaBaily[] = [];
  for (let i = 0; i < cantidad; i++) {
    perlas.push({
      desfase: (rnd() * 2 - 1) * ARCO_PERLAS_RAD,
      tam: 0.35 + rnd() * 0.65,
      brillo: 0.6 + rnd() * 0.4,
    });
  }
  return perlas;
}

/**
 * Acimut (grados) desde el que llega la umbra: la sombra recorre España
 * de ONO a ESE (Galicia → Baleares), así que "se siente venir" por el ONO.
 */
const ACIMUT_ORIGEN_UMBRA = 295;

/** Oscurecimiento lateral del cielo por la umbra que llega (o se va). */
export interface SombraLateral {
  /** Intensidad [0, 1] del gradiente; 0 = sin efecto. */
  intensidad: number;
  /** `true` si el oscurecimiento entra por el borde izquierdo del canvas. */
  desdeIzquierda: boolean;
}

/**
 * Sombra que llega: en los ~30 s previos a C2 el cielo se oscurece por el
 * lado del canvas que mira al ONO (por donde viene la umbra); en los
 * ~30 s posteriores a C3 el oscurecimiento se retira por el lado
 * contrario. Intensidad 0 dentro de la Totalidad (ahí el cielo entero ya
 * está apagado) y para Observadores sin Totalidad.
 */
export function sombraLateral(
  tMs: number,
  c2Ms: number | null,
  c3Ms: number | null,
  acimutCentro: number,
): SombraLateral {
  const intensidad = rampaContacto(tMs, c2Ms, c3Ms, VENTANA_SOMBRA_MS);
  const llegaPorIzquierda =
    deltaAcimut(ACIMUT_ORIGEN_UMBRA, acimutCentro) < 0;
  const antesDeC2 = c2Ms !== null && tMs < c2Ms;
  return {
    intensidad,
    desdeIzquierda: antesDeC2 ? llegaPorIzquierda : !llegaPorIzquierda,
  };
}
