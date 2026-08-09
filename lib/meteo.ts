/**
 * meteo — Previsión de nubosidad para la tarde del eclipse (12-08-2026)
 * en un punto lat/lon, servida por el proxy propio `/api/meteo` (#69).
 *
 * El navegador ya NO habla con api.open-meteo.com para la previsión: el
 * límite de Open-Meteo es por IP y el 12-08 miles de usuarios en la franja
 * compartirán IP de operadora móvil (CGNAT) — el cupo compartido podía
 * agotarse justo el día del eclipse. El proxy pide la previsión desde
 * Vercel una vez por Zona (rejilla de {@link TAMANO_ZONA_GRADOS}°) cada
 * 30 min y el edge la comparte entre todos los visitantes de la zona.
 *
 * Reparto de responsabilidades:
 * - Lógica pura (clave de zona, clasificación del veredicto): testeable
 *   sin mocks.
 * - Parsing del formato Open-Meteo: vive en el SERVIDOR
 *   ({@link fetchHorasOpenMeteo}, usada por `app/api/meteo/route.ts`).
 *   Decisión (issue #69, punto 3): parseando en el servidor la respuesta
 *   del proxy queda pequeña y estable (horas + sello `generado`), el
 *   cliente no depende del formato de Open-Meteo y el manejo del aviso de
 *   límite (HTTP 200 + `error: true`) queda donde puede evitar cachearlo.
 * - Acceso de red del cliente ({@link fetchPrevisionEclipse}): pide
 *   `/api/meteo` con el timeout de 10 s y el manejo de error de siempre;
 *   el veredicto se clasifica en el cliente con la lógica pura.
 *
 * Horas en hora local peninsular (Europe/Madrid): la API ya devuelve las
 * horas en esa zona gracias al parámetro `timezone`.
 */

/** Fecha del eclipse en formato ISO (YYYY-MM-DD), hora local peninsular. */
export const FECHA_ECLIPSE = "2026-08-12";

/**
 * Ventana horaria local (Europe/Madrid) que cubre el eclipse: de 19:00
 * (antes de C1 en toda España) a 22:00 (después de C4 y del ocaso).
 */
export const HORAS_ECLIPSE = ["19:00", "20:00", "21:00", "22:00"] as const;

/** Nubosidad prevista para una hora local concreta del día del eclipse. */
export interface NubosidadHora {
  /** Hora local Europe/Madrid en formato "HH:MM", p. ej. "20:00". */
  hora: string;
  /** Nubosidad total en % [0, 100]. */
  total: number;
  /** Nubosidad baja (hasta ~3 km) en % [0, 100]. */
  baja: number;
  /** Nubosidad media (~3–8 km) en % [0, 100]. */
  media: number;
  /** Nubosidad alta (cirros, >8 km) en % [0, 100]. */
  alta: number;
}

/** Clave estable del veredicto meteorológico, de mejor a peor. */
export type ClaveVeredicto =
  | "despejado"
  | "nubes-y-claros"
  | "nubes-altas"
  | "cubierto";

/** Veredicto meteorológico simple para el día del eclipse. */
export interface Veredicto {
  clave: ClaveVeredicto;
  /** Texto listo para mostrar en la UI, con emoji. */
  texto: string;
}

const TEXTOS: Record<ClaveVeredicto, string> = {
  despejado: "☀️ Despejado — ¡a disfrutarlo!",
  "nubes-y-claros": "🌤️ Nubes y claros — hay opciones",
  "nubes-altas": "🌥️ Nubes altas — el eclipse puede intuirse",
  cubierto: "☁️ Cubierto — busca otro sitio (mira la Vista Mapa)",
};

function promedio(valores: number[]): number {
  return valores.reduce((suma, v) => suma + v, 0) / valores.length;
}

/**
 * Clasifica la previsión de la ventana del eclipse en un veredicto simple,
 * a partir de la nubosidad media de las horas recibidas:
 *
 * - total < 25 % → `despejado`
 * - 25–60 %      → `nubes-y-claros`
 * - > 60 % con la capa alta dominante → `nubes-altas` (los cirros dejan
 *   intuir el disco solar)
 * - > 60 % con bajas/medias dominantes → `cubierto`
 *
 * La capa alta "domina" cuando su promedio supera al de la capa baja y al
 * de la media.
 *
 * @param horas - Previsión horaria de la ventana del eclipse (no vacía).
 */
