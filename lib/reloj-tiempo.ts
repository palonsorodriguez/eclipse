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
 * Modo directo (issue #40, el día del eclipse): `pulsarAhora` pega el
 * tiempo simulado al reloj real (×1, sin deriva: cada frame lee el
 * proveedor `ahora`, no acumula dt). Cualquier interacción — slider, salto
 * o pausa — sale del directo; `autoArrancarDirecto` lo enciende solo al
 * montar si el reloj real ya está dentro de la ventana. Fuera de la
 * ventana, `pulsarAhora` es una previsualización: salta a la hora actual
 * proyectada sobre el día 12.
 *
 * Este módulo es puro (sin React): el adaptador para componentes es
 * `lib/useLineaDeTiempo.ts`. La fábrica `crearRelojLineaDeTiempo` existe
 * para los tests; la app usa el singleton `relojLineaDeTiempo`. El
 * proveedor de tiempo real es inyectable (`OpcionesReloj.ahora`); el
 * singleton usa `Date.now`.
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
  /**
   * Proveedor del reloj real (ms de época), la frontera de sistema del modo
   * directo. Por defecto `Date.now`; los tests inyectan uno falso.
   */
  ahora?: () => number;
}

/** Milisegundos de un día, para proyectar la hora actual sobre el día 12. */
const DIA_MS = 86_400_000;

/**
 * Proyección de un instante real sobre el día de la Línea de tiempo: misma
 * hora del día (UT), pero en la fecha de `tMin`. Es la previsualización del
 * botón AHORA fuera de la ventana del eclipse: "así estará el cielo a esta
 * hora el día 12".
 */
export function proyectarAlDiaDelEclipse(ahoraMs: number, tMin: number): number {
  const inicioDia = Math.floor(tMin / DIA_MS) * DIA_MS;
  return inicioDia + (((ahoraMs % DIA_MS) + DIA_MS) % DIA_MS);
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
  // --- Modo directo (issue #40) -------------------------------------------
  /** ¿Está el reloj en modo directo, pegado al reloj real? */
  leerEnDirecto(): boolean;
  /** Lectura del reloj real (el proveedor inyectado), para la cuenta atrás. */
  leerAhora(): number;
  /**
   * Botón AHORA. Con el reloj real dentro de la ventana entra en modo
   * directo: el tiempo simulado queda pegado al reloj real (×1) hasta que
   * el usuario interactúe (slider, salto o pausa salen del modo) o la
   * ventana termine. Fuera de la ventana es una previsualización: salta al
   * instante actual proyectado sobre el día del eclipse, sin entrar en
   * directo.
   */
  pulsarAhora(): void;
  /**
   * Arranque automático del día del eclipse: si el reloj real está dentro
   * de la ventana, entra en modo directo. Solo actúa la primera vez (las
   * vistas pueden montarse varias veces; salir del directo es decisión del
   * usuario y no debe deshacerse en un remontaje).
   */
  autoArrancarDirecto(): void;
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
  ahora = Date.now,
}: OpcionesReloj): RelojLineaDeTiempo {
  // --- Estado del reloj -----------------------------------------------------
  let t = tMin;
  let tUi = tMin;
  let reproduciendo = false;
  let modo: ModoVelocidad = "resumen";
  let contactos: ContactosMs | null = null;
  let curva: ((t: number) => number) | null = null;
  // Modo directo: t pegado al reloj real. `autoArranqueHecho` garantiza que
  // la detección al montar solo actúe una vez por sesión (StrictMode monta
  // doble y salir del directo es decisión del usuario).
  let enDirecto = false;
  let autoArranqueHecho = false;

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

  const paso = (marcaFrame: number): void => {
    const dtMs = previo === null ? 0 : marcaFrame - previo;
    previo = marcaFrame;
    let cambioUi = false;
    if (reproduciendo) {
      if (enDirecto) {
        // Pegado al reloj real, no a los dt del rAF: sin deriva acumulada
        // aunque la pestaña pierda frames.
        t = Math.min(ahora(), tMax);
      } else {
        const factor =
          modo === "resumen" ? (curva?.(t) ?? VELOCIDAD_DEFECTO) : modo;
        t = Math.min(t + dtMs * factor, tMax);
      }
      if (t >= tMax) {
        reproduciendo = false;
        enDirecto = false; // la ventana terminó: el directo se apaga solo
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
    enDirecto = false; // tocar el slider o saltar sale del modo directo
    t = nuevo;
    tUi = nuevo;
    emitirFrame(); // feedback inmediato al arrastrar, sin esperar al rAF
    notificarUi();
  };

  const saltarA = (nuevo: number): void => {
    fijarTiempo(Math.min(Math.max(nuevo, tMin), tMax));
  };

  const entrarEnDirecto = (): void => {
    enDirecto = true;
    reproduciendo = true;
    t = Math.min(ahora(), tMax);
    tUi = Math.floor(t / 1000) * 1000;
    emitirFrame(); // clavado al reloj real desde ya, sin esperar al rAF
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
      enDirecto = false; // pausar (o reanudar a mano) sale del modo directo
      const siguiente = !reproduciendo;
      if (siguiente && t >= tMax) {
        t = tMin; // volver a empezar desde el principio
      }
      reproduciendo = siguiente;
      notificarUi();
    },

    fijarTiempo,
    saltarA,

    leerEnDirecto: () => enDirecto,
    leerAhora: () => ahora(),

    pulsarAhora(): void {
      const real = ahora();
      if (real >= tMin && real <= tMax) {
        entrarEnDirecto();
      } else {
        // Previsualización: el instante actual proyectado sobre el día del
        // eclipse (saltarA recorta a la ventana y ya sale del directo).
        saltarA(proyectarAlDiaDelEclipse(real, tMin));
      }
    },

    autoArrancarDirecto(): void {
      if (autoArranqueHecho) return;
      autoArranqueHecho = true;
      const real = ahora();
      if (real >= tMin && real <= tMax) entrarEnDirecto();
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
