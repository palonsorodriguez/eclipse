"use client";

/**
 * useLineaDeTiempo — adaptador React del reloj único de la Línea de tiempo
 * (`lib/reloj-tiempo.ts`).
 *
 * El reloj entero (t, play/pausa, modo de velocidad y el único bucle rAF)
 * vive a nivel de módulo; este hook solo:
 *
 * - registra el `onFrame` de la vista como suscriptor del bucle común
 *   (todas las vistas se pintan en cada frame con el mismo `t`);
 * - aporta los Contactos del Observador al reloj (deduplicados por valor:
 *   ambas vistas usan el mismo Observador);
 * - refleja en React, vía `useSyncExternalStore`, solo lo "lento": el
 *   segundo mostrado (`tUi`), play/pausa y el modo de velocidad.
 *
 * Play, pausa, salto o arrastre desde cualquier barra de ControlesTiempo
 * mueven por tanto todas las vistas a la vez.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { ContactosMs } from "@/lib/linea-tiempo-velocidad";
import { relojLineaDeTiempo, T_MIN, type ModoVelocidad } from "@/lib/reloj-tiempo";

export {
  T_MIN,
  T_MAX,
  VELOCIDADES_FIJAS,
  type ModoVelocidad,
  type VelocidadFija,
} from "@/lib/reloj-tiempo";

// En SSR no hay reloj andando ni preferencia del usuario: valores iniciales.
const leerTUiServidor = (): number => T_MIN;
const leerReproduciendoServidor = (): boolean => false;
const leerModoServidor = (): ModoVelocidad => "resumen";

export interface OpcionesLineaDeTiempo {
  /**
   * Contactos locales del Observador, para la curva del modo resumen y
   * los saltos. Sin ellos, el modo resumen reproduce a ×60 fija.
   */
  contactos?: ContactosMs | null;
  /**
   * Llamada en cada frame de animación (y al fijar el tiempo a mano) con
   * el tiempo simulado actual. Debe ser una referencia estable
   * (useCallback): la suscripción se renueva al cambiar.
   */
  onFrame?: (t: number) => void;
}

export interface LineaDeTiempo {
  /** Tiempo simulado cuantizado al segundo (ms de época), para la UI. */
  tUi: number;
  /** ¿Está avanzando el reloj? */
  reproduciendo: boolean;
  /** Botón play/pausa. Reproducir desde el final vuelve al principio. */
  alternarReproduccion: () => void;
  /** Fija el tiempo simulado (slider) y repinta todas las vistas. */
  fijarTiempo: (t: number) => void;
  /** Salta a un instante (recortado al rango) y repinta de inmediato. */
  saltarA: (t: number) => void;
  /** Modo de velocidad actual (compartido entre vistas). */
  modo: ModoVelocidad;
  /** Cambia el modo de velocidad (compartido entre vistas). */
  fijarModo: (modo: ModoVelocidad) => void;
}

/**
 * Vista suscrita al reloj común de la Línea de tiempo. Todas las
 * instancias comparten t, play/pausa y velocidad: el reloj es único.
 */
export function useLineaDeTiempo({
  contactos,
  onFrame,
}: OpcionesLineaDeTiempo = {}): LineaDeTiempo {
  const reloj = relojLineaDeTiempo;

  const tUi = useSyncExternalStore(reloj.suscribirUi, reloj.leerTUi, leerTUiServidor);
  const reproduciendo = useSyncExternalStore(
    reloj.suscribirUi,
    reloj.leerReproduciendo,
    leerReproduciendoServidor,
  );
  const modo = useSyncExternalStore(reloj.suscribirUi, reloj.leerModo, leerModoServidor);

  // Contactos del Observador actual. Sin limpieza: al desmontar una vista
  // la otra sigue con los mismos (deduplicados por valor en el reloj).
  useEffect(() => {
    if (contactos !== undefined) reloj.fijarContactos(contactos);
  }, [reloj, contactos]);

  // Suscripción del pintor de la vista al bucle común. La baja es limpia:
  // con el último suscriptor el bucle rAF se detiene (StrictMode monta
  // doble en desarrollo y este alta/baja debe ser simétrico).
  useEffect(() => {
    if (!onFrame) return;
    return reloj.suscribirFrame(onFrame);
  }, [reloj, onFrame]);

  return {
    tUi,
    reproduciendo,
    alternarReproduccion: reloj.alternarReproduccion,
    fijarTiempo: reloj.fijarTiempo,
    saltarA: reloj.saltarA,
    modo,
    fijarModo: reloj.fijarModo,
  };
}
