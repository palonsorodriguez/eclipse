/**
 * reloj-tiempo — el reloj único de la Línea de tiempo, compartido por todas
 * las vistas (issue #34: "que el mapa de abajo corra sincronizado con el de
 * arriba").
 *
 * Antes cada vista montaba su propio reloj (su instante, su play, su bucle
 * rAF): darle al play en la Vista Cielo dejaba quieta la Vista Mapa. Ahora
 * el reloj entero vive a nivel de módulo: un único instante `t`, un único
 * estado de reproducción, un único modo de velocidad y UN solo bucle de
 * requestAnimationFrame. Las vistas son suscriptoras: cada una registra su
 * `onFrame` y el bucle las pinta todas en cada frame con el mismo `t`.
 *
 * Ciclo de vida del bucle (pensado para StrictMode, que monta doble en
 * desarrollo): arranca con el primer suscriptor y se detiene con el último;
 * suscribirse devuelve una función de baja idempotente.
 *
 * React no participa en el frame a frame: la UI (HUD, slider, botón de
 * play) se suscribe con `useSyncExternalStore` a los cambios "lentos" —
 * el segundo mostrado (`tUi`), play/pausa y el modo de velocidad — así que
 * solo re-renderiza cuando cambia el segundo simulado o el usuario toca
 * un control.
 *
 * Los Contactos del reloj son los del Observador actual: ambas vistas usan
 * el mismo Observador, así que `fijarContactos` deduplica por valor y la
 * curva del modo resumen se crea una sola vez por Observador.
 *
 * Este módulo es puro (sin React): el adaptador para componentes es
 * `lib/useLineaDeTiempo.ts`. La fábrica `crearRelojLineaDeTiempo` existe
 * para los tests; la app usa el singleton `relojLineaDeTiempo`.
 */

import { crearCurvaResumen, type ContactosMs } from "@/lib/linea-tiempo-velocidad";

/** Velocidades fijas seleccionables, en orden de presentación. */
export const VELOCIDADES_FIJAS = [30, 60, 120, 300] as const;
export type VelocidadFija = (typeof VELOCIDADES_FIJAS)[number];

/** Modo de velocidad: curva automática del resumen o un factor fijo. */
export type ModoVelocidad = "resumen" | VelocidadFija;

/** Velocidad si el modo es resumen pero aún no hay Contactos. */
const VELOCIDAD_DEFECTO = 60;

/** Línea de tiempo: 19:15–21:30 CEST del 12-08-2026 (CEST = UT+2). */
export const T_MIN = Date.UTC(2026, 7, 12, 17, 15, 0);
export const T_MAX = Date.UTC(2026, 7, 12, 19, 30, 0);

export interface OpcionesReloj {
  /** Extremo inicial de la Línea de tiempo (ms de época). */
  tMin: number;
  /** Extremo final de la Línea de tiempo (ms de época). */
  tMax: number;
}

export interface RelojLineaDeTiempo {
  /** Extremos de la Línea de tiempo (ms de época). */
  tMin: number;
  tMax: number;
  /**
   * Registra un pintor de frames: se le llama de inmediato con el tiempo
   * actual (la vista nunca queda sin pintar) y después una vez por frame
   * del bucle común. Devuelve la función de baja; con el primer suscriptor
   * arranca el bucle rAF y con el último se detiene.
   */
  suscribirFrame(onFrame: (t: number) => void): () => void;
  /** Suscripción de UI (useSyncExternalStore): tUi, play/pausa y modo. */
  suscribirUi(oyente: () => void): () => void;
  /** Tiempo simulado cuantizado al segundo (ms de época), para la UI. */
  leerTUi(): number;
  /** ¿Está avanzando el reloj? */
  leerReproduciendo(): boolean;
  /** Modo de velocidad vigente. */
  leerModo(): ModoVelocidad;
  /** Cambia el modo de velocidad para todas las vistas. */
  fijarModo(modo: ModoVelocidad): void;
  /**
   * Fija los Contactos del Observador actual para la curva del resumen.
   * Deduplica por valor: ambas vistas los aportan para el mismo Observador
   * y solo el primer cambio real reconstruye la curva.
   */
  fijarContactos(contactos: ContactosMs | null): void;
  /** Botón play/pausa. Reproducir desde el final vuelve al principio. */
  alternarReproduccion(): void;
  /** Fija el tiempo simulado (slider) y repinta ambas vistas de inmediato. */
  fijarTiempo(t: number): void;
  /** Salta a un instante (recortado al rango) y repinta de inmediato. */
  saltarA(t: number): void;
}

