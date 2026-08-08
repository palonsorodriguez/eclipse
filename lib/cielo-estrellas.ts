/**
 * cielo-estrellas — Catálogo de cielo completo para la Vista Cielo
 * hiperrealista (issue #39): ~50 estrellas brillantes con magnitudes y
 * colores reales (índice B−V), más los planetas visibles, en todo el domo.
 *
 * Módulo puro salvo por `astronomy-engine` (posiciones topocéntricas
 * reales). Coordenadas J2000 (RA en horas, Dec en grados): el error de
 * precesión 2000 → 2026 es ~0,3°, invisible a este nivel de render
 * (misma decisión documentada que en `cielo-extras.ts`).
 *
 * El color se deriva del índice B−V real de cada estrella (azul −0.3 …
 * rojo +2.0) con una rampa de cuerpo negro aproximada: Rígel azulada,
 * Betelgeuse y Antares anaranjadas, Capella amarilla.
 */

import {
  Body,
  Equator,
  Horizon,
  Illumination,
  Observer,
} from "astronomy-engine";
import type { Observador } from "./eclipse-engine";

/** Una entrada del catálogo: J2000 + magnitud V + índice de color B−V. */
export interface EstrellaCatalogo {
  nombre: string;
  /** Ascensión recta J2000 en horas. */
  ra: number;
  /** Declinación J2000 en grados. */
  dec: number;
  /** Magnitud visual aparente. */
  magnitud: number;
  /** Índice de color B−V (azul negativo, rojo positivo). */
  bv: number;
}

/**
 * Las ~50 estrellas más brillantes del cielo (mag V ≲ 2.1), con magnitud
 * e índice B−V reales. La visibilidad desde España y sobre el horizonte
 * se decide en tiempo de ejecución; el catálogo es el cielo entero.
 */
