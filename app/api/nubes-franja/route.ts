/**
 * /api/nubes-franja — la capa de nubes de la Vista Mapa por proxy
 * (issue #69): la rejilla de 55 puntos sobre la Franja de totalidad es
 * idéntica para todos los usuarios, así que se pide a Open-Meteo UNA vez
 * cada 30 min EN TOTAL y se comparte.
 *
 * Mismo esquema de caché que /api/meteo (ver su cabecera para el
 * razonamiento CGNAT completo): el edge de Vercel sirve la respuesta con
 * `s-maxage=1800, stale-while-revalidate=3600` sin ejecutar la función, y
 * el fetch upstream lleva `next: { revalidate: 1800 }` (Data Cache) para
 * las ejecuciones que lleguen a producirse. Aquí ni siquiera hay
 * parámetros: una sola URL, una sola entrada de caché. `generado` sella
 * cuándo se construyó la respuesta (depuración de frescura).
 *
 * La rejilla vive en el servidor: se deriva de
 * `public/geodata/banda-totalidad.geojson` leído del filesystem
 * (next.config.ts lo incluye en el bundle de la función con
 * `outputFileTracingIncludes`). Los errores upstream responden 502 con
 * `no-store` para que ninguna caché los retenga.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BandaTotalidadGeoJSON } from "@/lib/geodata";
import { CACHE_CONTROL_METEO, REVALIDATE_METEO_S } from "@/lib/meteo";
import {
  fetchNubesFranja,
  puntosMuestreo,
  type Coordenada,
} from "@/lib/meteo-mapa";

/**
 * Nunca prerenderizar en build: la previsión debe generarse (y cachearse)
 * en runtime, no congelarse en el deploy.
 */
export const dynamic = "force-dynamic";

let rejillaCacheada: Coordenada[] | null = null;

/** La rejilla de muestreo, calculada una vez por instancia de la función. */
async function rejillaFranja(): Promise<Coordenada[]> {
  if (!rejillaCacheada) {
    const ruta = path.join(
      process.cwd(),
      "public",
      "geodata",
      "banda-totalidad.geojson",
    );
    const banda = JSON.parse(
      await readFile(ruta, "utf8"),
    ) as BandaTotalidadGeoJSON;
    rejillaCacheada = puntosMuestreo(banda);
  }
  return rejillaCacheada;
}

export async function GET(): Promise<Response> {
  try {
    const puntos = await fetchNubesFranja(await rejillaFranja(), {
      next: { revalidate: REVALIDATE_METEO_S },
    });
    return Response.json(
      { generado: new Date().toISOString(), puntos },
      { headers: { "Cache-Control": CACHE_CONTROL_METEO } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Fallo consultando Open-Meteo",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