export function clasificarVeredicto(horas: readonly NubosidadHora[]): Veredicto {
  if (horas.length === 0) {
    throw new Error("clasificarVeredicto necesita al menos una hora de previsión");
  }

  const total = promedio(horas.map((h) => h.total));
  const baja = promedio(horas.map((h) => h.baja));
  const media = promedio(horas.map((h) => h.media));
  const alta = promedio(horas.map((h) => h.alta));

  let clave: ClaveVeredicto;
  if (total < 25) {
    clave = "despejado";
  } else if (total <= 60) {
    clave = "nubes-y-claros";
  } else if (alta > baja && alta > media) {
    clave = "nubes-altas";
  } else {
    clave = "cubierto";
  }

  return { clave, texto: TEXTOS[clave] };
}

// ---------------------------------------------------------------------------
// Clave de zona (lógica pura, compartida por cliente y servidor)
// ---------------------------------------------------------------------------

/**
 * Tamaño de la Zona meteorológica, en grados: la previsión se pide para
 * el punto de una rejilla de 0,25° (~25 km), no para el municipio exacto.
 * A esa escala la previsión de nubosidad no cambia de forma útil, y así
 * todos los municipios de una zona comparten URL del proxy (misma entrada
 * en la caché del edge y en la del SW) y una única llamada upstream cada
 * 30 min.
 */
export const TAMANO_ZONA_GRADOS = 0.25;

/**
 * Clave de zona de un punto: lat/lon redondeadas al nodo más cercano de
 * la rejilla de {@link TAMANO_ZONA_GRADOS}°. El `|| 0` evita el `-0` de
 * IEEE 754 en puntos justo al oeste/sur de un nodo cero.
 */
export function claveZona(
  lat: number,
  lon: number,
): { lat: number; lon: number } {
  const redondear = (v: number) =>
    Math.round(v / TAMANO_ZONA_GRADOS) * TAMANO_ZONA_GRADOS || 0;
  return { lat: redondear(lat), lon: redondear(lon) };
}

// ---------------------------------------------------------------------------
// Proxy /api/meteo: constantes compartidas por las rutas y el cliente
// ---------------------------------------------------------------------------

/** Ruta del proxy de la previsión del Observador. */
export const RUTA_API_METEO = "/api/meteo";

/**
 * Revalidación del dato upstream y `s-maxage` del edge: 30 minutos. La
 * previsión de Open-Meteo no se actualiza más deprisa; con esto todo el
 * planeta genera como mucho una llamada upstream por zona cada 30 min.
 */
export const REVALIDATE_METEO_S = 1800;

/**
 * Cache-Control de las respuestas correctas del proxy: el edge de Vercel
 * sirve la copia 30 min sin ejecutar la función y, mientras revalida,
 * hasta 1 h más en stale-while-revalidate — el pico del día 12 lo absorbe
 * el edge, no las funciones ni Open-Meteo.
 */
export const CACHE_CONTROL_METEO = `public, s-maxage=${REVALIDATE_METEO_S}, stale-while-revalidate=3600`;

/**
 * URL del proxy para un punto: los parámetros van ya normalizados a la
 * clave de zona (dos decimales bastan para la rejilla de 0,25°). Todos
 * los usuarios de una zona piden la MISMA URL — condición para que la
 * caché del edge (y la del service worker) deduplique entre usuarios.
 */
