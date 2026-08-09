"use client";

/**
 * VistaAstros — la geometría Sol–Luna–Tierra vista desde el espacio
 * (issues #37 y #54): diagrama SVG a ancho completo (960×440) del Sol a
 * la izquierda, la Luna en su órbita y la Tierra a la derecha, con los
 * conos de umbra y penumbra proyectándose desde la Luna.
 *
 * La escala es didáctica (distancias comprimidas, tamaños exagerados: a
 * escala real no se vería nada) pero los ángulos que importan salen de la
 * astronomía real para el instante del reloj compartido (`lib/astros.ts`):
 * la posición de la Luna sigue su elongación real (amplificada ×30), el
 * eje de la sombra se desplaza según la latitud eclíptica lunar (γ ≈ +0.9:
 * por eso roza el norte del globo) y el punto de contacto del cono recorre
 * el disco terrestre igual que la umbra real recorre el mapa — a las
 * 18:27 UT (20:27 CEST) toca el norte de la Península, marcada con su
 * silueta.
 *
 * Para que el movimiento se aprecie (feedback del issue #54), el diagrama
 * lleva referencias: la órbita de la Luna dibujada y etiquetada con una
 * flecha de dirección, una estela de posiciones pasadas que se desvanecen,
 * los contactos C1/Máx/C4 (calculados para Madrid) marcados sobre la
 * órbita, rayos del Sol animados con CSS (barato: nada por frame) y un
 * pulso dorado donde la umbra toca la superficie.
 *
 * Reloj: `lib/reloj-tiempo.ts` vía `useLineaDeTiempo`, como las demás
 * vistas — mismo t, mismo play, mismo bucle. El pintor actualiza atributos
 * SVG imperativamente (nada de re-render por frame) y solo se suscribe
 * con la sección desplegada.
 */

import { useCallback, useRef, useState } from "react";
import {
  conoPenumbra,
  conoUmbra,
  estelaLuna,
  geometriaAstros,
  LIENZO_ASTROS,
  posicionLunaDiagrama,
  posicionLunaEn,
  puntoEjeEnTierra,
  trayectoriaContacto,
  type GeometriaAstros,
  type Punto,
} from "@/lib/astros";
import { formatHoraLocal } from "@/lib/circunstancias-format";
import { circunstanciasLocales } from "@/lib/eclipse-engine";
import { T_MAX, T_MIN, useLineaDeTiempo } from "@/lib/useLineaDeTiempo";

const L = LIENZO_ASTROS;
/** Borde derecho del cono de penumbra dibujado (algo más allá de la Tierra). */
const X_FIN_PENUMBRA = 945;

/** Puntos de un polígono SVG. */
const aPoints = (puntos: readonly Punto[]): string =>
  puntos.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

/**
 * Cuantiza un punto a la décima de píxel. Los resultados de
 * astronomy-engine pueden diferir en ~1e-13 entre el servidor y el
 * cliente (sus cachés internas de interpolación dependen del historial de
 * llamadas de las otras vistas): sin redondear, React acusa un
 * "hydration mismatch" por diferencias subpíxel sin ningún significado.
 */
const redondear = (p: Punto): Punto => ({
  x: Math.round(p.x * 10) / 10,
  y: Math.round(p.y * 10) / 10,
});

/** Instante en que la umbra toca el norte de la Península: 18:27 UT. */
const T_PENINSULA = Date.UTC(2026, 7, 12, 18, 27, 0);

// Geometría precalculada (módulo): estado inicial del diagrama en T_MIN,
// posición de España en el disco (el punto del eje a las 18:27 UT) y la
// estela que el contacto barre durante la ventana, cada 5 min.
const GEO_INICIAL = geometriaAstros(new Date(T_MIN));
const CONTACTO_PENINSULA = redondear(
  puntoEjeEnTierra(geometriaAstros(new Date(T_PENINSULA))),
);
const TRAYECTORIA = trayectoriaContacto(T_MIN, T_MAX, 5 * 60_000).map(redondear);

// Estela de la Luna: posiciones pasadas sobre la rejilla de 10 min, que
// se desvanecen hacia atrás. El pintor solo la recalcula al cruzar el
// reloj un múltiplo del paso (el resto de frames no cuesta nada).
const PASO_ESTELA = 10 * 60_000;
const N_ESTELA = 8;
const ESTELA_INICIAL = estelaLuna(T_MIN, T_MIN, PASO_ESTELA, N_ESTELA).map(redondear);

