"use client";

/**
 * VistaCielo — simulación hiperrealista del cielo durante el eclipse del
 * 12-08-2026 desde un Observador (issue #39).
 *
 * Render principal: WebGL (`lib/cielo-gl.ts`) — dispersión atmosférica por
 * shader, corona real, Luna oclusora sin "pop", terreno con parallax,
 * ~50 estrellas y planetas reales. El terreno es el paisaje REAL del
 * Observador (issue #48, `lib/cielo-horizonte.ts`): silueta desde el
 * perfil de elevación por acimut, con horizonte marino donde toca; sin
 * datos, la silueta procedural. Interacción: arrastrar para mirar
 * alrededor (paneo de acimut 360° con inercia, `lib/cielo-camara.ts`),
 * botón de pantalla completa y calidad adaptativa (`lib/cielo-luz.ts`).
 *
 * Fallback: si WebGL no está disponible (o el contexto se pierde), el
 * canvas 2D clásico de `lib/cielo-draw.ts` con cámara fija.
 *
 * - Astronomía: `lib/eclipse-engine.ts` (única fuente de verdad).
 * - Reloj: `lib/reloj-tiempo.ts` vía `useLineaDeTiempo` — el reloj único;
 *   esta vista solo registra su `onFrame`.
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
import { useLineaDeTiempo } from "@/lib/useLineaDeTiempo";
import type { ContactosMs } from "@/lib/linea-tiempo-velocidad";
import { brilloEscena, proyectarAltAz, pxPorGrado } from "@/lib/cielo-render";
import {
  cuerposCielo,
  UMBRAL_BRILLO_PLANETAS,
  type CuerpoCielo,
} from "@/lib/cielo-extras";
import {
  arrastrarCamara,
  configVistaInmersiva,
  crearCamara,
  pasoInercia,
  soltarCamara,
  type CamaraCielo,
} from "@/lib/cielo-camara";
import {
  ajustarCalidad,
  altitudMinimaVisible,
  type EscalaCalidad,
} from "@/lib/cielo-luz";
import {
  alfaAparicion,
  cuerposDomo,
  type CuerpoDomo,
} from "@/lib/cielo-estrellas";
import { crearRendererCielo, type RendererCielo } from "@/lib/cielo-gl";
import {
  alturaPerfil,
  fetchPerfilCielo,
  texturaPerfil,
  type PerfilCielo,
} from "@/lib/cielo-horizonte";
import {
  alfaContornoLunar,
  dibujarHud,
  hintGafasVisible,
  hudActivoPorDefecto,
  marcasHorarias,
  TEXTO_HINT_GAFAS,
  type PuntoTrayectoria,
} from "@/lib/cielo-hud";
import { T_MAX, T_MIN } from "@/lib/reloj-tiempo";

/** Ferrol, por defecto hasta que el buscador de municipios esté integrado. */
const FERROL: Observador = { lat: 43.4832, lon: -8.2369 };

/** Listas vacías estables para cuando el cielo es demasiado brillante. */
const SIN_CUERPOS_2D: CuerpoCielo[] = [];
const SIN_CUERPOS_DOMO: CuerpoDomo[] = [];

/** Umbral de brillo por encima del cual ni Venus se ve: buffer vacío. */
const UMBRAL_BRILLO_DOMO = 0.32;

const ANCHO_CANVAS = 960;
const ALTO_CANVAS = 540;

/** Clave de localStorage que recuerda la elección del modo simulador. */
const CLAVE_MODO_SIMULADOR = "eclipse.modo-simulador";

/** Paso de muestreo de las trayectorias del HUD (3 min ≈ 46 puntos). */
const PASO_TRAYECTORIA_MS = 180_000;

function formatoPorcentaje(fraccion: number, decimales = 1): string {
  return (fraccion * 100).toFixed(decimales).replace(".", ",");
}

