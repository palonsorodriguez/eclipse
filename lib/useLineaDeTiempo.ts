"use client";

/**
 * useLineaDeTiempo — el reloj de la Línea de tiempo, extraído del patrón
 * de la Vista Cielo para compartirlo con la Vista Mapa.
 *
 * Reloj y render desacoplados: el tiempo simulado vive en un ref que un
 * bucle de requestAnimationFrame avanza; React solo re-renderiza cuando
 * cambia el segundo mostrado (`tUi`). En cada frame se llama a `onFrame`
 * con el tiempo actual, para que la vista pinte sin pasar por React.
 */

import { useEffect, useRef, useState } from "react";

export interface OpcionesLineaDeTiempo {
  /** Extremo inicial de la Línea de tiempo (ms de época). */
  tMin: number;
  /** Extremo final de la Línea de tiempo (ms de época). */
  tMax: number;
  /**
   * Factor de velocidad de reproducción en el instante `t` (60 = un
   * minuto simulado por segundo real). Si se omite, 60×. Debe ser una
   * referencia estable (useCallback): el bucle se reinicia al cambiar.
   */
  velocidad?: (t: number) => number;
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
}

const VELOCIDAD_DEFECTO = 60;

/**
 * Reloj compartido de la Línea de tiempo. Cada vista monta su propia
 * instancia con el mismo rango 19:15–21:30 CEST.
 */
export function useLineaDeTiempo({
  tMin,
  tMax,
  velocidad,
  onFrame,
}: OpcionesLineaDeTiempo): LineaDeTiempo {
  // La verdad del tiempo simulado vive en el ref (avanzado por rAF);
  // el estado solo refleja el segundo mostrado en la UI.
  const tRef = useRef<number>(tMin);
  const ultimoSegRef = useRef<number>(tMin);
  const [tUi, setTUi] = useState<number>(tMin);
  const [reproduciendo, setReproduciendo] = useState(false);
  const reproduciendoRef = useRef(false);

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
        const factor = velocidad ? velocidad(tRef.current) : VELOCIDAD_DEFECTO;
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
  }, [velocidad, onFrame, tMax]);

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

  return { tUi, reproduciendo, alternarReproduccion, fijarTiempo };
}
