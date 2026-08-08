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
 *
 * Reloj y render desacoplados: el tiempo simulado vive en un ref que un
 * bucle de requestAnimationFrame avanza y dibuja directamente en el canvas;
 * React solo re-renderiza el HUD cuando cambia el segundo mostrado.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createEclipseEngine, type Observador } from "@/lib/eclipse-engine";
import { configEscena, dibujarEscena } from "@/lib/cielo-draw";
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

/** Velocidades de reproducción: normal y saboreo de la Totalidad. */
const VELOCIDAD_NORMAL = 60;
const VELOCIDAD_TOTALIDAD = 5;

/**
 * Margen (ms) alrededor de C2/C3 en el que la reproducción ya va a cámara
 * lenta: cubre el anillo de diamante (±4 s) y las perlas de Baily (±1,5 s),
 * que a 60× durarían un parpadeo.
 */
const MARGEN_LENTO_MS = 8000;

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

  // Tiempo simulado: la verdad vive en el ref (avanzado por rAF);
  // el estado solo refleja el segundo mostrado en el HUD/slider.
  const tRef = useRef<number>(T_MIN);
  const ultimoSegRef = useRef<number>(T_MIN);
  const [tUi, setTUi] = useState<number>(T_MIN);
  const [reproduciendo, setReproduciendo] = useState(false);
  const reproduciendoRef = useRef(false);
  const [oscuracionUi, setOscuracionUi] = useState(0);

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

  // Bucle rAF: avanza el reloj si se reproduce y pinta cada frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      // Nitidez en pantallas de alta densidad.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = ANCHO_CANVAS * dpr;
      canvas.height = ALTO_CANVAS * dpr;
      canvas.getContext("2d")?.scale(dpr, dpr);
    }
    // Primer fotograma síncrono: el canvas nunca queda en blanco aunque
    // el rAF tarde (p. ej. pestaña en segundo plano).
    dibujar(tRef.current);

    let raf = 0;
    let previo = performance.now();
    const paso = (ahora: number) => {
      const dtMs = ahora - previo;
      previo = ahora;
      if (reproduciendoRef.current) {
        // Cámara lenta en la Totalidad y en su antesala/salida (anillo de
        // diamante y perlas de Baily viven a segundos de C2/C3).
        const t = tRef.current;
        const cercaDeContactos =
          c2Ms !== null &&
          c3Ms !== null &&
          t >= c2Ms - MARGEN_LENTO_MS &&
          t <= c3Ms + MARGEN_LENTO_MS;
        const velocidad =
          enTotalidad(t) || cercaDeContactos
            ? VELOCIDAD_TOTALIDAD
            : VELOCIDAD_NORMAL;
        tRef.current = Math.min(tRef.current + dtMs * velocidad, T_MAX);
        if (tRef.current >= T_MAX) {
          reproduciendoRef.current = false;
          setReproduciendo(false);
        }
      }
      dibujar(tRef.current);
      // HUD: solo re-render de React cuando cambia el segundo mostrado.
      const seg = Math.floor(tRef.current / 1000) * 1000;
      if (seg !== ultimoSegRef.current) {
        ultimoSegRef.current = seg;
        setTUi(seg);
        setOscuracionUi(engine.obscurationAt(new Date(seg)));
      }
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [dibujar, enTotalidad, engine, c2Ms, c3Ms]);

  const alternarReproduccion = () => {
    if (!reproduciendo && tRef.current >= T_MAX) {
      tRef.current = T_MIN; // volver a empezar desde el principio
    }
    reproduciendoRef.current = !reproduciendo;
    setReproduciendo(!reproduciendo);
  };

  const alCambiarSlider = (valor: number) => {
    tRef.current = valor;
    ultimoSegRef.current = valor;
    setTUi(valor);
    setOscuracionUi(engine.obscurationAt(new Date(valor)));
    dibujar(valor); // feedback inmediato al arrastrar, sin esperar al rAF
  };

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

      {/* Línea de tiempo con marcas de Contactos */}
      <div style={{ position: "relative", marginTop: 28 }}>
        {marcas.map((m) => {
          const pct = ((m.t - T_MIN) / (T_MAX - T_MIN)) * 100;
          return (
            <div
              key={m.etiqueta}
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: -20,
                transform: "translateX(-50%)",
                fontSize: "0.72rem",
                opacity: 0.85,
                textAlign: "center",
                pointerEvents: "none",
              }}
              title={`${m.etiqueta} — ${formatoCEST(m.t)} CEST`}
            >
              {m.etiqueta}
              <div
                style={{
                  width: 1,
                  height: 8,
                  background: "currentColor",
                  margin: "1px auto 0",
                }}
              />
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={alternarReproduccion}
            aria-label={reproduciendo ? "Pausar" : "Reproducir"}
            style={{
              fontSize: "1.1rem",
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.35)",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            {reproduciendo ? "⏸" : "▶"}
          </button>
          <input
            type="range"
            min={T_MIN}
            max={T_MAX}
            step={1000}
            value={tUi}
            onChange={(e) => alCambiarSlider(Number(e.target.value))}
            aria-label="Línea de tiempo del eclipse"
            style={{ flex: 1, accentColor: "#ffd98a" }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.75rem",
            opacity: 0.5,
            marginLeft: 56,
          }}
        >
          <span>{formatoCEST(T_MIN, false)}</span>
          <span>{formatoCEST(T_MAX, false)}</span>
        </div>
      </div>
    </section>
  );
}