export const CATALOGO_CIELO_COMPLETO: EstrellaCatalogo[] = [
  { nombre: "Sirio", ra: 6.7525, dec: -16.7161, magnitud: -1.46, bv: 0.0 },
  { nombre: "Canopus", ra: 6.3992, dec: -52.6957, magnitud: -0.74, bv: 0.15 },
  { nombre: "Arturo", ra: 14.2612, dec: 19.1824, magnitud: -0.05, bv: 1.23 },
  { nombre: "Vega", ra: 18.6156, dec: 38.7837, magnitud: 0.03, bv: 0.0 },
  { nombre: "Capella", ra: 5.2782, dec: 45.998, magnitud: 0.08, bv: 0.8 },
  { nombre: "Rígel", ra: 5.2423, dec: -8.2017, magnitud: 0.13, bv: -0.03 },
  { nombre: "Proción", ra: 7.655, dec: 5.225, magnitud: 0.34, bv: 0.42 },
  { nombre: "Betelgeuse", ra: 5.9195, dec: 7.4071, magnitud: 0.5, bv: 1.85 },
  { nombre: "Achernar", ra: 1.6286, dec: -57.2367, magnitud: 0.46, bv: -0.19 },
  { nombre: "Altair", ra: 19.8464, dec: 8.8683, magnitud: 0.77, bv: 0.22 },
  { nombre: "Aldebarán", ra: 4.5987, dec: 16.5093, magnitud: 0.86, bv: 1.54 },
  { nombre: "Espiga", ra: 13.4199, dec: -11.1613, magnitud: 0.97, bv: -0.23 },
  { nombre: "Antares", ra: 16.4901, dec: -26.432, magnitud: 1.06, bv: 1.83 },
  { nombre: "Pólux", ra: 7.7553, dec: 28.0262, magnitud: 1.14, bv: 1.0 },
  { nombre: "Fomalhaut", ra: 22.9608, dec: -29.6222, magnitud: 1.16, bv: 0.09 },
  { nombre: "Deneb", ra: 20.6905, dec: 45.2803, magnitud: 1.25, bv: 0.09 },
  { nombre: "Régulo", ra: 10.1395, dec: 11.9672, magnitud: 1.4, bv: -0.11 },
  { nombre: "Adhara", ra: 6.9771, dec: -28.9721, magnitud: 1.5, bv: -0.21 },
  { nombre: "Cástor", ra: 7.5766, dec: 31.8883, magnitud: 1.58, bv: 0.03 },
  { nombre: "Shaula", ra: 17.5601, dec: -37.1038, magnitud: 1.63, bv: -0.22 },
  { nombre: "Bellatrix", ra: 5.4188, dec: 6.3497, magnitud: 1.64, bv: -0.22 },
  { nombre: "Elnath", ra: 5.4382, dec: 28.6075, magnitud: 1.65, bv: -0.13 },
  { nombre: "Alnilam", ra: 5.6036, dec: -1.2019, magnitud: 1.69, bv: -0.18 },
  { nombre: "Alnitak", ra: 5.6793, dec: -1.9426, magnitud: 1.77, bv: -0.2 },
  { nombre: "Alioth", ra: 12.9005, dec: 55.9598, magnitud: 1.77, bv: -0.02 },
  { nombre: "Dubhe", ra: 11.0621, dec: 61.7508, magnitud: 1.79, bv: 1.07 },
  { nombre: "Mirfak", ra: 3.4054, dec: 49.8612, magnitud: 1.8, bv: 0.48 },
  { nombre: "Wezen", ra: 7.1399, dec: -26.3932, magnitud: 1.84, bv: 0.68 },
  { nombre: "Kaus Australis", ra: 18.4029, dec: -34.3846, magnitud: 1.85, bv: -0.03 },
  { nombre: "Alkaid", ra: 13.7923, dec: 49.3133, magnitud: 1.86, bv: -0.19 },
  { nombre: "Sargas", ra: 17.622, dec: -42.9978, magnitud: 1.87, bv: 0.4 },
  { nombre: "Menkalinan", ra: 5.9921, dec: 44.9474, magnitud: 1.9, bv: 0.03 },
  { nombre: "Alhena", ra: 6.6285, dec: 16.3993, magnitud: 1.92, bv: 0.0 },
  { nombre: "Mirzam", ra: 6.3783, dec: -17.9559, magnitud: 1.98, bv: -0.23 },
  { nombre: "Alphard", ra: 9.4598, dec: -8.6586, magnitud: 1.98, bv: 1.44 },
  { nombre: "Polar", ra: 2.5303, dec: 89.2641, magnitud: 1.98, bv: 0.6 },
  { nombre: "Hamal", ra: 2.1196, dec: 23.4624, magnitud: 2.0, bv: 1.15 },
  { nombre: "Diphda", ra: 0.7265, dec: -17.9866, magnitud: 2.02, bv: 1.02 },
  { nombre: "Mizar", ra: 13.3988, dec: 54.9254, magnitud: 2.04, bv: 0.02 },
  { nombre: "Nunki", ra: 18.9211, dec: -26.2967, magnitud: 2.05, bv: -0.13 },
  { nombre: "Mirach", ra: 1.1622, dec: 35.6206, magnitud: 2.05, bv: 1.58 },
  { nombre: "Alpheratz", ra: 0.1398, dec: 29.0904, magnitud: 2.06, bv: -0.11 },
  { nombre: "Rasalhague", ra: 17.5822, dec: 12.5600, magnitud: 2.08, bv: 0.15 },
  { nombre: "Kochab", ra: 14.8451, dec: 74.1555, magnitud: 2.08, bv: 1.47 },
  { nombre: "Algieba", ra: 10.3329, dec: 19.8415, magnitud: 2.08, bv: 1.13 },
  { nombre: "Saiph", ra: 5.7959, dec: -9.6696, magnitud: 2.09, bv: -0.17 },
  { nombre: "Algol", ra: 3.1361, dec: 40.9556, magnitud: 2.12, bv: -0.05 },
  { nombre: "Denebola", ra: 11.8177, dec: 14.5721, magnitud: 2.14, bv: 0.09 },
  { nombre: "Mintaka", ra: 5.5334, dec: -0.2991, magnitud: 2.23, bv: -0.22 },
  { nombre: "Alphecca", ra: 15.5781, dec: 26.7147, magnitud: 2.23, bv: -0.02 },
  { nombre: "Sadr", ra: 20.3705, dec: 40.2567, magnitud: 2.23, bv: 0.68 },
  { nombre: "Eltanin", ra: 17.9434, dec: 51.4889, magnitud: 2.23, bv: 1.52 },
  { nombre: "Schedar", ra: 0.6751, dec: 56.5373, magnitud: 2.24, bv: 1.17 },
  { nombre: "Caph", ra: 0.1529, dec: 59.1498, magnitud: 2.27, bv: 0.34 },
];

/** Planetas visibles a simple vista cerca del Sol el 12-08-2026. */
const PLANETAS: Array<{ nombre: string; body: Body }> = [
  { nombre: "Venus", body: Body.Venus },
  { nombre: "Júpiter", body: Body.Jupiter },
  { nombre: "Mercurio", body: Body.Mercury },
];

/** Color RGB lineal [0,1] de una estrella. */
export type ColorEstrella = [number, number, number];

/** Rampa B−V → RGB (aproximación de cuerpo negro, blanco en ~0.3). */
const RAMPA_BV: Array<{ bv: number; rgb: ColorEstrella }> = [
  { bv: -0.3, rgb: [0.62, 0.75, 1.0] },
  { bv: 0.0, rgb: [0.8, 0.88, 1.0] },
  { bv: 0.3, rgb: [1.0, 0.98, 0.95] },
  { bv: 0.6, rgb: [1.0, 0.93, 0.84] },
  { bv: 1.0, rgb: [1.0, 0.85, 0.68] },
  { bv: 1.5, rgb: [1.0, 0.75, 0.52] },
  { bv: 2.0, rgb: [1.0, 0.62, 0.36] },
];

