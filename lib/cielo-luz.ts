/**
 * cielo-luz — Lógica pura de la luz de la Vista Cielo hiperrealista
 * (issue #39): curvas de luminancia y acoplamientos que el shader WebGL
 * consume como uniformes.
 *
 * Sin canvas, sin WebGL y sin React: funciones deterministas y testeables.
 * La curva base de brillo del cielo sigue viviendo en `cielo-render.ts`
 * (`brilloCielo`/`brilloEscena`); aquí van los acoplamientos nuevos:
 *
 * - Luna–cielo: la Luna nunca "aparece de golpe" porque su luminancia es
 *   siempre una fracción de la del cielo tras ella.
 * - Extinción atmosférica: con el Sol bajo (Baleares, ~2°) la corona y el
 *   halo amarillean y se apagan por abajo.
 * - Anillo crepuscular de 360°, cromosfera de C2/C3 y fundido de la corona.
 * - Calidad adaptativa: decisión pura de escala de render según el coste
 *   medido por frame.
 * - Perfil de colinas periódico en acimut (el terreno del domo completo).
 */

/** Color RGB lineal como terna [r, g, b] en [0, 1]. */
export type RGBLineal = [number, number, number];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Factor de luminancia de la Luna respecto al cielo que tiene detrás:
 * el disco lunar se pinta como `cielo_sin_sol × factorLuna(brillo)`, de
 * modo que contra cielo despejado es casi invisible (factor ≈ 0.93 de día)
 * y solo se silueta contra el Sol, el halo o la corona. Al apagarse el
 * cielo el contraste crece (factor baja hasta ≈ 0.28): en la Totalidad la
 * Luna es un agujero casi negro contra la corona, y aun así se funde con
 * la oscuridad igual que en la realidad, sin borde duro jamás.
 *
 * Monótona creciente en el brillo, acotada en [0.28, 1]: con el cielo
 * pleno el factor es exactamente 1 (la Luna nueva es indistinguible del
 * cielo, como antes de C1 en la realidad).
 */
export function factorLuna(brillo: number): number {
  return lerp(0.28, 1, clamp01(brillo));
}

/**
 * Tinte de extinción atmosférica para la fotosfera, el halo y la corona
 * según la altitud solar (grados). A 20° o más no tiñe (blanco); hacia el
 * horizonte la dispersión Rayleigh roba azul y luego verde: a ~2°
 * (Baleares) la corona amarillea con claridad y a 0° es naranja rojiza.
 *
 * r es constante 1; g y b decrecen monótonamente al bajar la altitud.
 */
export function tinteExtincion(altitudSolar: number): RGBLineal {
  const claves: Array<{ alt: number; g: number; b: number }> = [
    { alt: 0, g: 0.5, b: 0.26 },
    { alt: 2, g: 0.68, b: 0.42 },
    { alt: 6, g: 0.84, b: 0.66 },
    { alt: 12, g: 0.94, b: 0.86 },
    { alt: 20, g: 1, b: 1 },
  ];
  if (altitudSolar <= claves[0].alt) return [1, claves[0].g, claves[0].b];
  const ultima = claves[claves.length - 1];
  if (altitudSolar >= ultima.alt) return [1, 1, 1];
  for (let i = 0; i < claves.length - 1; i++) {
    const a = claves[i];
    const b = claves[i + 1];
    if (altitudSolar <= b.alt) {
      const t = (altitudSolar - a.alt) / (b.alt - a.alt);
      return [1, lerp(a.g, b.g, t), lerp(a.b, b.b, t)];
    }
  }
  return [1, 1, 1];
}

/**
 * Gradiente vertical de extinción sobre la corona [0, 1]: cuánto se apaga
 * su mitad inferior por atravesar más atmósfera que la superior. 0 con el
 * Sol alto (≥ 15°: la diferencia de masa de aire entre bordes es
 * despreciable) y crece al bajar: con el Sol a 2° la parte baja de la
 * corona se comprime visualmente porque pierde hasta ~55% de luz.
 */
export function gradienteExtincion(altitudSolar: number): number {
  if (altitudSolar >= 15) return 0;
  if (altitudSolar <= 1) return 0.55;
  return 0.55 * (1 - (altitudSolar - 1) / 14);
}

/**
 * Intensidad [0, 1] del anillo crepuscular de 360°: la luz del día fuera
 * de la umbra, visible pegada al horizonte cuando el cielo local se apaga.
 * 0 con brillo ≥ 0.12, rampa lineal hasta 1 con el cielo apagado del todo
 * (en Totalidad vale exactamente 1).
 */
export function intensidadAnillo360(
  brillo: number,
  enTotalidad: boolean,
): number {
  if (enTotalidad) return 1;
  return clamp01(1 - brillo / 0.12);
}