/** Estilo común de los botones superpuestos del canvas. */
const estiloBoton: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(11, 13, 23, 0.65)",
  color: "#dcd9e8",
  fontSize: 16,
  cursor: "pointer",
  lineHeight: 1,
  flexShrink: 0,
};

export interface VistaCieloProps {
  /** Observador (lat/lon). Por defecto, Ferrol. */
  observador?: Observador;
}

export default function VistaCielo({ observador = FERROL }: VistaCieloProps) {
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RendererCielo | null>(null);
  const etiquetasRef = useRef<HTMLDivElement | null>(null);

  const hudCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // "gl" mientras WebGL funcione; "2d" como fallback limpio.
  const [modoRender, setModoRender] = useState<"gl" | "2d">("gl");
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  // Vista con gafas de eclipse: disco naranja nítido, todo lo demás negro.
  const [modoGafas, setModoGafas] = useState(false);
  // Modo simulador (HUD): null hasta decidir en cliente (localStorage).
  const [modoSimulador, setModoSimulador] = useState<boolean | null>(null);

  // Motor astronómico: una sola vez por Observador.
  const engine = useMemo(() => createEclipseEngine(observador), [observador]);
  const circ = engine.circunstancias;

  const acimutSolMaximo = useMemo(
    () => engine.sunMoonPositions(circ.maximo.instante).sol.acimut,
    [engine, circ],
  );

  // Cámara inmersiva (solo modo GL): estado mutable fuera de React, la
  // muta el paneo y la lee el onFrame. Se recentra al cambiar de Observador.
  const camaraRef = useRef<CamaraCielo>(crearCamara(acimutSolMaximo));
  useEffect(() => {
    camaraRef.current = crearCamara(acimutSolMaximo);
  }, [acimutSolMaximo]);

  const enTotalidad = useCallback(
    (t: number): boolean =>
      circ.tipo === "total" &&
      t >= circ.c2!.instante.getTime() &&
      t <= circ.c3!.instante.getTime(),
    [circ],
  );

  const c2Ms = circ.c2 ? circ.c2.instante.getTime() : null;
  const c3Ms = circ.c3 ? circ.c3.instante.getTime() : null;
  const c1Ms = circ.c1.instante.getTime();
  const c4Ms = circ.c4.instante.getTime();

  // --- Modo simulador: elección recordada; por defecto, fuera de C1–C4 ----
  useEffect(() => {
    const guardado = window.localStorage.getItem(CLAVE_MODO_SIMULADOR);
    setModoSimulador(
      guardado !== null
        ? guardado === "1"
        : hudActivoPorDefecto(T_MIN, c1Ms, c4Ms),
    );
  }, [c1Ms, c4Ms]);

  const alternarSimulador = useCallback(() => {
    setModoSimulador((previo) => {
      const nuevo = !previo;
      window.localStorage.setItem(CLAVE_MODO_SIMULADOR, nuevo ? "1" : "0");
      return nuevo;
    });
  }, []);

  // Trayectorias de Sol y Luna de la ventana completa (memo por Observador).
  const trayectoria = useMemo((): PuntoTrayectoria[] => {
    const puntos: PuntoTrayectoria[] = [];
    for (let t = T_MIN; t <= T_MAX; t += PASO_TRAYECTORIA_MS) {
      const p = engine.sunMoonPositions(new Date(t));
      puntos.push({
        tMs: t,
        solAltitud: p.sol.altitud,
        solAcimut: p.sol.acimut,
        lunaAltitud: p.luna.altitud,
        lunaAcimut: p.luna.acimut,
      });
    }
    return puntos;
  }, [engine]);

  const marcas = useMemo(() => {
    const formato = new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Madrid",
    });
    return marcasHorarias(T_MIN, T_MAX, 3_600_000).map((tMs) => ({
      tMs,
      etiqueta: formato.format(new Date(tMs)),
    }));
  }, []);

  // --- Perfil real del horizonte (issue #48) ------------------------------
  // El paisaje del render es el del Observador: alturas angulares reales
  // por acimut (sector del eclipse compartido con el panel + resto del
  // círculo, ver cielo-horizonte.ts). Solo se recalcula al cambiar de
  // Observador; si la API falla, queda el terreno procedural (null).
  const [perfilCielo, setPerfilCielo] = useState<PerfilCielo | null>(null);

  // Gating del gasto (issue #61): el resto del círculo (la parte que solo
  // pinta paisaje) no se pide hasta que el canvas GL haya asomado al
  // viewport. Cerrojo de un solo sentido: una vez visto, visto — la
  // petición es una por municipio y la caché absorbe el resto.
  const [cieloVisto, setCieloVisto] = useState(false);
  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor || typeof IntersectionObserver === "undefined") {
      // Sin observer (navegador antiguo): mejor el paisaje real que ahorrar.
      setCieloVisto(true);
      return;
    }
    const observer = new IntersectionObserver((entradas) => {
      if (entradas.some((entrada) => entrada.isIntersecting)) {
        setCieloVisto(true);
        observer.disconnect();
      }
    });
    observer.observe(contenedor);
    return () => observer.disconnect();
  }, []);

  // Al cambiar de Observador, el perfil anterior deja de valer aunque la
  // petición del nuevo esté gateada (nunca pintar el relieve de otro sitio).
  useEffect(() => {
    setPerfilCielo(null);
  }, [engine, circ, observador.lat, observador.lon]);

  useEffect(() => {
    // El perfil de 360° solo se pide con el render WebGL activo y visible
    // (issue #61): el fallback 2D no lo usa, y sin asomar al viewport no
    // hay nada que pintar. El sector del panel no pasa por aquí.
    if (modoRender !== "gl" || !cieloVisto) return;
    let cancelado = false;
    const acimutC1 = engine.sunMoonPositions(circ.c1.instante).sol.acimut;
    const acimutC4 = engine.sunMoonPositions(circ.c4.instante).sol.acimut;
    fetchPerfilCielo(
      { lat: observador.lat, lon: observador.lon },
      acimutC1,
      acimutC4,
    )
      .then((perfil) => {
        if (!cancelado) setPerfilCielo(perfil);
      })
      .catch(() => {
        // Sin datos de elevación: el shader mantiene la silueta procedural.
      });
    return () => {
      cancelado = true;
    };
  }, [engine, circ, observador.lat, observador.lon, modoRender, cieloVisto]);

  // --- Cuerpos del domo (GL): cacheados por segundo simulado --------------
  const domoCacheRef = useRef<{ clave: number; cuerpos: CuerpoDomo[] }>({
    clave: NaN,
    cuerpos: SIN_CUERPOS_DOMO,
  });
  const obtenerCuerposDomo = useCallback(
    (t: number, brillo: number): CuerpoDomo[] => {
      if (brillo >= UMBRAL_BRILLO_DOMO) return SIN_CUERPOS_DOMO;
      const clave = Math.round(t / 1000);
      if (domoCacheRef.current.clave !== clave) {
        const todos = cuerposDomo(observador, new Date(clave * 1000));
        domoCacheRef.current = {
          clave,
          // El terreno oculta lo que queda tras su silueta (el shader no
          // conoce las colinas en el pase de estrellas). Con perfil real,
          // la silueta es la del Observador: sobre el mar se ven estrellas
          // hasta casi el horizonte; tras un monte real, no.
          cuerpos: todos.filter((c) =>
            perfilCielo
              ? c.altitud > alturaPerfil(perfilCielo.alturas, c.acimut)
              : c.altitud > altitudMinimaVisible(c.acimut),
          ),
        };
      }
      return domoCacheRef.current.cuerpos;
    },
    [observador, perfilCielo],
  );

  // --- Cuerpos del fallback 2D: mismo cacheo que la versión clásica -------
  const cuerpos2dCacheRef = useRef<{ clave: number; cuerpos: CuerpoCielo[] }>({
    clave: NaN,
    cuerpos: SIN_CUERPOS_2D,
  });
  const obtenerCuerpos2d = useCallback(
    (t: number, obscuracion: number, dentroTotalidad: boolean): CuerpoCielo[] => {
      if (brilloEscena(obscuracion, dentroTotalidad) >= UMBRAL_BRILLO_PLANETAS) {
        return SIN_CUERPOS_2D;
      }
      const clave = Math.round(t / 1000);
      if (cuerpos2dCacheRef.current.clave !== clave) {
        cuerpos2dCacheRef.current = {
          clave,
          cuerpos: cuerposCielo(observador, new Date(clave * 1000)),
        };
      }
      return cuerpos2dCacheRef.current.cuerpos;
    },
    [observador],
  );

  // --- Calidad adaptativa y reloj de animación ----------------------------
  const calidadRef = useRef<{ escala: EscalaCalidad; emaMs: number; frames: number }>(
    { escala: 1, emaMs: 16, frames: 0 },
  );
  const animRef = useRef<{ previo: number | null }>({ previo: null });

  // --- Pintor GL ----------------------------------------------------------
  const dibujarGL = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) return;

      // dt real (reloj de pared) para la inercia y la calidad adaptativa.
      const ahora = performance.now();
      const previo = animRef.current.previo;
      const dtMs = previo === null ? 16 : Math.min(100, ahora - previo);
      animRef.current.previo = ahora;

      // Inercia del paneo.
      camaraRef.current = pasoInercia(camaraRef.current, dtMs / 1000);

      // Calidad adaptativa: media móvil del coste; decide cada ~90 frames.
      const cal = calidadRef.current;
      cal.emaMs = cal.emaMs * 0.95 + dtMs * 0.05;
      if (++cal.frames >= 90) {
        cal.frames = 0;
        cal.escala = ajustarCalidad(cal.emaMs, cal.escala);
      }

      // Tamaño del buffer: CSS × dpr × escala de calidad.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const anchoBuf = Math.max(2, Math.round(canvas.clientWidth * dpr * cal.escala));
      const altoBuf = Math.max(2, Math.round(canvas.clientHeight * dpr * cal.escala));
      renderer.redimensionar(anchoBuf, altoBuf);

      const fecha = new Date(t);
      const posiciones = engine.sunMoonPositions(fecha);
      const obscuracion = engine.obscurationAt(fecha);
      const dentroTotalidad = enTotalidad(t);
      const brillo = brilloEscena(obscuracion, dentroTotalidad);
      const cfg = configVistaInmersiva(
        anchoBuf,
        altoBuf,
        camaraRef.current.acimutCentro,
        posiciones.sol.radioAparente,
      );
      const cuerpos = obtenerCuerposDomo(t, brillo);

      renderer.dibujar({
        cfg,
        posiciones,
        brillo,
        obscuracion,
        enTotalidad: dentroTotalidad,
        tMs: t,
        c2Ms,
        c3Ms,
        tAnimS: ahora / 1000,
        cuerpos,
        modoGafas,
      });

      // Overlay del modo simulador (canvas 2D transparente encima del GL).
      const hud = hudCanvasRef.current;
      const ctxHud = hud?.getContext("2d");
      if (hud && ctxHud) {
        const anchoHud = Math.round(canvas.clientWidth * dpr);
        const altoHud = Math.round(canvas.clientHeight * dpr);
        if (hud.width !== anchoHud) hud.width = anchoHud;
        if (hud.height !== altoHud) hud.height = altoHud;
        if (modoSimulador && !modoGafas) {
          dibujarHud(ctxHud, {
            cfg: configVistaInmersiva(
              anchoHud,
              altoHud,
              camaraRef.current.acimutCentro,
              posiciones.sol.radioAparente,
            ),
            trayectoria,
            marcas,
            posiciones,
            alfaContorno: alfaContornoLunar(t, c2Ms, c3Ms),
          });
        } else {
          ctxHud.clearRect(0, 0, anchoHud, altoHud);
        }
      }

      // Etiquetas de planetas: divs superpuestos, actualizados por frame
      // (siguen el paneo sin re-render de React).
      const capa = etiquetasRef.current;
      if (capa) {
        const escalaCss = canvas.clientWidth / anchoBuf;
        for (const hijo of Array.from(capa.children) as HTMLDivElement[]) {
          const nombre = hijo.dataset.nombre!;
          const cuerpo = modoGafas
            ? undefined // con las gafas puestas solo se ve la fotosfera
            : cuerpos.find((c) => c.tipo === "planeta" && c.nombre === nombre);
          if (!cuerpo) {
            hijo.style.opacity = "0";
            continue;
          }
          const alfa = alfaAparicion(cuerpo.magnitud, brillo);
          const p = proyectarAltAz(cuerpo.altitud, cuerpo.acimut, cfg);
          const dentro =
            alfa > 0.05 &&
            p.x >= 0 &&
            p.x <= anchoBuf &&
            p.y >= 0 &&
            p.y <= altoBuf;
          hijo.style.opacity = dentro ? (0.75 * alfa).toFixed(2) : "0";
          if (dentro) {
            hijo.style.transform = `translate(${(p.x * escalaCss).toFixed(1)}px, ${(p.y * escalaCss - 16).toFixed(1)}px) translate(-50%, -100%)`;
          }
        }
      }
    },
    [
      engine,
      enTotalidad,
      c2Ms,
      c3Ms,
      obtenerCuerposDomo,
      modoGafas,
      modoSimulador,
      trayectoria,
      marcas,
    ],
  );

  // --- Pintor 2D (fallback): la vista clásica con cámara fija -------------
  const cfg2d = useMemo(
    () => configEscena(acimutSolMaximo, ANCHO_CANVAS, ALTO_CANVAS),
    [acimutSolMaximo],
  );
  const dibujar2d = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const fecha = new Date(t);
      const obscuracion = engine.obscurationAt(fecha);
      const dentroTotalidad = enTotalidad(t);
      dibujarEscena(ctx, {
        cfg: cfg2d,
        posiciones: engine.sunMoonPositions(fecha),
        obscuracion,
        enTotalidad: dentroTotalidad,
        tMs: t,
        c2Ms,
        c3Ms,
        cuerpos: obtenerCuerpos2d(t, obscuracion, dentroTotalidad),
      });
    },
    [cfg2d, engine, enTotalidad, c2Ms, c3Ms, obtenerCuerpos2d],
  );

  const dibujar = modoRender === "gl" ? dibujarGL : dibujar2d;

  // Contactos locales: alimentan la curva del modo resumen del reloj.
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

  // El reloj compartido: además del pintor, esta vista usa su API pública
  // para el mini-reproductor de la pantalla completa (la BarraTiempo global
  // queda fuera del elemento fullscreen).
  const { tUi, reproduciendo, alternarReproduccion, saltarA } =
    useLineaDeTiempo({ contactos, onFrame: dibujar });

  // Hint didáctico de gafas (#56): durante la parcialidad apreciable, la
  // UI enseña que el mordisco solo se ve con filtro. tUi va cuantizado al
  // segundo: una obscuración por segundo de UI, no por frame.
  const oscUi = useMemo(
    () => engine.obscurationAt(new Date(tUi)),
    [engine, tUi],
  );
  const hintGafas = hintGafasVisible(oscUi, modoGafas);

  // --- Creación del renderer GL (y fallback limpio si no hay WebGL) -------
  useEffect(() => {
    if (modoRender !== "gl") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = crearRendererCielo(canvas);
    if (!renderer) {
      setModoRender("2d");
      return;
    }
    rendererRef.current = renderer;
    const alPerderContexto = (e: Event) => {
      e.preventDefault();
      setModoRender("2d"); // mejor el 2D estable que esperar una restauración
    };
    canvas.addEventListener("webglcontextlost", alPerderContexto);
    return () => {
      canvas.removeEventListener("webglcontextlost", alPerderContexto);
      renderer.destruir();
      rendererRef.current = null;
    };
  }, [modoRender]);

  // Sube el perfil real al renderer cuando llega (o al recrearse el
  // renderer). Declarado tras el efecto de creación: en un cambio de modo,
  // primero existe el renderer y después recibe el perfil.
  useEffect(() => {
    rendererRef.current?.actualizarPerfil(
      perfilCielo ? texturaPerfil(perfilCielo) : null,
    );
  }, [modoRender, perfilCielo]);

  // Canvas 2D del fallback: nitidez en pantallas de alta densidad.
  useEffect(() => {
    if (modoRender !== "2d") return;
    const canvas = canvasRef.current;
    if (canvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = ANCHO_CANVAS * dpr;
      canvas.height = ALTO_CANVAS * dpr;
      canvas.getContext("2d")?.scale(dpr, dpr);
    }
    dibujar2d(tUi);
    // Solo debe re-ejecutarse al cambiar de modo o de escena.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoRender, dibujar2d]);

  // --- Paneo por arrastre (GL) --------------------------------------------
  const arrastreRef = useRef<{
    activo: boolean;
    xPrevio: number;
    tPrevio: number;
    velPxS: number;
  }>({ activo: false, xPrevio: 0, tPrevio: 0, velPxS: 0 });

  const ppgCss = useCallback((): number => {
    // px CSS por grado del encuadre actual (para convertir el arrastre).
    const canvas = canvasRef.current;
    if (!canvas || canvas.clientWidth === 0) return 9.6;
    return pxPorGrado(
      configVistaInmersiva(canvas.clientWidth, canvas.clientHeight, 0, 0.2665),
    );
  }, []);

  const alPulsar = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (modoRender !== "gl") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arrastreRef.current = {
      activo: true,
      xPrevio: e.clientX,
      tPrevio: performance.now(),
      velPxS: 0,
    };
  }, [modoRender]);

  const alMover = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = arrastreRef.current;
    if (!a.activo) return;
    const ahora = performance.now();
    const dx = e.clientX - a.xPrevio;
    const dt = Math.max(1, ahora - a.tPrevio) / 1000;
    // Velocidad instantánea suavizada (para la inercia al soltar).
    a.velPxS = a.velPxS * 0.7 + (dx / dt) * 0.3;
    a.xPrevio = e.clientX;
    a.tPrevio = ahora;
    camaraRef.current = arrastrarCamara(camaraRef.current, dx, ppgCss());
  }, [ppgCss]);

  const alSoltar = useCallback(() => {
    const a = arrastreRef.current;
    if (!a.activo) return;
    a.activo = false;
    // Si el puntero llevaba parado > 120 ms, soltar no da inercia.
    const parado = performance.now() - a.tPrevio > 120;
    camaraRef.current = soltarCamara(
      camaraRef.current,
      parado ? 0 : a.velPxS,
      ppgCss(),
    );
  }, [ppgCss]);

  // --- Pantalla completa (patrón reproductor de vídeo) ---------------------
  const alternarPantallaCompleta = useCallback(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      const promesa = contenedor.requestFullscreen?.();
      // En móvil, sugerir apaisado; muchos navegadores no lo permiten y
      // no pasa nada: try/catch silencioso.
      void promesa
        ?.then(() => {
          const orientacion = screen.orientation as unknown as {
            lock?: (o: string) => Promise<void>;
          };
          return orientacion.lock?.("landscape");
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", alCambiar);
    return () => document.removeEventListener("fullscreenchange", alCambiar);
  }, []);

  // Actividad del puntero: los controles superpuestos se muestran al mover
  // el ratón o tocar y se auto-ocultan tras ~3 s quietos (estilo Netflix).
  const [actividad, setActividad] = useState(true);
  const temporizadorActividadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registrarActividad = useCallback(() => {
    setActividad(true);
    if (temporizadorActividadRef.current) {
      clearTimeout(temporizadorActividadRef.current);
    }
    temporizadorActividadRef.current = setTimeout(
      () => setActividad(false),
      3000,
    );
  }, []);
  useEffect(() => {
    registrarActividad(); // visibles al montar, para que se descubran
    return () => {
      if (temporizadorActividadRef.current) {
        clearTimeout(temporizadorActividadRef.current);
      }
    };
  }, [registrarActividad]);

  // Doble clic / doble toque sobre el canvas: alterna pantalla completa.
  const ultimoToqueRef = useRef(0);
  const alPulsarConDobleToque = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ahora = performance.now();
      if (ahora - ultimoToqueRef.current < 300) {
        ultimoToqueRef.current = 0;
        alternarPantallaCompleta();
      } else {
        ultimoToqueRef.current = ahora;
      }
      alPulsar(e);
    },
    [alPulsar, alternarPantallaCompleta],
  );

  // Hora CEST del mini-reproductor de pantalla completa.
  const formatoHora = useMemo(
    () =>
      new Intl.DateTimeFormat("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Europe/Madrid",
      }),
    [],
  );

  const fase = (() => {
    if (enTotalidad(tUi)) return "TOTALIDAD";
    if (tUi < circ.c1.instante.getTime()) return "Antes del eclipse";
    if (tUi > circ.c4.instante.getTime()) return "Eclipse terminado";
    return "Parcial";
  })();

  const esGL = modoRender === "gl";

  return (
    <section
      aria-label="Vista Cielo"
      style={{ width: "100%", maxWidth: ANCHO_CANVAS, margin: "0 auto" }}
    >
      <h2 style={{ textAlign: "left", fontSize: "1.3rem", marginBottom: 8 }}>
        Vista Cielo
      </h2>
      <div
        ref={contenedorRef}
        onPointerMove={registrarActividad}
        onPointerDown={registrarActividad}
        style={{
          position: "relative",
          background: "#0b0d17",
          borderRadius: pantallaCompleta ? 0 : 8,
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          key={modoRender}
          role="img"
          aria-label="Simulación del cielo durante el eclipse; arrastra para mirar alrededor y toca dos veces para pantalla completa"
          onPointerDown={alPulsarConDobleToque}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
          style={{
            width: "100%",
            height: pantallaCompleta ? "100vh" : undefined,
            aspectRatio: pantallaCompleta
              ? undefined
              : `${ANCHO_CANVAS} / ${ALTO_CANVAS}`,
            display: "block",
            cursor: esGL ? "grab" : "default",
            touchAction: esGL ? "pan-y" : "auto",
          }}
        />

        {/* Overlay del modo simulador: HUD de instrumento (canvas 2D
            transparente), pintado por frame desde dibujarGL. */}
        {esGL && (
          <canvas
            ref={hudCanvasRef}
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
        )}

        {/* Etiquetas de planetas (solo GL): capa superpuesta manejada por
            frame desde dibujarGL, sin re-render de React. */}
        {esGL && (
          <div
            ref={etiquetasRef}
            aria-hidden
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            {["Venus", "Júpiter", "Mercurio"].map((nombre) => (
              <div
                key={nombre}
                data-nombre={nombre}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  opacity: 0,
                  color: "#fff",
                  fontSize: 11,
                  textShadow: "0 0 4px rgba(0,0,0,0.8)",
                  transition: "opacity 0.3s",
                  willChange: "transform, opacity",
                }}
              >
                {nombre}
              </div>
            ))}
          </div>
        )}

        {/* Etiqueta de fase; la hora y el % los muestra la barra única. */}
        <div
          style={{
            position: "absolute",
            left: 10,
            bottom: 10,
            padding: "0.25rem 0.7rem",
            borderRadius: 999,
            background: "rgba(11, 13, 23, 0.65)",
            fontSize: "0.9rem",
            fontWeight: fase === "TOTALIDAD" ? 700 : 400,
            color: fase === "TOTALIDAD" ? "#ffd98a" : "#dcd9e8",
            pointerEvents: "none",
          }}
        >
          {fase}
        </div>

        {/* Controles superpuestos (patrón reproductor de vídeo): fade con
            la actividad del puntero; en pantalla completa incluye el
            mini-reproductor sobre el reloj compartido (la BarraTiempo
            global queda fuera del elemento fullscreen). */}
        {esGL && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: pantallaCompleta ? "14px 16px" : "10px",
              background: pantallaCompleta
                ? "linear-gradient(transparent, rgba(5, 6, 12, 0.8))"
                : "none",
              opacity: actividad ? 1 : 0,
              transition: "opacity 0.35s",
              pointerEvents: actividad ? "auto" : "none",
            }}
          >
            {pantallaCompleta && (
              <>
                <button
                  type="button"
                  onClick={alternarReproduccion}
                  aria-label={reproduciendo ? "Pausa" : "Reproducir"}
                  style={estiloBoton}
                >
                  {reproduciendo ? "⏸" : "⏵"}
                </button>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "0.9rem",
                    color: "#dcd9e8",
                  }}
                >
                  {formatoHora.format(new Date(tUi))}
                </span>
                <input
                  type="range"
                  min={T_MIN}
                  max={T_MAX}
                  step={1000}
                  value={tUi}
                  onChange={(e) => saltarA(Number(e.target.value))}
                  aria-label="Línea de tiempo"
                  style={{ flex: 1, accentColor: "#ffd98a", minWidth: 0 }}
                />
              </>
            )}
            <span style={{ flex: pantallaCompleta ? undefined : 1 }} />
            <button
              type="button"
              onClick={alternarSimulador}
              aria-pressed={modoSimulador === true}
              aria-label="Modo simulador: trayectorias y Luna fantasma"
              title="Modo simulador"
              style={{
                ...estiloBoton,
                color: modoSimulador ? "#7fd4ff" : "#dcd9e8",
                borderColor: modoSimulador
                  ? "rgba(127, 212, 255, 0.6)"
                  : "rgba(255,255,255,0.25)",
              }}
            >
              ⌖
            </button>
            {/* Hint didáctico (#56): sutil, junto al conmutador 👓. */}
            <span
              aria-hidden={!hintGafas}
              style={{
                fontSize: 11,
                lineHeight: 1.25,
                maxWidth: 150,
                textAlign: "right",
                color: "#ffd98a",
                textShadow: "0 0 4px rgba(0,0,0,0.8)",
                opacity: hintGafas ? 0.85 : 0,
                transition: "opacity 0.4s",
                pointerEvents: "none",
              }}
            >
              {TEXTO_HINT_GAFAS}
            </span>
            <button
              type="button"
              onClick={() => setModoGafas((v) => !v)}
              aria-pressed={modoGafas}
              aria-label="Vista con gafas de eclipse"
              title="Vista con gafas de eclipse"
              style={{
                ...estiloBoton,
                color: modoGafas ? "#ffb05c" : "#dcd9e8",
                borderColor: modoGafas
                  ? "rgba(255, 176, 92, 0.6)"
                  : "rgba(255,255,255,0.25)",
              }}
            >
              👓
            </button>
            <button
              type="button"
              onClick={alternarPantallaCompleta}
              aria-label={
                pantallaCompleta
                  ? "Salir de pantalla completa"
                  : "Ver a pantalla completa"
              }
              style={estiloBoton}
            >
              {pantallaCompleta ? "🗗" : "⛶"}
            </button>
          </div>
        )}
      </div>

      {circ.tipo === "parcial" && (
        <p style={{ margin: "6px 0 0", opacity: 0.75, textAlign: "left" }}>
          máximo {formatoPorcentaje(circ.oscurecimientoMaximo)} % — sin
          totalidad aquí
        </p>
      )}
    </section>
  );
}
