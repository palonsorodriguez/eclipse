/**
 * generar-corona — deriva el mapa de luminancia de la corona solar que usa
 * el shader de la Vista Cielo (`lib/cielo-gl.ts`) a partir de una fotografía
 * real, y lo emite versionado en `public/texturas/corona.png`.
 *
 * ## Fuente y licencia
 *
 * "2024 Total Solar Eclipse Corona" © Brucewaters, CC BY 4.0
 * https://commons.wikimedia.org/wiki/File:2024_Total_Solar_Eclipse_Corona.jpg
 * (HDR de 18 exposiciones del eclipse total del 8-4-2024; máximo solar,
 * la morfología de corona correcta para 2026, también cerca del máximo).
 * La atribución obligatoria está en la página /info de la app.
 *
 * ## Derivación (documentada para que sea reproducible)
 *
 * 1. Descarga el original (3685×2082) de Wikimedia Commons.
 * 2. Recorta un cuadrado de 1900×1900 centrado en el disco lunar. El centro
 *    (1857, 951) y el radio del limbo (~425 px) se midieron sobre el
 *    original: centroide de los píxeles brillantes y salto de luminancia
 *    del perfil radial (lum. media pasa de ~6 a ~85 entre r=390 y r=450).
 * 3. Escala a 1024×1024 y convierte a luminancia (un solo canal).
 * 4. Resta el suelo de ruido del cielo de fondo y reescala.
 * 5. Enmascara el disco lunar (rampa suave en el limbo): el shader dibuja
 *    su propia Luna y el disco de la foto no debe ensuciar el borde.
 * 6. Aplica una ventana radial que funde a 0 hacia el borde del recorte,
 *    para que el shader pueda muestrear fuera sin costuras.
 *
 * El resultado es un PNG en escala de grises (mapa de luminancia): el
 * tinte, la caída ~1/r^2.5, la rotación lenta y el ruido animado los aplica
 * el shader en tiempo real.
 *
 * Uso: `node scripts/generar-corona.mjs` (sharp ya es devDependency).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

const URL_ORIGEN =
  "https://upload.wikimedia.org/wikipedia/commons/d/dd/2024_Total_Solar_Eclipse_Corona.jpg";

/** Centro del disco lunar medido sobre el original (px). */
const CENTRO_X = 1857;
const CENTRO_Y = 951;
/** Radio del limbo lunar medido sobre el original (px). */
const RADIO_LUNA = 425;
/** Medio lado del recorte cuadrado (limitado por el borde superior). */
const MEDIO_LADO = 950;
/** Lado de la textura final. */
const LADO = 1024;
/**
 * Fracción del medio lado a la que queda el limbo lunar en la textura:
 * el shader la necesita para escalar el muestreo (RADIO_LUNA / MEDIO_LADO).
 * Exportada aquí como constante documental; el valor vive también en
 * `lib/cielo-gl.ts` como FRACCION_LIMBO_CORONA.
 */
const FRACCION_LIMBO = RADIO_LUNA / MEDIO_LADO; // ≈ 0.447

const salida = join(import.meta.dirname, "..", "public", "texturas", "corona.png");

async function descargar() {
  console.log("Descargando", URL_ORIGEN);
  const res = await fetch(URL_ORIGEN, {
    headers: { "user-agent": "eclipse-simulador/1.0 (generar-corona.mjs)" },
  });
  if (!res.ok) throw new Error(`Descarga fallida: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const original = await descargar();

// 2–3. Recorte centrado en la Luna, escala y luminancia.
const { data } = await sharp(original)
  .extract({
    left: CENTRO_X - MEDIO_LADO,
    top: CENTRO_Y - MEDIO_LADO,
    width: MEDIO_LADO * 2,
    height: MEDIO_LADO * 2,
  })
  .resize(LADO, LADO)
  .grayscale()
  .raw()
  .toBuffer({ resolveWithObject: true });

// 4–6. Suelo de ruido, máscara lunar y ventana radial, por píxel.
const SUELO = 5; // nivel de cielo de fondo del original (0–255)
const centro = (LADO - 1) / 2;
const rLimbo = FRACCION_LIMBO * (LADO / 2);
const suavizado = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const pixeles = Buffer.alloc(LADO * LADO);
for (let y = 0; y < LADO; y++) {
  for (let x = 0; x < LADO; x++) {
    const i = y * LADO + x;
    const r = Math.hypot(x - centro, y - centro) / (LADO / 2);
    // 4. Resta el suelo y reescala a [0, 255].
    let v = Math.max(0, data[i] - SUELO) * (255 / (255 - SUELO));
    // 5. Máscara del disco lunar: 0 dentro, rampa suave sobre el limbo.
    v *= suavizado(rLimbo * 0.97, rLimbo * 1.05, r * (LADO / 2));
    // 6. Ventana radial: funde a 0 entre r=0.86 y r=1 (y las esquinas).
    v *= 1 - suavizado(0.86, 1.0, r);
    pixeles[i] = Math.round(Math.min(255, v));
  }
}

await mkdir(dirname(salida), { recursive: true });
const png = await sharp(pixeles, {
  raw: { width: LADO, height: LADO, channels: 1 },
})
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(salida, png);

console.log(
  `Escrito ${salida} (${(png.length / 1024).toFixed(0)} KB, ` +
    `${LADO}×${LADO}, limbo lunar en r=${FRACCION_LIMBO.toFixed(3)})`,
);
