"use client";

/**
 * VistaAstros — la geometría Sol–Luna–Tierra vista desde el espacio
 * (issue #37): sección plegable "¿Por qué pasa esto?" bajo la Vista Mapa,
 * con un diagrama SVG ligero del Sol a la izquierda, la Luna en su órbita
 * y la Tierra a la derecha, y los conos de umbra y penumbra proyectándose
 * desde la Luna.
 *
 * La escala es didáctica (distancias comprimidas, tamaños exagerados: a
 * escala real no se vería nada) pero los ángulos que importan salen de la
 * astronomía real para el instante del reloj compartido (`lib/astros.ts`):
 * la posición de la Luna sigue su elongación real, el eje de la sombra se
 * desplaza según la latitud eclíptica lunar (γ ≈ +0.9: por eso roza el
 * norte del globo) y el punto de contacto del cono recorre el disco
 * terrestre igual que la umbra real recorre el mapa — a las 18:27 UT
 * (20:27 CEST) toca el norte de la Península, marcada con su silueta.
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
  geometriaAstros,
  LIENZO_ASTROS,
  posicionLunaDiagrama,
  puntoEjeEnTierra,
  trayectoriaContacto,
  type GeometriaAstros,
  type Punto,
} from "@/lib/astros";
import { T_MAX, T_MIN, useLineaDeTiempo } from "@/lib/useLineaDeTiempo";

const L = LIENZO_ASTROS;
/** Borde derecho del cono de penumbra dibujado (algo más allá de la Tierra). */
const X_FIN_PENUMBRA = 818;

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

function textoEstado(geo: GeometriaAstros): string {
  return geo.umbraTocaTierra
    ? "La punta de la umbra está tocando la Tierra: en el punto dorado el Sol queda completamente tapado — eclipse total."
    : "La punta de la umbra ya no toca la superficie: el eclipse total ha terminado (la penumbra aún deja un eclipse parcial).";
}

