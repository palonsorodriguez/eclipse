/**
 * copy-maplibre-worker — copia el worker de MapLibre GL a `public/vendor/`.
 *
 * Por qué: MapLibre resuelve su Web Worker con
 * `new URL("./maplibre-gl-worker.mjs", import.meta.url)`, un patrón que
 * Turbopack (Next 16) no reescribe al empaquetar: en producción la
 * petición acaba en un 404 y el mapa se queda sin teselas. La Vista Mapa
 * fija `setWorkerUrl("/vendor/maplibre-gl/maplibre-gl-worker.mjs")`, y
 * este script deja ahí el worker y el módulo compartido que importa.
 *
 * Se ejecuta automáticamente vía `predev`/`prebuild` (package.json).
 * `public/vendor/` está en .gitignore: se regenera desde node_modules y
 * así no puede quedar desincronizado con la versión instalada.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origen = join(raiz, "node_modules", "maplibre-gl", "dist");
const destino = join(raiz, "public", "vendor", "maplibre-gl");

mkdirSync(destino, { recursive: true });
// El worker importa "./maplibre-gl-shared.mjs": deben viajar juntos.
for (const fichero of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(origen, fichero), join(destino, fichero));
}
console.error(`maplibre worker copiado a public/vendor/maplibre-gl/`);
