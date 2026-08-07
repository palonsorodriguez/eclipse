/**
 * cielo-render — Lógica pura de la Vista Cielo (sin canvas, sin React).
 *
 * Responsabilidades:
 * - Proyección alt-az → coordenadas de canvas.
 * - Escalado de los discos de Sol y Luna (factor de zoom documentado abajo).
 * - Curva de brillo del cielo en función del Oscurecimiento.
 * - Paleta de colores del cielo según altitud solar y brillo.
 * - Utilidades de acimut (nombres de rumbos en español).
 *
 * ## Escalado de los discos (factor de zoom)
 *
 * El radio aparente real del Sol es ~0,26°. Con una franja de cielo de 30°
 * de altura, el disco solar real mediría ~8 px de diámetro en un canvas de
 * 540 px: invisible. Para que el disco sea protagonista aplicamos un factor
 * de zoom Z tal que su diámetro ocupe `fraccionDiscoSolar` (~1/6) de la
 * altura del canvas.
 *
 * El Sol se dibuja en su posición alt-az REAL proyectada. La Luna se coloca
 * relativa al Sol: su desplazamiento angular (Δacimut·cos(altitud), Δaltitud)
 * se multiplica por el MISMO factor Z, y ambos radios aparentes también.
 * Así la geometría relativa Sol–Luna (separación / radios) se conserva
 * exactamente y los contactos y el "mordisco" se ven en el instante correcto,
 * aunque la escena esté ampliada.
 */

import type { PosicionesSolLuna } from "./eclipse-engine";

const DEG2RAD = Math.PI / 180;

/** Configuración geométrica de la escena de la Vista Cielo. */
export interface ConfigEscena {
  /** Ancho lógico del canvas en px. */
  ancho: number;
  /** Alto lógico del canvas en px. */
  alto: number;
  /** Acimut (grados) que ocupa el centro horizontal del canvas. */
  acimutCentro: number;
  /** Altitud (grados) visible en el borde superior del canvas (~30°). */
  altitudMax: number;
  /**
   * Fracción de la altura del canvas a la que se sitúa la línea del
   * horizonte, medida desde arriba (p. ej. 0.86 → horizonte al 86%).
   */
  fraccionHorizonte: number;
  /**
   * Diámetro deseado del disco solar como fracción de la altura del canvas
   * (~1/6 para que sea protagonista).
   */
  fraccionDiscoSolar: number;
}

/** Configuración por defecto de la escena. */
export function configEscena(
  acimutCentro: number,
  ancho = 960,
  alto = 540,
): ConfigEscena {
  return {
    ancho,
    alto,
    acimutCentro,
    altitudMax: 30,
    fraccionHorizonte: 0.86,
    fraccionDiscoSolar: 1 / 6,
  };
}

/** Píxeles por grado (misma escala vertical y horizontal: cielo isótropo). */
export function pxPorGrado(cfg: ConfigEscena): number {
  return (cfg.alto * cfg.fraccionHorizonte) / cfg.altitudMax;
}

/** Coordenada Y (px) de la línea del horizonte. */
export function yHorizonte(cfg: ConfigEscena): number {
  return cfg.alto * cfg.fraccionHorizonte;
}