/**
 * Fundido de la corona [0, 1]: invisible hasta la parcialidad profunda
 * (brillo ≥ 0.01), aparece gradualmente en los últimos segundos antes de
 * C2 y luce plena en la Totalidad. La misma rampa gobierna su salida tras
 * C3: jamás un "pop".
 */
export function alfaCorona(brillo: number, enTotalidad: boolean): number {
  if (enTotalidad) return 1;
  return clamp01(1 - brillo / 0.01);
}

/**
 * Intensidad [0, 1] de la cromosfera rosada en el limbo: visible en una
 * ventana de ±8 s alrededor de C2 y C3, tanto por fuera (últimos segundos
 * de parcialidad) como por dentro (primeros segundos de Totalidad, cuando
 * la Luna aún no ha cubierto la cromosfera del borde de contacto).
 * 0 si el Observador no tiene Totalidad.
 */
export function intensidadCromosfera(
  tMs: number,
  c2Ms: number | null,
  c3Ms: number | null,
): number {
  if (c2Ms === null || c3Ms === null) return 0;
  const VENTANA_MS = 8000;
  const d = Math.min(Math.abs(tMs - c2Ms), Math.abs(tMs - c3Ms));
  return clamp01(1 - d / VENTANA_MS);
}

/**
 * Luz ambiente del terreno como RGB lineal: de día el suelo es una silueta
 * a contraluz (poca luz, cálida por el atardecer); durante la Totalidad
 * queda en penumbra fría (~2 lux, azulada) — la dominante fría de las
 * fotos de referencia. Interpola por el brillo del cielo.
 */
export function luzAmbiente(brillo: number): RGBLineal {
  const b = clamp01(brillo);
  // Totalidad: azul grisáceo tenue. Día: ámbar tenue de contraluz.
  return [
    lerp(0.03, 0.16, b),
    lerp(0.045, 0.14, b),
    lerp(0.08, 0.12, b),
  ];
}

/** Escalas de render admitidas por la calidad adaptativa. */
export const ESCALAS_CALIDAD = [0.5, 0.75, 1] as const;
export type EscalaCalidad = (typeof ESCALAS_CALIDAD)[number];

/**
 * Calidad adaptativa: decide la escala de render siguiente a partir del
 * coste medio por frame (media móvil, en ms). Por encima de ~24 ms
 * (no llegamos a 45 fps) baja un escalón; por debajo de ~14 ms con margen
 * sobrado sube uno. La banda muerta entre ambos evita oscilar.
 */
export function ajustarCalidad(
  emaFrameMs: number,
  escala: EscalaCalidad,
): EscalaCalidad {
  const i = ESCALAS_CALIDAD.indexOf(escala);
  if (emaFrameMs > 24 && i > 0) return ESCALAS_CALIDAD[i - 1];
  if (emaFrameMs < 14 && i < ESCALAS_CALIDAD.length - 1) {
    return ESCALAS_CALIDAD[i + 1];
  }
  return escala;
}

/**
 * Capas del terreno, de lejos a cerca: amplitud del perfil (grados de
 * altitud), parallax (>1 = se desplaza más al panear, como lo cercano) y
 * fase. El shader replica exactamente estas constantes.
 */
export const CAPAS_TERRENO = [
  { amplitud: 1.5, parallax: 1.0, fase: 0.0 },
  { amplitud: 2.6, parallax: 1.045, fase: 2.1 },
  { amplitud: 3.8, parallax: 1.09, fase: 4.4 },
] as const;

/**
 * Altura (grados de altitud) de la silueta de una capa de terreno en un
 * acimut dado. Suma de senos con armónicos enteros del círculo completo:
 * el perfil es periódico en 360° (el paneo no encuentra costuras) y
 * determinista. `capa` indexa {@link CAPAS_TERRENO}.
 */
export function alturaTerreno(acimut: number, capa: number): number {
  const { amplitud, fase } = CAPAS_TERRENO[capa];
  const a = (acimut * Math.PI) / 180;
  const s =
    0.42 +
    0.3 * Math.sin(7 * a + fase) +
    0.19 * Math.sin(17 * a + fase * 2.3) +
    0.09 * Math.sin(31 * a + fase * 3.7);
  return amplitud * Math.max(0.06, s);
}

/**
 * Altitud (grados) por debajo de la cual una estrella queda tras alguna
 * capa de terreno en ese acimut: el máximo de las siluetas. Para filtrar
 * estrellas en CPU antes de subirlas al buffer.
 */
export function altitudMinimaVisible(acimut: number): number {
  let h = 0;
  for (let capa = 0; capa < CAPAS_TERRENO.length; capa++) {
    h = Math.max(h, alturaTerreno(acimut, capa));
  }
  return h;
}
