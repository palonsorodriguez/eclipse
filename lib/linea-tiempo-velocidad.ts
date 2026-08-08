/**
 * linea-tiempo-velocidad — lógica pura del control de reproducción de la
 * Línea de tiempo: la curva de velocidad del modo "resumen" y los destinos
 * de los botones de salto a los Contactos.
 *
 * El modo resumen resuelve la queja real de uso ("2¼ minutos de play con un
 * 90 % de no pasa nada"): la velocidad de reproducción es automática en
 * función de la distancia temporal al momento interesante más cercano
 * (Contactos C1/C2/Máx/C3/C4). Lejos de todo vuela a ×600, frena al
 * acercarse a los Contactos y va a cámara lenta (×5) en la ventana del
 * anillo de diamante / perlas de Baily (±8 s de C2/C3) y durante toda la
 * Totalidad. Las transiciones son rampas exponenciales (lineales en
 * log-velocidad), sin escalones.
 *
 * Con las horas reales del 12-08-2026 el resumen completo dura ~40 s
 * (verificado en los tests con `duracionResumenSegundos`).
 */

/** Instantes de los Contactos locales en ms de época. C2/C3 solo en total. */
export interface ContactosMs {
  c1: number;
  c2: number | null;
  maximo: number;
  c3: number | null;
  c4: number;
}

/** Velocidad de crucero lejos de cualquier Contacto. */
export const VELOCIDAD_LEJOS = 600;
/** Velocidad al llegar a C1/C4 (empieza/termina la parcialidad). */
export const VELOCIDAD_CONTACTO_PARCIAL = 120;
/** Velocidad en el último minuto antes de C2 / primer minuto tras C3. */
export const VELOCIDAD_ULTIMO_MINUTO = 30;
/** Cámara lenta: anillo de diamante, perlas de Baily y Totalidad. */
export const VELOCIDAD_LENTA = 5;
/** Velocidad en el Máximo de un eclipse parcial (el mejor momento local). */
export const VELOCIDAD_MAXIMO_PARCIAL = 15;

/**
 * Margen alrededor de C2/C3 en cámara lenta: cubre el anillo de diamante
 * (±4 s) y las perlas de Baily (±1,5 s), que a ×60 durarían un parpadeo.
 */
export const MARGEN_ANILLO_MS = 8_000;

/**
 * Anticipación de los saltos: se aterriza unos segundos antes del Contacto
 * para verlo llegar en vez de caer sobre él ya empezado.
 */
export const ANTICIPO_SALTO_MS = 12_000;

// ---------------------------------------------------------------------------
// Perfiles de velocidad
// ---------------------------------------------------------------------------

/**
 * Un ancla de perfil: a distancia `d` (ms) del atractor, velocidad `v`.
 * Entre anclas se interpola linealmente en log-velocidad (rampa exponencial,
 * suave al oído y al ojo); más allá de la última ancla, VELOCIDAD_LEJOS.
 */
interface Ancla {
  d: number;
  v: number;
}

/** Rampa de C1/C4: de ×120 en el contacto a ×600 a 2½ min. */
const PERFIL_CONTACTO_PARCIAL: readonly Ancla[] = [
  { d: 0, v: VELOCIDAD_CONTACTO_PARCIAL },
  { d: 150_000, v: VELOCIDAD_LEJOS },
];

/**
 * Rampa de entrada/salida de la ventana del anillo (distancia medida desde
 * el borde de la ventana ±8 s): el último minuto antes de C2 (y el primero
 * tras C3) baja de ~×40 a ×30 y de ahí en picado a ×5 al entrar en la
 * ventana; hacia fuera sube a ×600 en unos 2 min. El ancla intermedia ×20
 * reparte la rampa final para no eternizarla (presupuesto: resumen completo
 * en ~35–45 s).
 */
const PERFIL_VENTANA_TOTALIDAD: readonly Ancla[] = [
  { d: 0, v: VELOCIDAD_LENTA },
  { d: 16_000, v: 20 },
  { d: 44_000, v: VELOCIDAD_ULTIMO_MINUTO },
  { d: 124_000, v: VELOCIDAD_LEJOS },
];

/** Máximo de un eclipse parcial: meseta ×15 de ±15 s y rampa a ×600. */
const PERFIL_MAXIMO_PARCIAL: readonly Ancla[] = [
  { d: 15_000, v: VELOCIDAD_MAXIMO_PARCIAL },
  { d: 60_000, v: VELOCIDAD_ULTIMO_MINUTO },
  { d: 240_000, v: VELOCIDAD_LEJOS },
];