/** Diferencia de acimut `a - b` normalizada a (-180, 180]. */
export function deltaAcimut(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Punto en coordenadas de canvas (px, origen arriba-izquierda). */
export interface PuntoCanvas {
  x: number;
  y: number;
}

/**
 * Proyecta una dirección alt-az a coordenadas de canvas: proyección
 * cilíndrica simple centrada en `acimutCentro`, con el horizonte (alt 0)
 * en `yHorizonte(cfg)` y `altitudMax` en el borde superior.
 */
export function proyectarAltAz(
  altitud: number,
  acimut: number,
  cfg: ConfigEscena,
): PuntoCanvas {
  const ppg = pxPorGrado(cfg);
  return {
    x: cfg.ancho / 2 + deltaAcimut(acimut, cfg.acimutCentro) * ppg,
    y: yHorizonte(cfg) - altitud * ppg,
  };
}

/**
 * Factor de zoom Z de los discos: amplía el radio aparente real del Sol
 * hasta que su diámetro ocupe `fraccionDiscoSolar` de la altura del canvas.
 */
export function factorZoom(radioSolarGrados: number, cfg: ConfigEscena): number {
  const radioDeseadoPx = (cfg.alto * cfg.fraccionDiscoSolar) / 2;
  return radioDeseadoPx / (radioSolarGrados * pxPorGrado(cfg));
}

/** Disco (Sol o Luna) ya proyectado y escalado, en px de canvas. */
export interface DiscoEscena {
  x: number;
  y: number;
  radio: number;
}

/** Sol y Luna listos para dibujar. */
export interface SolLunaEscena {
  sol: DiscoEscena;
  luna: DiscoEscena;
  /** Factor de zoom aplicado (para depuración / rótulos). */
  zoom: number;
}

/**
 * Convierte las posiciones astronómicas en discos de canvas aplicando el
 * factor de zoom (ver cabecera del módulo). El Sol va en su posición real
 * proyectada; la Luna, desplazada desde el Sol por su offset angular
 * ampliado por el mismo zoom, de modo que la razón
 * `separación / radio solar` se conserva en píxeles.
 */
export function escenaSolLuna(
  pos: PosicionesSolLuna,
  cfg: ConfigEscena,
): SolLunaEscena {
  const ppg = pxPorGrado(cfg);
  const zoom = factorZoom(pos.sol.radioAparente, cfg);
  const sol = proyectarAltAz(pos.sol.altitud, pos.sol.acimut, cfg);

  // Offset angular Luna−Sol sobre la esfera celeste: el Δacimut se comprime
  // con cos(altitud) para que las distancias sean angulares verdaderas.
  const dAz =
    deltaAcimut(pos.luna.acimut, pos.sol.acimut) *
    Math.cos(pos.sol.altitud * DEG2RAD);
  const dAlt = pos.luna.altitud - pos.sol.altitud;

  return {
    sol: { x: sol.x, y: sol.y, radio: pos.sol.radioAparente * ppg * zoom },
    luna: {
      x: sol.x + dAz * ppg * zoom,
      y: sol.y - dAlt * ppg * zoom,
      radio: pos.luna.radioAparente * ppg * zoom,
    },
    zoom,
  };
}

/**
 * Brillo del cielo [0, 1] en función del Oscurecimiento [0, 1].
 *
 * Curva no lineal que imita la percepción durante un eclipse: la luz
 * apenas cambia hasta ~90% de Oscurecimiento y se desploma después.
 * Es la caída cuadrática `pow(1 − x, 2)` aplicada sobre `x = o⁴`, que
 * retrasa el desplome al tramo final:
 *
 *   o = 0    → 1        o = 0.9  → ≈ 0.12
 *   o = 0.5  → ≈ 0.88   o = 0.99 → ≈ 0.002
 *   o = 0.7  → ≈ 0.58   o = 1    → 0
 *
 * Monótona decreciente; exactamente 0 en la Totalidad.
 */
export function brilloCielo(obscuracion: number): number {
  const o = Math.min(1, Math.max(0, obscuracion));
  return Math.pow(1 - Math.pow(o, 4), 2);
}

/**
 * Brillo efectivo para el render. Fuera de la Totalidad se aplica un suelo
 * de penumbra (~0.05): un Observador SIN Totalidad (p. ej. Madrid, 99,9%)
 * queda en una penumbra extraña pero nunca en negro. Dentro de la
 * Totalidad el brillo es exactamente 0 (cielo azul-negro + corona).
 */
export function brilloEscena(
  obscuracion: number,
  enTotalidad: boolean,
): number {
  if (enTotalidad) return 0;
  return Math.max(brilloCielo(obscuracion), 0.05);
}

/** Color RGB como terna [r, g, b] en 0–255. */
export type RGB = [number, number, number];

/** Colores del gradiente vertical del cielo. */
export interface ColoresCielo {
  cenit: RGB;
  horizonte: RGB;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Cielo de Totalidad: azul-negro profundo. */
const CIELO_NOCHE: ColoresCielo = {
  cenit: [6, 8, 20],
  horizonte: [24, 26, 48],
};

/** Fotogramas clave de la paleta diurna por altitud solar (grados). */
const PALETA_DIA: Array<{ alt: number; colores: ColoresCielo }> = [
  { alt: 0, colores: { cenit: [46, 62, 110], horizonte: [222, 116, 72] } },
  { alt: 5, colores: { cenit: [58, 84, 145], horizonte: [242, 148, 84] } },
  { alt: 13, colores: { cenit: [72, 112, 178], horizonte: [248, 186, 116] } },
  { alt: 22, colores: { cenit: [66, 128, 200], horizonte: [178, 208, 236] } },
  { alt: 40, colores: { cenit: [58, 126, 205], horizonte: [168, 205, 238] } },
];

/** Paleta diurna interpolada por altitud solar (tonos dorados a 8–13°). */
export function paletaDia(altitudSolar: number): ColoresCielo {
  const claves = PALETA_DIA;
  if (altitudSolar <= claves[0].alt) return claves[0].colores;
  const ultima = claves[claves.length - 1];
  if (altitudSolar >= ultima.alt) return ultima.colores;
  for (let i = 0; i < claves.length - 1; i++) {
    const a = claves[i];
    const b = claves[i + 1];
    if (altitudSolar <= b.alt) {
      const t = (altitudSolar - a.alt) / (b.alt - a.alt);
      return {
        cenit: lerpRGB(a.colores.cenit, b.colores.cenit, t),
        horizonte: lerpRGB(a.colores.horizonte, b.colores.horizonte, t),
      };
    }
  }
  return ultima.colores;
}

/**
 * Colores del cielo: paleta diurna según altitud solar, fundida hacia el
 * cielo de Totalidad según el brillo (0 = Totalidad, 1 = día pleno).
 */
export function coloresCielo(
  altitudSolar: number,
  brillo: number,
): ColoresCielo {
  const dia = paletaDia(altitudSolar);
  const t = Math.min(1, Math.max(0, brillo));
  return {
    cenit: lerpRGB(CIELO_NOCHE.cenit, dia.cenit, t),
    horizonte: lerpRGB(CIELO_NOCHE.horizonte, dia.horizonte, t),
  };
}

/** Serializa un RGB a cadena CSS `rgb(r,g,b)`. */
export function css(c: RGB): string {
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}

/** Los 16 rumbos de la rosa de los vientos, en español. */
const RUMBOS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO",
] as const;

/**
 * Nombre del rumbo más próximo a un acimut (0 = N, 90 = E, 270 = O).
 * P. ej. 270 → "O", 292.5 → "ONO".
 */
export function nombreAcimut(acimut: number): string {
  const idx = Math.round((((acimut % 360) + 360) % 360) / 22.5) % 16;
  return RUMBOS[idx];
}

/**
 * Perfil genérico de colinas del horizonte: altura en px sobre la línea
 * del horizonte para una posición horizontal `x01` ∈ [0, 1]. Suma de senos
 * determinista — el mismo perfil en cada render.
 */
export function alturaColinas(x01: number, cfg: ConfigEscena): number {
  const hMax = cfg.alto * 0.05;
  const s =
    0.45 +
    0.3 * Math.sin(x01 * 5.1 + 0.7) +
    0.18 * Math.sin(x01 * 11.3 + 2.1) +
    0.07 * Math.sin(x01 * 23.7 + 4.9);
  return hMax * Math.max(0.12, s);
}