/** ¿Mismos Contactos por valor? (los objetos cambian de identidad). */
function contactosIguales(a: ContactosMs | null, b: ContactosMs | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.c1 === b.c1 &&
    a.c2 === b.c2 &&
    a.maximo === b.maximo &&
    a.c3 === b.c3 &&
    a.c4 === b.c4
  );
}

/** Fábrica del reloj, sin estado global: cada test crea el suyo. */
export function crearRelojLineaDeTiempo({
  tMin,
  tMax,
}: OpcionesReloj): RelojLineaDeTiempo {
  // --- Estado del reloj -----------------------------------------------------
  let t = tMin;
  let tUi = tMin;
  let reproduciendo = false;
  let modo: ModoVelocidad = "resumen";
  let contactos: ContactosMs | null = null;
  let curva: ((t: number) => number) | null = null;

  // --- Suscriptores ---------------------------------------------------------
  const pintores = new Set<(t: number) => void>();
  const oyentesUi = new Set<() => void>();

  // --- Bucle rAF único ------------------------------------------------------
  let idRaf = 0;
  let bucleActivo = false;
  // Timestamp del frame anterior; null al (re)arrancar para que el primer
  // frame tenga dt = 0 (nada de saltos tras una pausa larga del bucle).
  let previo: number | null = null;

  const notificarUi = (): void => {
    for (const oyente of oyentesUi) oyente();
  };

  const emitirFrame = (): void => {
    for (const pintor of pintores) pintor(t);
  };

  const paso = (ahora: number): void => {
    const dtMs = previo === null ? 0 : ahora - previo;
    previo = ahora;
    let cambioUi = false;
    if (reproduciendo) {
      const factor =
        modo === "resumen" ? (curva?.(t) ?? VELOCIDAD_DEFECTO) : modo;
      t = Math.min(t + dtMs * factor, tMax);
      if (t >= tMax) {
        reproduciendo = false;
        cambioUi = true;
      }
    }
    emitirFrame();
    const seg = Math.floor(t / 1000) * 1000;
    if (seg !== tUi) {
      tUi = seg;
      cambioUi = true;
    }
    if (cambioUi) notificarUi();
    idRaf = requestAnimationFrame(paso);
  };

  const arrancarBucle = (): void => {
    if (bucleActivo) return;
    bucleActivo = true;
    previo = null;
    idRaf = requestAnimationFrame(paso);
  };

  const pararBucle = (): void => {
    if (!bucleActivo) return;
    bucleActivo = false;
    cancelAnimationFrame(idRaf);
  };

  // Cerradas sobre el estado (nada de `this`): los componentes las pasan
  // sueltas como manejadores de eventos.
  const fijarTiempo = (nuevo: number): void => {
    t = nuevo;
    tUi = nuevo;
    emitirFrame(); // feedback inmediato al arrastrar, sin esperar al rAF
    notificarUi();
  };

  // --- API ------------------------------------------------------------------
  return {
    tMin,
    tMax,

    suscribirFrame(onFrame: (t: number) => void): () => void {
      pintores.add(onFrame);
      // Primer fotograma síncrono: la vista nunca queda sin pintar aunque
      // el rAF tarde (p. ej. pestaña en segundo plano).
      onFrame(t);
      arrancarBucle();
      let activo = true;
      return () => {
        if (!activo) return; // baja idempotente (StrictMode llama limpio)
        activo = false;
        pintores.delete(onFrame);
        if (pintores.size === 0) pararBucle();
      };
    },

    suscribirUi(oyente: () => void): () => void {
      oyentesUi.add(oyente);
      return () => oyentesUi.delete(oyente);
    },

    leerTUi: () => tUi,
    leerReproduciendo: () => reproduciendo,
    leerModo: () => modo,

    fijarModo(nuevo: ModoVelocidad): void {
      if (nuevo === modo) return;
      modo = nuevo;
      notificarUi();
    },

    fijarContactos(nuevos: ContactosMs | null): void {
      if (contactosIguales(nuevos, contactos)) return;
      contactos = nuevos;
      curva = nuevos ? crearCurvaResumen(nuevos) : null;
    },

    alternarReproduccion(): void {
      const siguiente = !reproduciendo;
      if (siguiente && t >= tMax) {
        t = tMin; // volver a empezar desde el principio
      }
      reproduciendo = siguiente;
      notificarUi();
    },

    fijarTiempo,

    saltarA(nuevo: number): void {
      fijarTiempo(Math.min(Math.max(nuevo, tMin), tMax));
    },
  };
}

/**
 * El reloj de la app: único por sesión, compartido por la Vista Cielo y la
 * Vista Mapa a través de `useLineaDeTiempo`.
 */
export const relojLineaDeTiempo = crearRelojLineaDeTiempo({
  tMin: T_MIN,
  tMax: T_MAX,
});
