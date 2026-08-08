"use client";

/**
 * VistaCielo — simulación del cielo durante el eclipse del 12-08-2026
 * desde un Observador, sobre canvas 2D.
 *
 * - Astronomía: `lib/eclipse-engine.ts` (posiciones alt-az reales,
 *   Oscurecimiento, Contactos C1–C4).
 * - Geometría/color puros: `lib/cielo-render.ts` (proyección, zoom de
 *   discos documentado, curva de brillo).
 * - Pintado: `lib/cielo-draw.ts`.
 * - Reloj: `lib/useLineaDeTiempo.ts` (rAF + ref, compartido con la
 *   Vista Mapa), que dibuja cada frame directamente en el canvas.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createEclipseEngine, type Observador } from "@/lib/eclipse-engine";
import { configEscena, dibujarEscena } from "@/lib/cielo-draw";
import { useLineaDeTiempo } from "@/lib/useLineaDeTiempo";
import type { ContactosMs } from "@/lib/linea-tiempo-velocidad";
import ControlesTiempo from "./ControlesTiempo";
import { brilloEscena } from "@/lib/cielo-render";
import {
  cuerposCielo,
  UMBRAL_BRILLO_PLANETAS,
  type CuerpoCielo,
} from "@/lib/cielo-extras";

/** Ferrol, por defecto hasta que el buscador de municipios esté integrado. */
const FERROL: Observador = { lat: 43.4832, lon: -8.2369 };

/** Línea de tiempo: 19:15–21:30 CEST del 12-08-2026 (CEST = UT+2). */
const T_MIN = Date.UTC(2026, 7, 12, 17, 15, 0);
const T_MAX = Date.UTC(2026, 7, 12, 19, 30, 0);
const CEST_OFFSET_MS = 2 * 3600_000;

/** Lista vacía estable para cuando el cielo es demasiado brillante. */
const SIN_CUERPOS: CuerpoCielo[] = [];

const ANCHO_CANVAS = 960;
const ALTO_CANVAS = 540;

function formatoCEST(tMs: number, conSegundos = true): string {
  const iso = new Date(tMs + CEST_OFFSET_MS).toISOString();
  return iso.slice(11, conSegundos ? 19 : 16);
}

function formatoPorcentaje(fraccion: number, decimales = 1): string {
  return (fraccion * 100).toFixed(decimales).replace(".", ",");
}

export interface VistaCieloProps {
  /** Observador (lat/lon). Por defecto, Ferrol. */
  observador?: Observador;
}

