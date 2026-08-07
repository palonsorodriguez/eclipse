/**
 * Genera `data/municipios.json` a partir del dataset abierto
 * "Municipalities - Spain" (georef-spain-municipio) de Opendatasoft.
 *
 * Fuente:    https://public.opendatasoft.com/explore/dataset/georef-spain-municipio/
 *            Datos derivados de la Base de Datos de Líneas Límite Jurisdiccionales
 *            (BDLJE) del Instituto Geográfico Nacional, distribuida por el CNIG
 *            (https://centrodedescargas.cnig.es/CentroDescargas/). Las coordenadas
 *            son el centroide del término municipal (ETRS89, compatible WGS84).
 * Licencia:  CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
 * Atribución: "Instituto Geográfico Nacional" (IGN/CNIG) — BDLJE CC-BY 4.0 ign.es.
 *            La atribución de cara al usuario va en la página de créditos.
 *
 * Transformación:
 *  1. Descarga el export JSON con los campos mun_name, prov_name y geo_point_2d.
 *  2. Excluye las entradas sin provincia ("Territorio no asociado a ninguna
 *     provincia"): son las plazas de soberanía (islotes), no municipios.
 *  3. Emite un array de { nombre, provincia, lat, lon } con 4 decimales
 *     (~11 m de precisión, de sobra para simular el eclipse) ordenado por nombre.
 *
 * Uso: npx tsx scripts/build-municipios.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL_EXPORT =
  "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-spain-municipio/exports/json?select=mun_name,prov_name,geo_point_2d&limit=-1";

const SIN_PROVINCIA = "Territorio no asociado a ninguna provincia";

interface RegistroFuente {
  mun_name: string;
  prov_name: string;
  geo_point_2d: { lat: number; lon: number };
}

interface Municipio {
  nombre: string;
  provincia: string;
  lat: number;
  lon: number;
}

const redondear4 = (n: number): number => Math.round(n * 10_000) / 10_000;

async function main(): Promise<void> {
  const respuesta = await fetch(URL_EXPORT);
  if (!respuesta.ok) {
    throw new Error(`Descarga fallida: ${respuesta.status} ${respuesta.statusText}`);
  }
  const registros = (await respuesta.json()) as RegistroFuente[];

  const municipios: Municipio[] = registros
    .filter((r) => r.prov_name !== SIN_PROVINCIA && r.mun_name && r.geo_point_2d)
    .map((r) => ({
      nombre: r.mun_name,
      provincia: r.prov_name,
      lat: redondear4(r.geo_point_2d.lat),
      lon: redondear4(r.geo_point_2d.lon),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const destino = join(raiz, "data", "municipios.json");
  mkdirSync(dirname(destino), { recursive: true });

  // Un municipio por línea: diffs legibles sin inflar el tamaño.
  const json = `[\n${municipios.map((m) => JSON.stringify(m)).join(",\n")}\n]\n`;
  writeFileSync(destino, json, "utf8");

  console.log(`Escritos ${municipios.length} municipios en ${destino}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
