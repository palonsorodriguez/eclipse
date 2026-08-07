/**
 * meteo — Previsión de nubosidad de Open-Meteo para la tarde del eclipse
 * (12-08-2026) en un punto lat/lon.
 *
 * La meteo es crítica: de las nubes depende poder ver el eclipse. Este módulo
 * separa la lógica pura (clasificación del veredicto) del acceso de red
 * (fetch a Open-Meteo, sin clave API), de modo que la primera es testeable
 * sin mocks y el segundo se mockea en el límite del sistema (global fetch).
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

/** Previsión completa para el panel: horas de la ventana + veredicto. */
export interface PrevisionEclipse {
  horas: NubosidadHora[];
  veredicto: Veredicto;
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
 * Descarga de Open-Meteo la previsión de nubosidad para la ventana del
 * eclipse (19:00–22:00 hora peninsular del 12-08-2026) y la clasifica.
 *
 * Lanza `Error` si la red falla, la respuesta no es 2xx o el cuerpo no trae
 * las horas esperadas; el llamante decide cómo degradar (mensaje suave).
 */
export async function fetchPrevisionEclipse(
  lat: number,
  lon: number,
): Promise<PrevisionEclipse> {
  const respuesta = await fetch(urlPrevision(lat, lon));
  if (!respuesta.ok) {
    throw new Error(`Open-Meteo respondió ${respuesta.status}`);
  }

  const datos = (await respuesta.json()) as RespuestaOpenMeteo;
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

  return { horas, veredicto: clasificarVeredicto(horas) };
}