/** Velocidad de un perfil a distancia `d`: log-interpolación entre anclas. */
function velocidadPerfil(d: number, perfil: readonly Ancla[]): number {
  const primera = perfil[0];
  if (d <= primera.d) return primera.v;
  for (let i = 1; i < perfil.length; i++) {
    const a = perfil[i - 1];
    const b = perfil[i];
    if (d <= b.d) {
      const fraccion = (d - a.d) / (b.d - a.d);
      return Math.exp(
        Math.log(a.v) + fraccion * (Math.log(b.v) - Math.log(a.v)),
      );
    }
  }
  return VELOCIDAD_LEJOS;
}

/**
 * Curva de velocidad del modo resumen para unos Contactos dados.
 *
 * La velocidad en `t` es el mínimo de los perfiles de todos los atractores:
 * C1 y C4 frenan a ×120, la ventana [C2−8 s, C3+8 s] (Totalidad incluida)
 * clava ×5 con rampas de entrada/salida, y en un eclipse parcial el Máximo
 * frena a ×15. Lejos de todo, ×600.
 */
export function crearCurvaResumen(contactos: ContactosMs): (t: number) => number {
  const { c1, c2, c3, c4, maximo } = contactos;
  return (t: number): number => {
    let v = Math.min(
      velocidadPerfil(Math.abs(t - c1), PERFIL_CONTACTO_PARCIAL),
      velocidadPerfil(Math.abs(t - c4), PERFIL_CONTACTO_PARCIAL),
    );
    if (c2 !== null && c3 !== null) {
      // Distancia al borde de la ventana del anillo (0 dentro de ella).
      const inicio = c2 - MARGEN_ANILLO_MS;
      const fin = c3 + MARGEN_ANILLO_MS;
      const d = t < inicio ? inicio - t : t > fin ? t - fin : 0;
      v = Math.min(v, velocidadPerfil(d, PERFIL_VENTANA_TOTALIDAD));
    } else {
      v = Math.min(
        v,
        velocidadPerfil(Math.abs(t - maximo), PERFIL_MAXIMO_PARCIAL),
      );
    }
    return v;
  };
}

/** Conveniencia sin closure, para llamadas sueltas (tests, depuración). */
export function velocidadResumen(t: number, contactos: ContactosMs): number {
  return crearCurvaResumen(contactos)(t);
}

/**
 * Duración real estimada (segundos de reloj de pared) de reproducir el
 * rango [tMin, tMax] entero en modo resumen: integra dt/v(t) numéricamente.
 */
export function duracionResumenSegundos(
  contactos: ContactosMs,
  tMin: number,
  tMax: number,
  pasoMs = 500,
): number {
  const curva = crearCurvaResumen(contactos);
  let segundos = 0;
  for (let t = tMin; t < tMax; t += pasoMs) {
    const tramo = Math.min(pasoMs, tMax - t);
    // Velocidad en el punto medio del tramo: error de integración ínfimo
    // frente a las rampas de decenas de segundos.
    segundos += tramo / curva(t + tramo / 2) / 1000;
  }
  return segundos;
}

// ---------------------------------------------------------------------------
// Saltos a los Contactos
// ---------------------------------------------------------------------------

/** Etiquetas canónicas de los botones de salto. */
export type EtiquetaSalto = "C1" | "C2" | "Máx" | "C3" | "C4";

export interface DestinoSalto {
  etiqueta: EtiquetaSalto;
  /** Instante del Contacto (ms de época). */
  t: number;
  /** Adónde saltar: ANTICIPO_SALTO_MS antes, recortado a [tMin, tMax]. */
  destino: number;
}

/**
 * Destinos de los botones de salto para unos Contactos: solo los que
 * existen para el Observador (C2/C3 no existen en un eclipse parcial) y
 * caen dentro de la Línea de tiempo. Cada destino aterriza un poco antes
 * del Contacto para verlo llegar.
 */
export function destinosSalto(
  contactos: ContactosMs,
  tMin: number,
  tMax: number,
): DestinoSalto[] {
  const candidatos: Array<{ etiqueta: EtiquetaSalto; t: number | null }> = [
    { etiqueta: "C1", t: contactos.c1 },
    { etiqueta: "C2", t: contactos.c2 },
    { etiqueta: "Máx", t: contactos.maximo },
    { etiqueta: "C3", t: contactos.c3 },
    { etiqueta: "C4", t: contactos.c4 },
  ];
  return candidatos
    .filter((c): c is { etiqueta: EtiquetaSalto; t: number } => c.t !== null)
    .filter((c) => c.t >= tMin && c.t <= tMax)
    .map((c) => ({
      etiqueta: c.etiqueta,
      t: c.t,
      destino: Math.min(Math.max(c.t - ANTICIPO_SALTO_MS, tMin), tMax),
    }));
}
