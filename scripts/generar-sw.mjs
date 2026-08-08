/**
 * Genera `public/sw.js` desde `scripts/sw.template.js` inyectando la
 * versión del build en VERSION (ver la nota de versionado en la plantilla).
 * Se ejecuta en predev/prebuild; `public/sw.js` es un artefacto de build
 * y está en .gitignore.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const version =
  (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 8) ||
  `local-${Date.now()}`;

const plantilla = readFileSync(join(raiz, "scripts", "sw.template.js"), "utf8");
writeFileSync(
  join(raiz, "public", "sw.js"),
  plantilla.replace('"__VERSION__"', JSON.stringify(version)),
);
console.error(`sw.js generado (VERSION=${version})`);