export function urlApiMeteo(lat: number, lon: number): string {
  const zona = claveZona(lat, lon);
  const params = new URLSearchParams({
    lat: zona.lat.toFixed(2),
    lon: zona.lon.toFixed(2),
  });
  return `${RUTA_API_METEO}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Acceso upstream a Open-Meteo (solo lo usa el servidor: app/api/meteo)
// ---------------------------------------------------------------------------

/** Respuesta cruda de Open-Meteo que nos interesa (subconjunto). */
interface RespuestaOpenMeteo {
  hourly?: {
    time?: string[];
    cloud_cover?: number[];
    cloud_cover_low?: number[];
    cloud_cover_mid?: number[];
    cloud_cover_high?: number[];
  };
}

/**
 * URL de la petición a Open-Meteo para un punto: nubosidad horaria (total y
 * por capas) del 12-08-2026, en hora local Europe/Madrid. Sin clave API.
 */
export function urlPrevision(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high",
    timezone: "Europe/Madrid",
    start_date: FECHA_ECLIPSE,
    end_date: FECHA_ECLIPSE,
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

/**
 * Descarga de Open-Meteo la nubosidad de la ventana del eclipse para un
 * punto y la parsea a {@link NubosidadHora}[]. La usa el route handler
 * `/api/meteo` (con `init.next.revalidate` para la Data Cache); el
 * navegador ya no la llama.
 *
 * Lanza `Error` si la red falla, si la respuesta no es 2xx, si Open-Meteo
 * devuelve su aviso de límite (HTTP 200 con `error: true`) o si el cuerpo
 * no trae las horas esperadas.
 */
export async function fetchHorasOpenMeteo(
  lat: number,
  lon: number,
  init?: RequestInit & { next?: { revalidate?: number } },
): Promise<NubosidadHora[]> {
  const respuesta = await fetch(urlPrevision(lat, lon), init);
  if (!respuesta.ok) {
    throw new Error(`Open-Meteo respondió ${respuesta.status}`);
  }

  const datos = (await respuesta.json()) as RespuestaOpenMeteo & {
    error?: boolean;
    reason?: string;
  };
  if (datos.error) {
    // Límite horario/diario de Open-Meteo: llega como 200 + error:true.
    throw new Error(datos.reason ?? "Open-Meteo ha limitado las peticiones");
  }
  const hourly = datos.hourly;
  const tiempos = hourly?.time;
  if (
    !hourly ||
    !tiempos ||
    !hourly.cloud_cover ||
    !hourly.cloud_cover_low ||
    !hourly.cloud_cover_mid ||
    !hourly.cloud_cover_high
  ) {
    throw new Error("Respuesta de Open-Meteo sin datos horarios de nubosidad");
  }

  const horas: NubosidadHora[] = [];
  for (const hora of HORAS_ECLIPSE) {
    const indice = tiempos.indexOf(`${FECHA_ECLIPSE}T${hora}`);
    if (indice === -1) continue;
    horas.push({
      hora,
      total: hourly.cloud_cover[indice] ?? 0,
      baja: hourly.cloud_cover_low[indice] ?? 0,
      media: hourly.cloud_cover_mid[indice] ?? 0,
      alta: hourly.cloud_cover_high[indice] ?? 0,
    });
  }

  if (horas.length === 0) {
    throw new Error("Open-Meteo no devolvió las horas de la ventana del eclipse");
  }

  return horas;
}

// ---------------------------------------------------------------------------
// Acceso de red del cliente (fetch global, mockeable en tests)
// ---------------------------------------------------------------------------

/** Previsión completa para el panel: horas de la ventana + veredicto. */
export interface PrevisionEclipse {
  horas: NubosidadHora[];
  veredicto: Veredicto;
}

/**
 * Cuerpo de la respuesta del proxy `/api/meteo` (lo que valida el
 * cliente; `zona` y `generado` — sello de cuándo se construyó la
 * respuesta — son para depurar frescura de las cachés).
 */
interface RespuestaApiMeteo {
  zona?: { lat: number; lon: number };
  generado?: string;
  horas?: NubosidadHora[];
}

/**
 * Tiempo máximo de espera de la petición al proxy de meteo: sin él, una
 * conexión colgada dejaba "cargando…" para siempre (QA real: "me da
 * timeout la predicción"). 10 s cubren de sobra una respuesta servida por
 * el edge; pasado el límite, el llamante muestra su mensaje suave. Este
 * timeout de cliente cubre la petición completa al proxy — por eso el
 * route handler no pasa AbortSignal a su fetch upstream (un fetch
 * abortable puede quedar excluido de la Data Cache).
 */
export const TIMEOUT_METEO_MS = 10_000;

/**
 * Pide al proxy `/api/meteo` la previsión de nubosidad de la ventana del
 * eclipse (19:00–22:00 hora peninsular del 12-08-2026) para la Zona del
 * punto dado y la clasifica en el cliente.
 *
 * Lanza `Error` si la red falla o tarda más de TIMEOUT_METEO_MS, si la
 * respuesta no es 2xx o si el cuerpo no trae horas; el llamante decide
 * cómo degradar (mensaje suave con reintento).
 */
export async function fetchPrevisionEclipse(
  lat: number,
  lon: number,
): Promise<PrevisionEclipse> {
  const respuesta = await fetch(urlApiMeteo(lat, lon), {
    signal: AbortSignal.timeout(TIMEOUT_METEO_MS),
  });
  if (!respuesta.ok) {
    throw new Error(`El proxy de meteo respondió ${respuesta.status}`);
  }

  const datos = (await respuesta.json()) as RespuestaApiMeteo;
  const horas = datos.horas;
  if (!Array.isArray(horas) || horas.length === 0) {
    throw new Error("Respuesta del proxy de meteo sin horas de previsión");
  }

  return { horas, veredicto: clasificarVeredicto(horas) };
}
