/**
 * Genera los iconos PWA (`public/iconos/*.png`) rasterizando un SVG sencillo:
 * disco negro con corona dorada sobre fondo #0b0d17.
 *
 * Los PNG resultantes se versionan en el repo; este script solo hace falta
 * si se quiere regenerarlos (cambio de diseño). `sharp` es devDependency.
 *
 *   node scripts/generar-iconos.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const DESTINO = path.join(import.meta.dirname, "..", "public", "iconos");

/**
 * Icono del eclipse: disco negro con corona dorada sobre #0b0d17.
 *
 * `escala` controla el tamaño del motivo respecto al lienzo: los iconos
 * maskable exigen que el contenido quepa en el círculo seguro interior
 * (~80 % del lado), así que se dibuja más pequeño.
 */
function svgEclipse(escala) {
  const radioCorona = 38 * escala;
  const radioHalo = 46 * escala;
  const radioDisco = 30 * escala;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="corona" cx="50%" cy="50%" r="50%">
      <stop offset="55%" stop-color="#f5c542" stop-opacity="1"/>
      <stop offset="78%" stop-color="#e8a820" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#e8a820" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" fill="#0b0d17"/>
  <circle cx="50" cy="50" r="${radioHalo}" fill="url(#corona)"/>
  <circle cx="50" cy="50" r="${radioCorona}" fill="#f5c542"/>
  <circle cx="50" cy="50" r="${radioDisco}" fill="#05060c"/>
</svg>`;
}

const ICONOS = [
  { fichero: "icono-192.png", tamano: 192, escala: 1 },
  { fichero: "icono-512.png", tamano: 512, escala: 1 },
  { fichero: "icono-maskable-192.png", tamano: 192, escala: 0.78 },
  { fichero: "icono-maskable-512.png", tamano: 512, escala: 0.78 },
];

await mkdir(DESTINO, { recursive: true });
for (const { fichero, tamano, escala } of ICONOS) {
  await sharp(Buffer.from(svgEclipse(escala)))
    .resize(tamano, tamano)
    .png()
    .toFile(path.join(DESTINO, fichero));
  console.log(`✓ ${fichero} (${tamano}×${tamano})`);
}
