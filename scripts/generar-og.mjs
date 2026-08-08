/**
 * Genera la tarjeta Open Graph (`public/og.png`, 1200×630) rasterizando un
 * SVG con sharp: disco eclipsado con corona dorada sobre #0b0d17 + título,
 * el mismo motivo que los iconos PWA (`scripts/generar-iconos.mjs`).
 * Sin servicios externos: todo local y determinista.
 *
 * El PNG resultante se versiona en el repo; este script solo hace falta
 * si se quiere regenerarlo (cambio de diseño). `sharp` es devDependency.
 *
 *   node scripts/generar-og.mjs
 */
import path from "node:path";
import sharp from "sharp";

const DESTINO = path.join(import.meta.dirname, "..", "public", "og.png");

const ANCHO = 1200;
const ALTO = 630;

// Estrellas tenues, deterministas (nada de Math.random: el PNG versionado
// no debe cambiar entre ejecuciones).
const ESTRELLAS = [
  [90, 80, 2], [230, 190, 1.5], [150, 420, 2], [320, 540, 1.5],
  [500, 90, 1.5], [660, 500, 2], [820, 70, 1.5], [960, 180, 2],
  [1100, 90, 1.5], [1130, 400, 2], [1020, 560, 1.5], [720, 580, 1.5],
  [420, 300, 1.2], [880, 320, 1.2], [60, 560, 1.5], [580, 40, 1.2],
].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#dcd9e8" opacity="0.5"/>`)
  .join("\n  ");

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">
  <defs>
    <radialGradient id="corona" cx="50%" cy="50%" r="50%">
      <stop offset="55%" stop-color="#f5c542" stop-opacity="1"/>
      <stop offset="78%" stop-color="#e8a820" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#e8a820" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${ANCHO}" height="${ALTO}" fill="#0b0d17"/>
  ${ESTRELLAS}
  <!-- Disco eclipsado con corona, centrado en el tercio izquierdo -->
  <circle cx="330" cy="315" r="230" fill="url(#corona)"/>
  <circle cx="330" cy="315" r="190" fill="#f5c542"/>
  <circle cx="330" cy="315" r="150" fill="#05060c"/>
  <!-- Título -->
  <g fill="#f2efe6" font-family="Segoe UI, Arial, sans-serif" font-weight="700" text-anchor="start">
    <text x="600" y="248" font-size="50">¿Cómo se verá</text>
    <text x="600" y="314" font-size="50">el eclipse del <tspan fill="#f5c542">12-08-2026</tspan></text>
    <text x="600" y="380" font-size="50">desde tu municipio?</text>
  </g>
  <text x="600" y="448" font-size="28" fill="#dcd9e8" opacity="0.75" font-family="Segoe UI, Arial, sans-serif">
    Simulador del eclipse solar total · España
  </text>
</svg>`;

await sharp(Buffer.from(SVG)).png().toFile(DESTINO);
console.log(`✓ og.png (${ANCHO}×${ALTO})`);
