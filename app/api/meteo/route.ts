/**
 * /api/meteo — proxy cacheado por Zonas de la previsión de nubosidad del
 * Observador (issue #69).
 *
 * Por qué existe: el límite de Open-Meteo es por IP, y el 12-08-2026
 * miles de usuarios en la Franja compartirán IP de operadora móvil
 * (CGNAT) — el cupo compartido podía agotarse justo el día del eclipse.
 * La previsión de una Zona es idéntica para todos sus visitantes: se
 * pide UNA vez desde Vercel y se comparte.
 *
 * Capas de caché (dos usuarios de la misma zona → una llamada upstream):
 * 1. El cliente normaliza la URL a la clave de zona (rejilla de 0,25°,
 *    `urlApiMeteo`) y esta ruta redondea además internamente (`claveZona`)
 *    por si alguien llama con coordenadas crudas. Con la URL normalizada,
 *    el edge de Vercel sirve la respuesta con
 *    `s-maxage=1800, stale-while-revalidate=3600` sin ejecutar la función.
 * 2. Si la función llega a ejecutarse (edge frío, otra región), el fetch
 *    upstream lleva `next: { revalidate: 1800 }`: la Data Cache comparte
 *    el cuerpo entre invocaciones → una llamada a Open-Meteo por zona
 *    cada 30 min para todo el planeta.
 *
 * `generado` sella cuándo se construyó la respuesta: si llega con minutos
 * de antigüedad, la copia viene de una caché (edge o service worker) —
 * depuración de frescura.
 *
 * La elevación (Open-Meteo /v1/elevation, lib/horizonte.ts) NO entra en
 * este proxy: cada municipio pide un perfil único, así que `s-maxage` no
 * deduplicaría nada entre usuarios; ya tiene caché persistente en el
 * cliente (localStorage por municipio, issue #61) y su límite upstream es
 * más duro — proxificarla solo concentraría ese límite en la IP única de
 * Vercel, empeorándolo.
 *
 * Errores: el aviso de límite de Open-Meteo llega como HTTP 200 con
 * `error: true`; aquí se convierte en 502 con `no-store` para que ni el
 * edge ni el SW lo retengan. Sin AbortSignal en el fetch upstream: el
 * timeout lo pone el cliente sobre la petición completa al proxy
 * (TIMEOUT_METEO_MS), y un fetch abortable puede quedar excluido de la
 * Data Cache.
 */

import {
  CACHE_CONTROL_METEO,
  claveZona,
  fetchHorasOpenMeteo,
  REVALIDATE_METEO_S,
} from "@/lib/meteo";

/**
 * Nunca prerenderizar en build: la previsión debe generarse (y cachearse)
 * en runtime, no congelarse en el deploy.
 */
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (
    !params.get("lat") ||
    !params.get("lon") ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return Response.json(
      { error: "Parámetros lat/lon inválidos" },
      { status: 400, headers: SIN_CACHE },
    );
  }

  const zona = claveZona(lat, lon);
  try {
    const horas = await fetchHorasOpenMeteo(zona.lat, zona.lon, {
      next: { revalidate: REVALIDATE_METEO_S },
    });
    return Response.json(
      { zona, generado: new Date().toISOString(), horas },
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
      { status: 502, headers: SIN_CACHE },
    );
  }
}