export default function VistaAstros() {
  const [abierta, setAbierta] = useState(false);

  const lunaRef = useRef<SVGCircleElement | null>(null);
  const etiquetaLunaRef = useRef<SVGTextElement | null>(null);
  const umbraRef = useRef<SVGPolygonElement | null>(null);
  const penumbraRef = useRef<SVGPolygonElement | null>(null);
  const ejeRef = useRef<SVGLineElement | null>(null);
  const contactoRef = useRef<SVGGElement | null>(null);
  const estadoRef = useRef<HTMLParagraphElement | null>(null);
  const ultimoTRef = useRef<number | null>(null);

  const pintar = useCallback((t: number) => {
    if (ultimoTRef.current === t) return;
    ultimoTRef.current = t;

    const geo = geometriaAstros(new Date(t));
    const luna = posicionLunaDiagrama(geo);
    const eje = puntoEjeEnTierra(geo);

    lunaRef.current?.setAttribute("cx", luna.x.toFixed(1));
    lunaRef.current?.setAttribute("cy", luna.y.toFixed(1));
    etiquetaLunaRef.current?.setAttribute("x", luna.x.toFixed(1));
    etiquetaLunaRef.current?.setAttribute("y", (luna.y - L.radioLuna - 8).toFixed(1));

    umbraRef.current?.setAttribute("points", aPoints(conoUmbra(luna, eje)));
    penumbraRef.current?.setAttribute(
      "points",
      aPoints(conoPenumbra(luna, eje, X_FIN_PENUMBRA)),
    );

    const ejeEl = ejeRef.current;
    if (ejeEl) {
      ejeEl.setAttribute("x1", luna.x.toFixed(1));
      ejeEl.setAttribute("y1", luna.y.toFixed(1));
      ejeEl.setAttribute("x2", eje.x.toFixed(1));
      ejeEl.setAttribute("y2", eje.y.toFixed(1));
    }

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

  return (
    <section
      aria-label="Vista Astros"
      style={{ width: "100%", maxWidth: 960, margin: "0 auto", textAlign: "left" }}
    >
      <details
        onToggle={(e) => setAbierta((e.target as HTMLDetailsElement).open)}
        style={{
          background: "#0e1120",
          border: "1px solid #232742",
          borderRadius: 8,
          padding: "0.4rem 1rem 0.9rem",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontFamily: "var(--fuente-titulos), system-ui, sans-serif",
            fontSize: "1.3rem",
            padding: "0.5rem 0",
            color: "#ffe9a8",
          }}
        >
          ¿Por qué pasa esto?
        </summary>

        <p style={{ margin: "0.4rem 0 0.8rem", opacity: 0.85 }}>
          La Luna pasa exactamente entre el Sol y la Tierra y proyecta dos
          sombras: la <strong>umbra</strong> (el cono interior, donde el Sol
          queda tapado del todo) y la <strong>penumbra</strong> (donde solo se
          tapa en parte). Dale al play y mira cómo el cono barre la Tierra.
        </p>

        <svg
          viewBox="0 0 820 380"
          role="img"
          aria-label="Diagrama de la geometría Sol, Luna y Tierra con los conos de umbra y penumbra"
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
          </defs>

          {/* Órbita de la Luna: elipse decorativa, ligeramente inclinada
              (la órbita real está inclinada ~5° respecto a la eclíptica;
              el eclipse ocurre porque la Luna nueva pilla cerca del nodo). */}
          <ellipse
            cx={L.xTierra}
            cy={L.yEcliptica}
            rx={L.radioOrbita}
            ry={40}
            transform={`rotate(15 ${L.xTierra} ${L.yEcliptica})`}
            fill="none"
            stroke="#8892c8"
            strokeOpacity={0.35}
            strokeDasharray="3 5"
          />
          <text
            x={L.xTierra - L.radioOrbita - 4}
            y={L.yEcliptica + 46}
            fill="#8892c8"
            fontSize={11}
            textAnchor="middle"
            style={{ fontFamily: "var(--fuente-texto), system-ui, sans-serif" }}
          >
            órbita de la Luna
          </text>

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
                18:27 UT (20:27 CEST): junto al limbo, casi al ponerse el Sol. */}
            <polygon
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

          {/* Penumbra: cono divergente, tenue */}
          <polygon
            ref={penumbraRef}
            points={aPoints(conoPenumbra(lunaInicial, ejeInicial, X_FIN_PENUMBRA))}
            fill="#8892c8"
            fillOpacity={0.16}
            stroke="#8892c8"
            strokeOpacity={0.4}
            strokeWidth={0.8}
          />
          {/* Umbra: cono convergente, oscuro, con el vértice sobre la Tierra */}
          <polygon
            ref={umbraRef}
            points={aPoints(conoUmbra(lunaInicial, ejeInicial))}
            fill="#03040a"
            fillOpacity={0.78}
            stroke="#6a74a8"
            strokeOpacity={0.5}
            strokeWidth={0.8}
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

          {/* Punto de contacto de la umbra (eclipse total ahí) */}
          <g
            ref={contactoRef}
            display={GEO_INICIAL.umbraTocaTierra ? "inline" : "none"}
            transform={`translate(${ejeInicial.x.toFixed(1)} ${ejeInicial.y.toFixed(1)})`}
          >
            <circle r={8} fill="#ffd97a" fillOpacity={0.3} />
            <circle r={3.4} fill="#ffd97a" />
          </g>

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
            fontSize={13}
            style={{ fontFamily: "var(--fuente-texto), system-ui, sans-serif" }}
          >
            <text x={L.xSol} y={L.yEcliptica + L.radioSol + 26} textAnchor="middle">
              Sol
            </text>
            <text x={L.xTierra} y={L.yEcliptica + L.radioTierra + 26} textAnchor="middle">
              Tierra
            </text>
            <text
              ref={etiquetaLunaRef}
              x={lunaInicial.x}
              y={lunaInicial.y - L.radioLuna - 8}
              textAnchor="middle"
            >
              Luna
            </text>
            <text x={555} y={96} textAnchor="middle" fill="#b9c1e8" fontSize={12}>
              penumbra
            </text>
            <line x1={555} y1={102} x2={572} y2={132} stroke="#8892c8" strokeOpacity={0.5} />
            <text x={648} y={126} textAnchor="middle" fontSize={12}>
              umbra
            </text>
            <line x1={648} y1={132} x2={652} y2={152} stroke="#8892c8" strokeOpacity={0.5} />
            <text
              x={814}
              y={CONTACTO_PENINSULA.y - 18}
              textAnchor="end"
              fill="#ffd97a"
              fontSize={11.5}
            >
              España · 20:27
            </text>
          </g>
        </svg>

        <p
          ref={estadoRef}
          aria-live="polite"
          style={{ margin: "0.6rem 0 0", color: "#ffd97a", fontSize: "0.9rem" }}
        >
          {textoEstado(GEO_INICIAL)}
        </p>
        <p style={{ margin: "0.5rem 0 0", opacity: 0.6, fontSize: "0.8rem" }}>
          Distancias y tamaños no están a escala (a escala real no se vería
          nada), pero la posición de la Luna, el desplazamiento del eje de la
          sombra y el punto donde el cono toca la Tierra salen del cálculo
          astronómico para el instante del reloj. El eje pasa muy al norte del
          centro de la Tierra (γ ≈ +0,9): por eso la umbra solo roza el norte
          del globo — del Ártico a España, donde llega a las 20:27 justo antes
          de ponerse el Sol.
        </p>
      </details>
    </section>
  );
}