export default function VistaCielo({ observador = FERROL }: VistaCieloProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Motor astronómico: se calcula una sola vez por Observador (las
  // Circunstancias locales son la parte cara; el resto es barato por frame).
  const engine = useMemo(() => createEclipseEngine(observador), [observador]);
  const circ = engine.circunstancias;

  // Cámara fija mirando al acimut del Sol en el Máximo.
  const cfg = useMemo(() => {
    const acimutSol = engine.sunMoonPositions(circ.maximo.instante).sol.acimut;
    return configEscena(acimutSol, ANCHO_CANVAS, ALTO_CANVAS);
  }, [engine, circ]);

  const enTotalidad = useCallback(
    (t: number): boolean =>
      circ.tipo === "total" &&
      t >= circ.c2!.instante.getTime() &&
      t <= circ.c3!.instante.getTime(),
    [circ],
  );

  const c2Ms = circ.c2 ? circ.c2.instante.getTime() : null;
  const c3Ms = circ.c3 ? circ.c3.instante.getTime() : null;

  // Cuerpos celestes extra (planetas y estrellas reales): solo se calculan
  // cuando el cielo está lo bastante oscuro para verlos, y como mucho una
  // vez por segundo simulado (se mueven < 0,005°/s: invisible por frame).
  const cuerposCacheRef = useRef<{ clave: number; cuerpos: CuerpoCielo[] }>({
    clave: NaN,
    cuerpos: SIN_CUERPOS,
  });
  const obtenerCuerpos = useCallback(
    (t: number, obscuracion: number, dentroTotalidad: boolean): CuerpoCielo[] => {
      if (brilloEscena(obscuracion, dentroTotalidad) >= UMBRAL_BRILLO_PLANETAS) {
        return SIN_CUERPOS;
      }
      const clave = Math.round(t / 1000);
      if (cuerposCacheRef.current.clave !== clave) {
        cuerposCacheRef.current = {
          clave,
          cuerpos: cuerposCielo(observador, new Date(clave * 1000)),
        };
      }
      return cuerposCacheRef.current.cuerpos;
    },
    [observador],
  );

  const dibujar = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const fecha = new Date(t);
      const obscuracion = engine.obscurationAt(fecha);
      const dentroTotalidad = enTotalidad(t);
      dibujarEscena(ctx, {
        cfg,
        posiciones: engine.sunMoonPositions(fecha),
        obscuracion,
        enTotalidad: dentroTotalidad,
        tMs: t,
        c2Ms,
        c3Ms,
        cuerpos: obtenerCuerpos(t, obscuracion, dentroTotalidad),
      });
    },
    [cfg, engine, enTotalidad, c2Ms, c3Ms, obtenerCuerpos],
  );

  // Contactos locales en ms: alimentan la curva del modo resumen y los
  // botones de salto de los controles compartidos.
  const contactos = useMemo(
    (): ContactosMs => ({
      c1: circ.c1.instante.getTime(),
      c2: c2Ms,
      maximo: circ.maximo.instante.getTime(),
      c3: c3Ms,
      c4: circ.c4.instante.getTime(),
    }),
    [circ, c2Ms, c3Ms],
  );

  // Reloj de la Línea de tiempo: rAF + ref, pinta el canvas cada frame.
  const linea = useLineaDeTiempo({
    tMin: T_MIN,
    tMax: T_MAX,
    contactos,
    onFrame: dibujar,
  });
  const { tUi } = linea;

  const oscuracionUi = useMemo(
    () => engine.obscurationAt(new Date(tUi)),
    [engine, tUi],
  );

  // Nitidez en pantallas de alta densidad; repinta tras redimensionar
  // (cambiar el tamaño del canvas lo deja en blanco hasta el frame
  // siguiente).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = ANCHO_CANVAS * dpr;
      canvas.height = ALTO_CANVAS * dpr;
      canvas.getContext("2d")?.scale(dpr, dpr);
    }
    dibujar(tUi);
    // `tUi` cambia cada segundo simulado y el rAF ya pinta cada frame:
    // este efecto solo debe re-ejecutarse cuando cambia la escena.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dibujar]);

  // Marcas de Contactos sobre la Línea de tiempo.
  const marcas = useMemo(() => {
    const todas: Array<{ etiqueta: string; t: number }> = [
      { etiqueta: "C1", t: circ.c1.instante.getTime() },
      ...(circ.c2 ? [{ etiqueta: "C2", t: circ.c2.instante.getTime() }] : []),
      { etiqueta: "Máx", t: circ.maximo.instante.getTime() },
      ...(circ.c3 ? [{ etiqueta: "C3", t: circ.c3.instante.getTime() }] : []),
      { etiqueta: "C4", t: circ.c4.instante.getTime() },
    ];
    return todas.filter((m) => m.t >= T_MIN && m.t <= T_MAX);
  }, [circ]);

  const fase = (() => {
    if (enTotalidad(tUi)) return "TOTALIDAD";
    if (tUi < circ.c1.instante.getTime()) return "Antes del eclipse";
    if (tUi > circ.c4.instante.getTime()) return "Eclipse terminado";
    return "Parcial";
  })();

  return (
    <section
      aria-label="Vista Cielo"
      style={{ width: "100%", maxWidth: ANCHO_CANVAS, margin: "0 auto" }}
    >
      <h2 style={{ textAlign: "left", fontSize: "1.3rem", marginBottom: 8 }}>
        Vista Cielo
      </h2>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Simulación del cielo durante el eclipse"
        style={{
          width: "100%",
          aspectRatio: `${ANCHO_CANVAS} / ${ALTO_CANVAS}`,
          display: "block",
          borderRadius: 8,
          background: "#0b0d17",
        }}
      />

      {/* HUD: hora CEST, oscurecimiento y fase */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div
          style={{
            fontSize: "2.2rem",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
          }}
        >
          {formatoCEST(tUi)}{" "}
          <span style={{ fontSize: "0.9rem", opacity: 0.6 }}>CEST</span>
        </div>
        <div style={{ fontSize: "1.2rem", fontVariantNumeric: "tabular-nums" }}>
          Oscurecimiento: <strong>{formatoPorcentaje(oscuracionUi)} %</strong>
        </div>
        <div
          style={{
            fontSize: "1rem",
            fontWeight: fase === "TOTALIDAD" ? 700 : 400,
            color: fase === "TOTALIDAD" ? "#ffd98a" : "inherit",
          }}
        >
          {fase}
        </div>
      </div>

      {circ.tipo === "parcial" && (
        <p style={{ margin: "6px 0 0", opacity: 0.75, textAlign: "left" }}>
          máximo {formatoPorcentaje(circ.oscurecimientoMaximo)} % — sin
          totalidad aquí
        </p>
      )}

      {/* Línea de tiempo con marcas de Contactos y controles compartidos */}
      <ControlesTiempo
        tMin={T_MIN}
        tMax={T_MAX}
        linea={linea}
        contactos={contactos}
        marcas={marcas}
      />
    </section>
  );
}