// Regla temporal sobre la órbita: dónde está la Luna en los contactos
// C1/Máx/C4. Sin Observador elegido esta vista es global, así que usa la
// referencia nacional de siempre (Madrid), calculada — nunca tabulada.
const CONTACTOS_MADRID = circunstanciasLocales({ lat: 40.4168, lon: -3.7038 });
const MARCAS_ORBITA: ReadonlyArray<{
  etiqueta: string;
  punto: Punto;
  /** Desplazamiento vertical de la etiqueta (filas alternas, sin choques). */
  dy: number;
}> = [
  { etiqueta: "C1", instante: CONTACTOS_MADRID.c1.instante, dy: 19 },
  { etiqueta: "máx", instante: CONTACTOS_MADRID.maximo.instante, dy: 33 },
  { etiqueta: "C4", instante: CONTACTOS_MADRID.c4.instante, dy: 19 },
].map(({ etiqueta, instante, dy }) => ({
  etiqueta: `${etiqueta} · ${formatHoraLocal(instante).slice(0, 5)}`,
  punto: redondear(posicionLunaEn(instante.getTime())),
  dy,
}));

// Flecha de dirección del movimiento: sobre el recorrido real, justo por
// delante del tramo que la Luna barre durante la Línea de tiempo.
const FLECHA_BASE = redondear(posicionLunaEn(Date.UTC(2026, 7, 12, 19, 40)));
const FLECHA_PUNTA = redondear(posicionLunaEn(Date.UTC(2026, 7, 12, 19, 52)));
const FLECHA_ANGULO = (
  (Math.atan2(FLECHA_PUNTA.y - FLECHA_BASE.y, FLECHA_PUNTA.x - FLECHA_BASE.x) * 180) /
  Math.PI
).toFixed(1);

// Rayos del Sol: haz estático (la animación es CSS pura) radiando del Sol
// hacia la Luna y la Tierra.
const RAYOS: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }> = [
  -14, -9.3, -4.7, 0, 4.7, 9.3, 14,
].map((grados) => {
  const rad = (grados * Math.PI) / 180;
  const r1 = L.radioSol + 10;
  const r2 = 468;
  return {
    x1: Math.round((L.xSol + r1 * Math.cos(rad)) * 10) / 10,
    y1: Math.round((L.yEcliptica + r1 * Math.sin(rad)) * 10) / 10,
    x2: Math.round((L.xSol + r2 * Math.cos(rad)) * 10) / 10,
    y2: Math.round((L.yEcliptica + r2 * Math.sin(rad)) * 10) / 10,
  };
});

/** Umbral (px del lienzo) para resaltar España cuando el contacto se acerca. */
const UMBRAL_ESPANA = 26;

/**
 * Silueta esquemática de la Península Ibérica (unos 20 px de ancho),
 * centrada en el punto que el eje de la sombra toca a las 18:27 UT. Cae
 * junto al limbo del disco (el Sol está a punto de ponerse allí) y se
 * recorta contra él.
 */
const SILUETA_ESPANA: ReadonlyArray<[number, number]> = [
  [-9, -3], [-4, -5], [3, -5.5], [8, -4], [9.5, 0], [5, 4], [1, 6.5],
  [-4, 6], [-7.5, 3],
];

/** Etiqueta "umbra": dentro del cono, a un tercio del camino hacia el vértice. */
const posEtiquetaUmbra = (luna: Punto, eje: Punto): Punto => ({
  x: luna.x + (eje.x - luna.x) * 0.35,
  y: luna.y + (eje.y - luna.y) * 0.35 + 4,
});

/** Etiqueta "penumbra": bajo el borde superior del cono, a media distancia. */
const posEtiquetaPenumbra = (
  luna: Punto,
  cono: readonly [Punto, Punto, Punto, Punto],
): Punto => {
  const [t1, f1, f2, t2] = cono;
  const [borde, fin] = t1.y <= t2.y ? [t1, f1] : [t2, f2];
  const x = (luna.x + L.xTierra) / 2;
  const fraccion = (x - borde.x) / (fin.x - borde.x);
  return { x, y: borde.y + (fin.y - borde.y) * fraccion + 15 };
};

