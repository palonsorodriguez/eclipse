"use client";

/**
 * useLineaDeTiempo — el reloj de la Línea de tiempo, extraído del patrón
 * de la Vista Cielo para compartirlo con la Vista Mapa.
 *
 * Reloj y render desacoplados: el tiempo simulado vive en un ref que un
 * bucle de requestAnimationFrame avanza; React solo re-renderiza cuando
 * cambia el segundo mostrado (`tUi`). En cada frame se llama a `onFrame`
 * con el tiempo actual, para que la vista pinte sin pasar por React.
 *
 * La velocidad de reproducción tiene dos modos:
 * - "resumen" (por defecto): automática según la curva de
 *   `lib/linea-tiempo-velocidad.ts` — vuela lejos de los Contactos y va a
 *   cámara lenta en el anillo/perlas y la Totalidad. Necesita `contactos`;
 *   sin ellos cae a ×60 fija.
 * - Fija: ×30 / ×60 / ×120 / ×300.
 *
 * El modo elegido es una preferencia compartida entre todas las vistas
 * (store a nivel de módulo + useSyncExternalStore): cambiarlo en la Vista
 * Cielo lo cambia también en la Vista Mapa.
 */

import { useMemo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { crearCurvaResumen, type ContactosMs } from "@/lib/linea-tiempo-velocidad";

/** Velocidades fijas seleccionables, en orden de presentación. */
export const VELOCIDADES_FIJAS = [30, 60, 120, 300] as const;
export type VelocidadFija = (typeof VELOCIDADES_FIJAS)[number];

/** Modo de velocidad: curva automática del resumen o un factor fijo. */
export type ModoVelocidad = "resumen" | VelocidadFija;

/** Velocidad si el modo es resumen pero la vista no aportó Contactos. */
const VELOCIDAD_DEFECTO = 60;

// ---------------------------------------------------------------------------
// Preferencia de velocidad compartida entre vistas (store de módulo).
// ---------------------------------------------------------------------------

let modoCompartido: ModoVelocidad = "resumen";
const oyentesModo = new Set<() => void>();

function suscribirModo(oyente: () => void): () => void {
  oyentesModo.add(oyente);
  return () => oyentesModo.delete(oyente);
}

/** Cambia el modo de velocidad para todas las vistas montadas. */
export function fijarModoVelocidad(modo: ModoVelocidad): void {
  if (modo === modoCompartido) return;
  modoCompartido = modo;
  for (const oyente of oyentesModo) oyente();
}

const leerModo = (): ModoVelocidad => modoCompartido;
// En SSR no hay preferencia del usuario: siempre el valor por defecto.
const leerModoServidor = (): ModoVelocidad => "resumen";

export interface OpcionesLineaDeTiempo {
  /** Extremo inicial de la Línea de tiempo (ms de época). */
  tMin: number;
  /** Extremo final de la Línea de tiempo (ms de época). */
  tMax: number;
  /**
   * Contactos locales del Observador, para la curva del modo resumen y
   * los saltos. Sin ellos, el modo resumen reproduce a ×60 fija.
   */
  contactos?: ContactosMs | null;
  /**
   * Llamada en cada frame de animación (y al fijar el tiempo a mano) con
   * el tiempo simulado actual. Debe ser una referencia estable
   * (useCallback): el bucle se reinicia al cambiar.
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
  /** Fija el tiempo simulado (slider) y repinta de inmediato. */
  fijarTiempo: (t: number) => void;
  /** Salta a un instante (recortado al rango) y repinta de inmediato. */
  saltarA: (t: number) => void;
  /** Modo de velocidad actual (compartido entre vistas). */
  modo: ModoVelocidad;
  /** Cambia el modo de velocidad (compartido entre vistas). */
  fijarModo: (modo: ModoVelocidad) => void;
}

/**
 * Reloj compartido de la Línea de tiempo. Cada vista monta su propia
 * instancia con el mismo rango 19:15–21:30 CEST.
 */
export function useLineaDeTiempo({
  tMin,
  tMax,
  contactos,
  onFrame,
}: OpcionesLineaDeTiempo): LineaDeTiempo {
  // La verdad del tiempo simulado vive en el ref (avanzado por rAF);
  // el estado solo refleja el segundo mostrado en la UI.
  const tRef = useRef<number>(tMin);
  const ultimoSegRef = useRef<number>(tMin);
  const [tUi, setTUi] = useState<number>(tMin);
  const [reproduciendo, setReproduciendo] = useState(false);
  const reproduciendoRef = useRef(false);

  const modo = useSyncExternalStore(suscribirModo, leerModo, leerModoServidor);

  // Curva del resumen en un ref: el bucle rAF la lee sin reiniciarse al
  // cambiar el Observador o el modo.
  const curvaResumen = useMemo(
    () => (contactos ? crearCurvaResumen(contactos) : null),
    [contactos],
  );
  const curvaRef = useRef(curvaResumen);
  curvaRef.current = curvaResumen;

  // Bucle rAF: avanza el reloj si se reproduce y notifica cada frame.
  useEffect(() => {
    // Primer fotograma síncrono: la vista nunca queda sin pintar aunque
    // el rAF tarde (p. ej. pestaña en segundo plano).
    onFrame?.(tRef.current);

    let raf = 0;
    let previo = performance.now();
    const paso = (ahora: number): void => {
      const dtMs = ahora - previo;
      previo = ahora;
      if (reproduciendoRef.current) {
        // `modoCompartido` se lee del módulo (no del closure): el bucle ve
        // el modo vigente sin reiniciarse al cambiarlo.
        const factor =
          modoCompartido === "resumen"
            ? (curvaRef.current?.(tRef.current) ?? VELOCIDAD_DEFECTO)
            : modoCompartido;
        tRef.current = Math.min(tRef.current + dtMs * factor, tMax);
        if (tRef.current >= tMax) {
          reproduciendoRef.current = false;
          setReproduciendo(false);
        }
      }
      onFrame?.(tRef.current);
      const seg = Math.floor(tRef.current / 1000) * 1000;
      if (seg !== ultimoSegRef.current) {
        ultimoSegRef.current = seg;
        setTUi(seg);
      }
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [onFrame, tMax]);

  const alternarReproduccion = (): void => {
    const siguiente = !reproduciendoRef.current;
    if (siguiente && tRef.current >= tMax) {
      tRef.current = tMin; // volver a empezar desde el principio
    }
    reproduciendoRef.current = siguiente;
    setReproduciendo(siguiente);
  };

  const fijarTiempo = (t: number): void => {
    tRef.current = t;
    ultimoSegRef.current = t;
    setTUi(t);
    onFrame?.(t); // feedback inmediato al arrastrar, sin esperar al rAF
  };

  const saltarA = (t: number): void => {
    fijarTiempo(Math.min(Math.max(t, tMin), tMax));
  };

  return {
    tUi,
    reproduciendo,
    alternarReproduccion,
    fijarTiempo,
    saltarA,
    modo,
    fijarModo: fijarModoVelocidad,
  };
}