/**
 * Color RGB lineal [0,1] a partir del índice B−V real: azulado por debajo
 * de 0, blanco hacia 0.3 y cada vez más anaranjado hacia 2.0. Entrada
 * recortada al rango de la rampa.
 */
export function colorDesdeBV(bv: number): ColorEstrella {
  if (bv <= RAMPA_BV[0].bv) return RAMPA_BV[0].rgb;
  const ultima = RAMPA_BV[RAMPA_BV.length - 1];
  if (bv >= ultima.bv) return ultima.rgb;
  for (let i = 0; i < RAMPA_BV.length - 1; i++) {
    const a = RAMPA_BV[i];
    const b = RAMPA_BV[i + 1];
    if (bv <= b.bv) {
      const t = (bv - a.bv) / (b.bv - a.bv);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
      ];
    }
  }
  return ultima.rgb;
}

/**
 * Tamaño del punto en px (a escala 1) según la magnitud: flujo relativo
 * 10^(−0.4·m) comprimido con una raíz para que Sirio no sea un faro y las
 * de mag 2 sigan siendo visibles. Acotado a [1.1, 5].
 */
export function tamanoPunto(magnitud: number): number {
  const flujo = Math.pow(10, -0.4 * magnitud);
  return Math.min(5, Math.max(1.1, 2.1 * Math.pow(flujo, 0.25)));
}

/**
 * Umbral de brillo de cielo por debajo del cual empieza a verse un cuerpo
 * de magnitud `m`: los más brillantes emergen antes (Venus en plena
 * parcialidad; una estrella de mag 2 solo con el cielo casi apagado).
 * Decreciente con la magnitud, acotado a [0.02, 0.3].
 */
export function umbralAparicion(magnitud: number): number {
  return Math.min(0.3, Math.max(0.02, 0.12 - 0.035 * magnitud));
}

/**
 * Opacidad [0, 1] de un cuerpo de magnitud `m` con el cielo a un `brillo`
 * dado: 0 por encima de su umbral y rampa lineal hasta 1 con el cielo
 * apagado. La misma fórmula corre en el shader (por-frame, sin saltos).
 */
export function alfaAparicion(magnitud: number, brillo: number): number {
  const u = umbralAparicion(magnitud);
  return Math.min(1, Math.max(0, 1 - brillo / u));
}

/** Cuerpo del domo con posición real y atributos de render. */
export interface CuerpoDomo {
  nombre: string;
  tipo: "planeta" | "estrella";
  magnitud: number;
  /** Altitud sobre el horizonte (grados, con refracción). */
  altitud: number;
  /** Acimut en grados (0 = norte, 90 = este). */
  acimut: number;
  color: ColorEstrella;
  /** Tamaño del punto en px a escala 1. */
  tam: number;
  /** Umbral de brillo de aparición (el shader calcula el alfa por frame). */
  umbral: number;
}

/**
 * Posiciones alt-az reales de todo el domo (planetas + catálogo completo)
 * para un Observador en `t`. No filtra por visibilidad ni por brillo del
 * cielo: eso lo hace el llamante (terreno) y el shader (fundido).
 *
 * Coste: 3 × `Equator`+`Illumination` + ~55 × `Horizon`. Pensado para
 * llamarse ~1 vez por segundo simulado, no por frame (el llamante cachea).
 */
export function cuerposDomo(observador: Observador, t: Date): CuerpoDomo[] {
  const observer = new Observer(
    observador.lat,
    observador.lon,
    observador.elevacion ?? 0,
  );
  const cuerpos: CuerpoDomo[] = [];

  for (const { nombre, body } of PLANETAS) {
    const eq = Equator(body, t, observer, true, true);
    const hor = Horizon(t, observer, eq.ra, eq.dec, "normal");
    const magnitud = Illumination(body, t).mag;
    cuerpos.push({
      nombre,
      tipo: "planeta",
      magnitud,
      altitud: hor.altitude,
      acimut: hor.azimuth,
      color: [1, 0.98, 0.92],
      tam: tamanoPunto(magnitud),
      umbral: umbralAparicion(magnitud),
    });
  }

  for (const e of CATALOGO_CIELO_COMPLETO) {
    const hor = Horizon(t, observer, e.ra, e.dec, "normal");
    cuerpos.push({
      nombre: e.nombre,
      tipo: "estrella",
      magnitud: e.magnitud,
      altitud: hor.altitude,
      acimut: hor.azimuth,
      color: colorDesdeBV(e.bv),
      tam: tamanoPunto(e.magnitud),
      umbral: umbralAparicion(e.magnitud),
    });
  }

  return cuerpos;
}