function textoEstado(geo: GeometriaAstros): string {
  return geo.umbraTocaTierra
    ? "La punta de la umbra está tocando la Tierra: en el punto dorado el Sol queda completamente tapado — eclipse total."
    : "La punta de la umbra ya no toca la superficie: el eclipse total ha terminado (la penumbra aún deja un eclipse parcial).";
}

export default function VistaAstros() {
  // Desplegada por defecto: escondida nadie la encontraba (feedback real).
  const [abierta, setAbierta] = useState(true);

  const lunaRef = useRef<SVGCircleElement | null>(null);
  const etiquetaLunaRef = useRef<SVGTextElement | null>(null);
  const umbraRef = useRef<SVGPolygonElement | null>(null);
  const penumbraRef = useRef<SVGPolygonElement | null>(null);
  const etiquetaUmbraRef = useRef<SVGTextElement | null>(null);
  const etiquetaPenumbraRef = useRef<SVGTextElement | null>(null);
  const ejeRef = useRef<SVGLineElement | null>(null);
  const verticeRef = useRef<SVGCircleElement | null>(null);
  const contactoRef = useRef<SVGGElement | null>(null);
  const siluetaRef = useRef<SVGPolygonElement | null>(null);
  const estelaRefs = useRef<Array<SVGCircleElement | null>>([]);
  const estadoRef = useRef<HTMLParagraphElement | null>(null);
  const ultimoTRef = useRef<number | null>(null);
  const gridEstelaRef = useRef<number | null>(null);
  const espanaResaltadaRef = useRef(false);

  const pintar = useCallback((t: number) => {
    if (ultimoTRef.current === t) return;
    ultimoTRef.current = t;

    const geo = geometriaAstros(new Date(t));
    const luna = posicionLunaDiagrama(geo);
    const eje = puntoEjeEnTierra(geo);

    lunaRef.current?.setAttribute("cx", luna.x.toFixed(1));
    lunaRef.current?.setAttribute("cy", luna.y.toFixed(1));
    etiquetaLunaRef.current?.setAttribute("x", luna.x.toFixed(1));
    etiquetaLunaRef.current?.setAttribute("y", (luna.y - L.radioLuna - 9).toFixed(1));

    umbraRef.current?.setAttribute("points", aPoints(conoUmbra(luna, eje)));
    const cono = conoPenumbra(luna, eje, X_FIN_PENUMBRA);
    penumbraRef.current?.setAttribute("points", aPoints(cono));

    // Etiquetas que viajan con sus conos.
    const eu = posEtiquetaUmbra(luna, eje);
    etiquetaUmbraRef.current?.setAttribute("x", eu.x.toFixed(1));
    etiquetaUmbraRef.current?.setAttribute("y", eu.y.toFixed(1));
    const ep = posEtiquetaPenumbra(luna, cono);
    etiquetaPenumbraRef.current?.setAttribute("x", ep.x.toFixed(1));
    etiquetaPenumbraRef.current?.setAttribute("y", ep.y.toFixed(1));

    const ejeEl = ejeRef.current;
    if (ejeEl) {
      ejeEl.setAttribute("x1", luna.x.toFixed(1));
      ejeEl.setAttribute("y1", luna.y.toFixed(1));
      ejeEl.setAttribute("x2", eje.x.toFixed(1));
      ejeEl.setAttribute("y2", eje.y.toFixed(1));
    }

    // El vértice del cono de luz, siempre dibujado: también cuando pasa
    // de largo y "no llega" a tocar la Tierra.
    verticeRef.current?.setAttribute("cx", eje.x.toFixed(1));
    verticeRef.current?.setAttribute("cy", eje.y.toFixed(1));

    const contactoEl = contactoRef.current;
    if (contactoEl) {
      if (geo.umbraTocaTierra) {
        contactoEl.setAttribute(
          "transform",
          `translate(${eje.x.toFixed(1)} ${eje.y.toFixed(1)})`,
        );
        contactoEl.setAttribute("display", "inline");
      } else {
        contactoEl.setAttribute("display", "none");
      }
    }

    // España se enciende cuando el punto de contacto se le acerca.
    const cerca =
      geo.umbraTocaTierra &&
      Math.hypot(eje.x - CONTACTO_PENINSULA.x, eje.y - CONTACTO_PENINSULA.y) <
        UMBRAL_ESPANA;
    if (cerca !== espanaResaltadaRef.current) {
      espanaResaltadaRef.current = cerca;
      const silueta = siluetaRef.current;
      if (silueta) {
        silueta.setAttribute("fill", cerca ? "#ffe9a8" : "#d9c89a");
        silueta.setAttribute("fill-opacity", cerca ? "1" : "0.75");
        silueta.setAttribute("stroke-opacity", cerca ? "1" : "0.7");
        silueta.setAttribute("stroke-width", cerca ? "1.6" : "0.8");
      }
    }

    // Estela de la Luna: solo recalcula al cruzar la rejilla del paso.
    const grid = Math.floor(t / PASO_ESTELA);
    if (grid !== gridEstelaRef.current) {
      gridEstelaRef.current = grid;
      const estela = estelaLuna(t, T_MIN, PASO_ESTELA, N_ESTELA);
      estelaRefs.current.forEach((punto, i) => {
        if (!punto) return;
        const p = estela[i];
        if (p) {
          punto.setAttribute("cx", p.x.toFixed(1));
          punto.setAttribute("cy", p.y.toFixed(1));
          punto.setAttribute("display", "inline");
        } else {
          punto.setAttribute("display", "none");
        }
      });
    }

    const estadoEl = estadoRef.current;
    if (estadoEl) {
      const texto = textoEstado(geo);
      if (estadoEl.textContent !== texto) estadoEl.textContent = texto;
    }
  }, []);

  // Reloj único compartido con las demás vistas; el pintor solo se
  // suscribe con la sección desplegada (plegada no hay nada que animar).
  useLineaDeTiempo({ onFrame: abierta ? pintar : undefined });

  // Estado inicial del diagrama (T_MIN), también para el SSR.
  const lunaInicial = redondear(posicionLunaDiagrama(GEO_INICIAL));
  const ejeInicial = redondear(puntoEjeEnTierra(GEO_INICIAL));
  const conoInicial = conoPenumbra(lunaInicial, ejeInicial, X_FIN_PENUMBRA);
  const etiquetaUmbraInicial = redondear(posEtiquetaUmbra(lunaInicial, ejeInicial));
  const etiquetaPenumbraInicial = redondear(
    posEtiquetaPenumbra(lunaInicial, conoInicial),
  );

  return (
    <section
      aria-label="Vista Astros"
      style={{ width: "100%", maxWidth: 960, margin: "0 auto", textAlign: "left" }}
    >
      <h2
        style={{
          textAlign: "left",
          fontSize: "var(--fs-titulo)",
          margin: "var(--sp-parrafo) 0 8px",
        }}
      >
        Vista Astros
      </h2>
      <details
        open
        onToggle={(e) => setAbierta((e.target as HTMLDetailsElement).open)}
        style={{
          background: "#0e1120",
          border: "1px solid #232742",
          borderRadius: 8,
          padding: "0.4rem var(--sp-tarjeta) 0.9rem",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontFamily: "var(--fuente-titulos), system-ui, sans-serif",
            fontSize: "var(--fs-cuerpo)",
            padding: "0.5rem 0",
            color: "#ffe9a8",
          }}
        >
          ¿Por qué pasa esto? — Sol, Luna y Tierra en directo
        </summary>

        <p
          style={{
            margin: "0.4rem 0 0.6rem",
            opacity: 0.85,
            fontSize: "var(--fs-cuerpo)",
          }}
        >
          La Luna pasa exactamente entre el Sol y la Tierra y proyecta dos
          sombras: la <strong>umbra</strong> (el cono interior, donde el Sol
          queda tapado del todo) y la <strong>penumbra</strong> (donde solo se
          tapa en parte). Dale al play y sigue la estela de la Luna por su
          órbita mientras el cono barre la Tierra.
        </p>

        {/* Estado actual, grande y sobre el diagrama (issue #54). */}
        <p
          ref={estadoRef}
          aria-live="polite"
          style={{
            margin: "0 0 0.6rem",
            color: "#ffd97a",
            fontSize: "var(--fs-subtitulo)",
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          {textoEstado(GEO_INICIAL)}
        </p>

        <svg
          className="va-svg"
          viewBox="0 0 960 440"
          role="img"
          aria-label="Diagrama de la geometría Sol, Luna y Tierra con la órbita de la Luna, los rayos del Sol y los conos de umbra y penumbra"
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <defs>
            <radialGradient id="astros-sol">
              <stop offset="0%" stopColor="#fff4d6" />
              <stop offset="55%" stopColor="#ffd97a" />
              <stop offset="100%" stopColor="#e8b23e" />
            </radialGradient>
            <radialGradient id="astros-halo-sol">
              <stop offset="0%" stopColor="#ffd97a" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#ffd97a" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="astros-tierra" cx="0.38" cy="0.35">
              <stop offset="0%" stopColor="#2f5585" />
              <stop offset="70%" stopColor="#1b3a63" />
              <stop offset="100%" stopColor="#122647" />
            </radialGradient>
            <clipPath id="astros-clip-tierra">
              <circle cx={L.xTierra} cy={L.yEcliptica} r={L.radioTierra} />
            </clipPath>
            {/* Animaciones baratas: CSS puro, ningún trabajo por frame. */}
            <style>{`
              @keyframes va-rayo-flujo { to { stroke-dashoffset: -44; } }
              @keyframes va-rayos-brillo {
                0%, 100% { opacity: 0.55; }
                50% { opacity: 1; }
              }
              @keyframes va-pulso-contacto {
                0% { transform: scale(0.4); opacity: 0.9; }
                70%, 100% { transform: scale(1.6); opacity: 0; }
              }
              .va-rayos { animation: va-rayos-brillo 7s ease-in-out infinite; }
              .va-rayos line { animation: va-rayo-flujo 5s linear infinite; }
              .va-pulso-contacto { animation: va-pulso-contacto 2.4s ease-out infinite; }
              @media (prefers-reduced-motion: reduce) {
                .va-rayos, .va-rayos line, .va-pulso-contacto { animation: none; }
              }
              /* Versión móvil de las etiquetas (issue #60): el viewBox de
                 960 px se escala a ~343 px a 375 px de ancho y los 11–15 px
                 de fuente quedarían en ~4–5 px reales. En pantallas
                 estrechas las etiquetas suben de cuerpo (la CSS pisa el
                 atributo font-size, solo aquí). */
              @media (max-width: 600px) {
                .va-svg text { font-size: 24px; }
                .va-svg text.va-txt-s { font-size: 18px; }
              }
            `}</style>
          </defs>

          {/* Órbita de la Luna: elipse discontinua ajustada al recorrido
              real dibujado (vista casi de canto, algo inclinada — la órbita
              real está inclinada ~5° respecto a la eclíptica y el eclipse
              ocurre porque la Luna nueva pilla cerca del nodo). Su mitad
              derecha pasa por detrás de la Tierra, que la oculta. */}
          <ellipse
            cx={L.xTierra}
            cy={L.yEcliptica}
            rx={L.radioOrbita}
            ry={16}
            transform={`rotate(15 ${L.xTierra} ${L.yEcliptica})`}
            fill="none"
            stroke="#9aa6dd"
            strokeOpacity={0.55}
            strokeWidth={1.5}
            strokeDasharray="7 7"
          />
          <text
            className="va-txt-s"
            x={638}
            y={168}
            fill="#9aa6dd"
            fontSize={12.5}
            textAnchor="end"
            style={{ fontFamily: "var(--fuente-texto), system-ui, sans-serif" }}
          >
            órbita de la Luna
          </text>
          {/* Flecha de dirección del movimiento, sobre el recorrido. */}
          <polygon
            points="0,-3.6 8,0 0,3.6"
            transform={`translate(${FLECHA_PUNTA.x} ${FLECHA_PUNTA.y}) rotate(${FLECHA_ANGULO})`}
            fill="#9aa6dd"
            fillOpacity={0.9}
          />

          {/* Regla temporal: la Luna en C1, Máximo y C4 (referencia Madrid),
              puntitos etiquetados sobre la órbita. */}
          <g style={{ fontFamily: "var(--fuente-texto), system-ui, sans-serif" }}>
            {MARCAS_ORBITA.map(({ etiqueta, punto, dy }) => (
              <g key={etiqueta}>
                <circle cx={punto.x} cy={punto.y} r={3} fill="#b9c1e8" />
                <text
                  className="va-txt-s"
                  x={punto.x}
                  y={punto.y + dy}
                  textAnchor="middle"
                  fill="#b9c1e8"
                  fontSize={11}
                >
                  {etiqueta}
                </text>
              </g>
            ))}
          </g>

          {/* Rayos del Sol: haz tenue radiando hacia la Luna y la Tierra,
              animado en CSS (flujo de guiones + brillo lento). */}
          <g
            className="va-rayos"
            stroke="#ffd97a"
            strokeOpacity={0.32}
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeDasharray="9 13"
          >
            {RAYOS.map((r, i) => (
              <line
                key={i}
                x1={r.x1}
                y1={r.y1}
                x2={r.x2}
                y2={r.y2}
                style={{ animationDelay: `${(i % 3) * -1.7}s` }}
              />
            ))}
          </g>

          {/* Sol */}
          <circle cx={L.xSol} cy={L.yEcliptica} r={L.radioSol * 1.9} fill="url(#astros-halo-sol)" />
          <circle cx={L.xSol} cy={L.yEcliptica} r={L.radioSol} fill="url(#astros-sol)" />

          {/* Tierra */}
          <circle
            cx={L.xTierra}
            cy={L.yEcliptica}
            r={L.radioTierra}
            fill="url(#astros-tierra)"
            stroke="#4a6b9e"
            strokeWidth={1.2}
          />
          <g clipPath="url(#astros-clip-tierra)">
            {/* Ecuador y meridiano esquemáticos */}
            <ellipse
              cx={L.xTierra}
              cy={L.yEcliptica}
              rx={L.radioTierra}
              ry={L.radioTierra * 0.32}
              fill="none"
              stroke="#9fb4d8"
              strokeOpacity={0.22}
            />
            <ellipse
              cx={L.xTierra}
              cy={L.yEcliptica}
              rx={L.radioTierra * 0.32}
              ry={L.radioTierra}
              fill="none"
              stroke="#9fb4d8"
              strokeOpacity={0.22}
            />
            {/* España esquemática, donde el eje de la sombra toca a las
                18:27 UT (20:27 CEST): junto al limbo, casi al ponerse el
                Sol. Se enciende cuando el punto de contacto se acerca. */}
            <polygon
              ref={siluetaRef}
              points={aPoints(
                SILUETA_ESPANA.map(([dx, dy]) => ({
                  x: CONTACTO_PENINSULA.x + dx,
                  y: CONTACTO_PENINSULA.y + dy,
                })),
              )}
              fill="#d9c89a"
              fillOpacity={0.75}
              stroke="#ffd97a"
              strokeOpacity={0.7}
              strokeWidth={0.8}
            />
          </g>

          {/* Penumbra: cono divergente, gris translúcido */}
          <polygon
            ref={penumbraRef}
            points={aPoints(conoInicial)}
            fill="#8892c8"
            fillOpacity={0.17}
            stroke="#8892c8"
            strokeOpacity={0.45}
            strokeWidth={0.9}
          />
          {/* Umbra: cono convergente, gris oscuro con borde definido y el
              vértice del cono de luz tras la Luna */}
          <polygon
            ref={umbraRef}
            points={aPoints(conoUmbra(lunaInicial, ejeInicial))}
            fill="#04050c"
            fillOpacity={0.88}
            stroke="#9aa4d4"
            strokeOpacity={0.75}
            strokeWidth={1.2}
          />
          {/* Eje de la sombra */}
          <line
            ref={ejeRef}
            x1={lunaInicial.x}
            y1={lunaInicial.y}
            x2={ejeInicial.x}
            y2={ejeInicial.y}
            stroke="#ffd97a"
            strokeOpacity={0.4}
            strokeDasharray="4 4"
            strokeWidth={1}
          />

          {/* Estela del contacto sobre el disco (trayectoria real, cada 5 min) */}
          <g clipPath="url(#astros-clip-tierra)">
            <polyline
              points={aPoints(TRAYECTORIA)}
              fill="none"
              stroke="#ffd97a"
              strokeOpacity={0.35}
              strokeDasharray="1.5 3.5"
              strokeWidth={1.4}
            />
          </g>

          {/* Vértice del cono: siempre visible, también cuando la punta
              pasa de largo y no llega a tocar la Tierra. */}
          <circle
            ref={verticeRef}
            cx={ejeInicial.x}
            cy={ejeInicial.y}
            r={3.2}
            fill="none"
            stroke="#ffd97a"
            strokeOpacity={0.75}
            strokeWidth={1.1}
          />

          {/* Punto de contacto de la umbra: destello dorado pulsante
              mientras toca superficie (eclipse total ahí). */}
          <g
            ref={contactoRef}
            display={GEO_INICIAL.umbraTocaTierra ? "inline" : "none"}
            transform={`translate(${ejeInicial.x.toFixed(1)} ${ejeInicial.y.toFixed(1)})`}
          >
            <circle
              className="va-pulso-contacto"
              r={11}
              fill="none"
              stroke="#ffd97a"
              strokeWidth={2}
            />
            <circle r={8} fill="#ffd97a" fillOpacity={0.3} />
            <circle r={3.6} fill="#ffd97a" />
          </g>

          {/* Estela de la Luna: posiciones pasadas que se desvanecen. */}
          {Array.from({ length: N_ESTELA }, (_, i) => {
            const p = ESTELA_INICIAL[i];
            return (
              <circle
                key={i}
                ref={(el) => {
                  estelaRefs.current[i] = el;
                }}
                cx={p ? p.x : 0}
                cy={p ? p.y : 0}
                r={Number((3 - i * 0.22).toFixed(2))}
                fill="#cfc9c0"
                opacity={Number((0.5 - i * 0.055).toFixed(3))}
                display={p ? "inline" : "none"}
              />
            );
          })}

          {/* Luna */}
          <circle
            ref={lunaRef}
            cx={lunaInicial.x}
            cy={lunaInicial.y}
            r={L.radioLuna}
            fill="#cfc9c0"
            stroke="#8f8a82"
            strokeWidth={1}
          />

          {/* Etiquetas */}
          <g
            fill="#dcd9e8"
            fontSize={15}
            style={{ fontFamily: "var(--fuente-texto), system-ui, sans-serif" }}
          >
            <text x={L.xSol} y={L.yEcliptica + L.radioSol + 28} textAnchor="middle">
              Sol
            </text>
            <text x={L.xTierra} y={L.yEcliptica + L.radioTierra + 28} textAnchor="middle">
              Tierra
            </text>
            <text
              ref={etiquetaLunaRef}
              x={lunaInicial.x}
              y={lunaInicial.y - L.radioLuna - 9}
              textAnchor="middle"
              fontSize={13}
            >
              Luna
            </text>
            {/* Etiquetas dentro de sus conos, viajan con ellos. */}
            <text
              ref={etiquetaUmbraRef}
              className="va-txt-s"
              x={etiquetaUmbraInicial.x}
              y={etiquetaUmbraInicial.y}
              textAnchor="middle"
              fill="#e6e9ff"
              fontSize={11.5}
              fontWeight={600}
            >
              umbra
            </text>
            <text
              ref={etiquetaPenumbraRef}
              className="va-txt-s"
              x={etiquetaPenumbraInicial.x}
              y={etiquetaPenumbraInicial.y}
              textAnchor="middle"
              fill="#b9c1e8"
              fontSize={12}
            >
              penumbra
            </text>
            <text
              className="va-txt-s"
              x={952}
              y={CONTACTO_PENINSULA.y - 20}
              textAnchor="end"
              fill="#ffd97a"
              fontSize={12}
            >
              España · 20:27
            </text>
          </g>
        </svg>

        <p style={{ margin: "0.5rem 0 0", opacity: 0.6, fontSize: "var(--fs-mini)" }}>
          Distancias y tamaños no están a escala (a escala real no se vería
          nada), pero la posición de la Luna, el desplazamiento del eje de la
          sombra y el punto donde el cono toca la Tierra salen del cálculo
          astronómico para el instante del reloj. Los puntitos C1 · máx · C4
          sobre la órbita marcan dónde está la Luna en los contactos
          calculados para Madrid. El eje pasa muy al norte del centro de la
          Tierra (γ ≈ +0,9): por eso la umbra solo roza el norte del globo —
          del Ártico a España, donde llega a las 20:27 justo antes de ponerse
          el Sol.
        </p>
      </details>
    </section>
  );
}
