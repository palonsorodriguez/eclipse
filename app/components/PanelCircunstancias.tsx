"use client";

import { useEffect, useMemo, useState } from "react";
import { createEclipseEngine } from "@/lib/eclipse-engine";
import type { Municipio } from "@/lib/municipios";
import {
  cuentaAtrasHasta,
  formatDuracionTotalidad,
  formatHoraLocal,
  formatPorcentaje,
  puntoCardinal,
} from "@/lib/circunstancias-format";
import {
  fetchPrevisionEclipse,
  type PrevisionEclipse,
} from "@/lib/meteo";
import {
  evaluarHorizonte,
  fetchPerfilHorizonte,
  type PerfilHorizonte,
} from "@/lib/horizonte";

interface Props {
  /** Observador seleccionado (municipio con lat/lon). */
  observador: Municipio;
}

/** Umbral de altitud solar (grados) bajo el cual avisamos del horizonte. */
const ALTITUD_AVISO_HORIZONTE = 15;

type EstadoMeteo =
  | { estado: "cargando" }
  | { estado: "ok"; prevision: PrevisionEclipse }
  | { estado: "error" };

type EstadoHorizonte =
  | { estado: "cargando" }
  | { estado: "ok"; perfil: PerfilHorizonte }
  | { estado: "error" };

/** Grados con un decimal a la española, p. ej. 1.24 → "1,2°". */
function formatGrados(grados: number): string {
  return `${grados.toFixed(1).replace(".", ",")}°`;
}

/** Punto (acimut, altitud) del recorrido del sol durante el eclipse. */
interface PuntoSol {
  acimut: number;
  altitud: number;
}

/**
 * Mini-gráfico de barras del perfil del horizonte (acimut × ángulo de
 * obstrucción) con el recorrido del sol (C1→C4) superpuesto en amarillo.
 */
function GraficoHorizonte({
  perfil,
  recorridoSol,
}: {
  perfil: PerfilHorizonte;
  recorridoSol: PuntoSol[];
}) {
  const ancho = 300;
  const alto = 110;
  const margen = { izq: 26, der: 6, sup: 8, inf: 16 };
  const plotW = ancho - margen.izq - margen.der;
  const plotH = alto - margen.sup - margen.inf;

  const barras = perfil.acimuts;
  const n = barras.length;

  // Eje X por acimut desenrollado (monótono aunque el sector cruce 0°).
  const acimutsDesenrollados: number[] = [];
  for (const [i, barra] of barras.entries()) {
    if (i === 0) {
      acimutsDesenrollados.push(barra.acimut);
    } else {
      const previo = acimutsDesenrollados[i - 1]!;
      const delta =
        ((barra.acimut - barras[i - 1]!.acimut + 540) % 360) - 180;
      acimutsDesenrollados.push(previo + delta);
    }
  }
  const acimutMin = acimutsDesenrollados[0]!;
  const acimutMax = acimutsDesenrollados[n - 1]!;
  const x = (acimut: number) => {
    const desenrollado =
      acimutMin + ((((acimut - acimutMin) % 360) + 540) % 360) - 180;
    return (
      margen.izq + ((desenrollado - acimutMin) / (acimutMax - acimutMin)) * plotW
    );
  };

  const maxObstruccion = Math.max(...barras.map((b) => b.angulo), 0);
  const maxSol = Math.max(...recorridoSol.map((p) => p.altitud), 0);
  const yMax = Math.max(maxObstruccion, maxSol, 8) * 1.15;
  const y = (grados: number) =>
    margen.sup + plotH - (Math.max(0, grados) / yMax) * plotH;

  const anchoBarra = (plotW / n) * 0.7;
  const lineaSol = recorridoSol
    .map((p) => `${x(p.acimut).toFixed(1)},${y(p.altitud).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      aria-label={`Perfil del horizonte por acimut (obstrucción máxima ${formatGrados(
        Math.max(0, maxObstruccion),
      )}) con la trayectoria del sol superpuesta`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {/* Rejilla y eje Y (0° y máximo) */}
      <line
        x1={margen.izq}
        y1={y(0)}
        x2={ancho - margen.der}
        y2={y(0)}
        stroke="#2c3155"
        strokeWidth="1"
      />
      <text x={margen.izq - 4} y={y(0) + 3} textAnchor="end" fontSize="8" fill="#8b90c9">
        0°
      </text>
      <text
        x={margen.izq - 4}
        y={margen.sup + 6}
        textAnchor="end"
        fontSize="8"
        fill="#8b90c9"
      >
        {Math.round(yMax)}°
      </text>

      {/* Barras de obstrucción del terreno */}
      {barras.map((barra) => (
        <rect
          key={barra.acimut}
          x={x(barra.acimut) - anchoBarra / 2}
          y={y(barra.angulo)}
          width={anchoBarra}
          height={Math.max(0, y(0) - y(barra.angulo))}
          fill="#7c83c4"
          opacity="0.8"
        />
      ))}

      {/* Recorrido del sol C1→C4 */}
      <polyline
        points={lineaSol}
        fill="none"
        stroke="#ffd97a"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Etiquetas de acimut (puntos cardinales de los extremos) */}
      <text
        x={margen.izq}
        y={alto - 4}
        textAnchor="start"
        fontSize="8"
        fill="#8b90c9"
      >
        {puntoCardinal(barras[0]!.acimut)} ({Math.round(barras[0]!.acimut)}°)
      </text>
      <text
        x={ancho - margen.der}
        y={alto - 4}
        textAnchor="end"
        fontSize="8"
        fill="#8b90c9"
      >
        {puntoCardinal(barras[n - 1]!.acimut)} ({Math.round(barras[n - 1]!.acimut)}°)
      </text>
    </svg>
  );
}

const estilos = {
  panel: {
    width: "100%",
    maxWidth: "64rem",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "1rem",
    textAlign: "left" as const,
  },
  tarjeta: {
    background: "#141830",
    border: "1px solid #2c3155",
    borderRadius: "0.75rem",
    padding: "1.25rem",
    color: "#e8e6f0",
  },
  titulo: {
    margin: "0 0 0.75rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#ffd97a",
  },
  filaContacto: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.3rem 0",
    borderBottom: "1px solid rgba(44, 49, 85, 0.6)",
  },
  etiqueta: { opacity: 0.75 },
  valor: { fontVariantNumeric: "tabular-nums" as const, fontWeight: 600 },
  aviso: {
    gridColumn: "1 / -1",
    background: "rgba(255, 217, 122, 0.12)",
    border: "1px solid #ffd97a",
    borderRadius: "0.75rem",
    padding: "1rem 1.25rem",
    color: "#ffd97a",
    fontWeight: 600,
  },
  seguridad: {
    gridColumn: "1 / -1",
    background: "#141830",
    border: "1px solid #2c3155",
    borderRadius: "0.75rem",
    padding: "0.9rem 1.25rem",
    color: "#e8e6f0",
    fontSize: "0.95rem",
  },
} as const;

function FilaContacto({ nombre, hora }: { nombre: string; hora: string }) {
  return (
    <div style={estilos.filaContacto}>
      <span style={estilos.etiqueta}>{nombre}</span>
      <span style={estilos.valor}>{hora}</span>
    </div>
  );
}

/**
 * Panel de circunstancias locales y meteorología para el Observador:
 * horas locales de los Contactos C1–C4 y del Máximo, duración de la
 * Totalidad (o máximo sin totalidad), posición del sol en el Máximo,
 * cuenta atrás en vivo, previsión de nubosidad de Open-Meteo con
 * veredicto simple y perfil real del horizonte por relieve ("¿me tapará
 * el monte?") con veredicto marino / despejado / obstruido.
 */
export default function PanelCircunstancias({ observador }: Props) {
  const engine = useMemo(
    () => createEclipseEngine({ lat: observador.lat, lon: observador.lon }),
    [observador.lat, observador.lon],
  );
  const circ = engine.circunstancias;

  const posicionSolMaximo = useMemo(
    () => engine.sunMoonPositions(circ.maximo.instante).sol,
    [engine, circ],
  );

  // Cuenta atrás en vivo hasta el Máximo, actualizada cada segundo.
  const [ahora, setAhora] = useState<Date | null>(null);
  useEffect(() => {
    setAhora(new Date());
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const cuentaAtras = ahora ? cuentaAtrasHasta(circ.maximo.instante, ahora) : null;

  // Previsión Open-Meteo para el punto del Observador.
  const [meteo, setMeteo] = useState<EstadoMeteo>({ estado: "cargando" });
  useEffect(() => {
    let cancelado = false;
    setMeteo({ estado: "cargando" });
    fetchPrevisionEclipse(observador.lat, observador.lon)
      .then((prevision) => {
        if (!cancelado) setMeteo({ estado: "ok", prevision });
      })
      .catch(() => {
        if (!cancelado) setMeteo({ estado: "error" });
      });
    return () => {
      cancelado = true;
    };
  }, [observador.lat, observador.lon]);

  // Perfil real del horizonte por relieve hacia el sector del eclipse.
  const [horizonte, setHorizonte] = useState<EstadoHorizonte>({
    estado: "cargando",
  });
  useEffect(() => {
    let cancelado = false;
    setHorizonte({ estado: "cargando" });
    const acimutC1 = engine.sunMoonPositions(circ.c1.instante).sol.acimut;
    const acimutC4 = engine.sunMoonPositions(circ.c4.instante).sol.acimut;
    fetchPerfilHorizonte(
      { lat: observador.lat, lon: observador.lon },
      acimutC1,
      acimutC4,
    )
      .then((perfil) => {
        if (!cancelado) setHorizonte({ estado: "ok", perfil });
      })
      .catch(() => {
        if (!cancelado) setHorizonte({ estado: "error" });
      });
    return () => {
      cancelado = true;
    };
  }, [engine, circ, observador.lat, observador.lon]);

  // Instante decisivo para el veredicto del horizonte: mitad de la
  // Totalidad si la hay; el Máximo si el eclipse es parcial.
  const instanteDecisivo = useMemo(() => {
    if (circ.c2 && circ.c3) {
      return new Date(
        (circ.c2.instante.getTime() + circ.c3.instante.getTime()) / 2,
      );
    }
    return circ.maximo.instante;
  }, [circ]);
  const solDecisivo = useMemo(
    () => engine.sunMoonPositions(instanteDecisivo).sol,
    [engine, instanteDecisivo],
  );

  // Recorrido del sol C1→C4 (acimut, altitud) para el mini-gráfico.
  const recorridoSol = useMemo(() => {
    const t1 = circ.c1.instante.getTime();
    const t4 = circ.c4.instante.getTime();
    const pasos = 24;
    const puntos: PuntoSol[] = [];
    for (let i = 0; i <= pasos; i++) {
      const sol = engine.sunMoonPositions(
        new Date(t1 + ((t4 - t1) * i) / pasos),
      ).sol;
      puntos.push({ acimut: sol.acimut, altitud: sol.altitud });
    }
    return puntos;
  }, [engine, circ]);

  const veredictoHorizonte = useMemo(
    () =>
      horizonte.estado === "ok"
        ? evaluarHorizonte(
            horizonte.perfil,
            solDecisivo.acimut,
            solDecisivo.altitud,
          )
        : null,
    [horizonte, solDecisivo],
  );

  const altitudMaximo = posicionSolMaximo.altitud;
  const rumbo = puntoCardinal(posicionSolMaximo.acimut);
  const rumboSolDecisivo = puntoCardinal(solDecisivo.acimut);
  const momentoDecisivo = circ.tipo === "total" ? "la totalidad" : "el máximo";

  return (
    <section aria-label="Circunstancias locales y meteorología" style={estilos.panel}>
      {/* Circunstancias: contactos y duración */}
      <article style={estilos.tarjeta}>
        <h2 style={estilos.titulo}>Circunstancias locales</h2>
        <FilaContacto
          nombre="C1 · Empieza la parcialidad"
          hora={formatHoraLocal(circ.c1.instante)}
        />
        {circ.c2 && (
          <FilaContacto
            nombre="C2 · Empieza la Totalidad"
            hora={formatHoraLocal(circ.c2.instante)}
          />
        )}
        <FilaContacto
          nombre="Máximo"
          hora={formatHoraLocal(circ.maximo.instante)}
        />
        {circ.c3 && (
          <FilaContacto
            nombre="C3 · Termina la Totalidad"
            hora={formatHoraLocal(circ.c3.instante)}
          />
        )}
        <FilaContacto
          nombre="C4 · Termina la parcialidad"
          hora={formatHoraLocal(circ.c4.instante)}
        />
        <p style={{ margin: "0.75rem 0 0" }}>
          {circ.tipo === "total" &&
          circ.duracionTotalidadSegundos !== undefined ? (
            <>
              Totalidad:{" "}
              <strong style={{ color: "#ffd97a" }}>
                {formatDuracionTotalidad(circ.duracionTotalidadSegundos)} min
              </strong>
            </>
          ) : (
            <>
              aquí el máximo es{" "}
              <strong style={{ color: "#ffd97a" }}>
                {formatPorcentaje(circ.oscurecimientoMaximo)}
              </strong>{" "}
              — sin totalidad
            </>
          )}
        </p>
        <p style={{ margin: "0.5rem 0 0", opacity: 0.85 }}>
          Sol en el Máximo:{" "}
          <strong>
            {Math.round(altitudMaximo)}° sobre el horizonte {rumbo}
          </strong>{" "}
          <span style={{ opacity: 0.7 }}>
            (acimut {Math.round(posicionSolMaximo.acimut)}°)
          </span>
        </p>
        <p style={{ margin: "0.5rem 0 0", opacity: 0.6, fontSize: "0.85rem" }}>
          Horas en hora peninsular (CEST).
        </p>
      </article>

      {/* Cuenta atrás en vivo */}
      <article style={estilos.tarjeta}>
        <h2 style={estilos.titulo}>Cuenta atrás hasta el Máximo</h2>
        {cuentaAtras ? (
          <p
            aria-live="polite"
            style={{
              margin: 0,
              fontSize: "1.6rem",
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: "#ffd97a",
            }}
          >
            {cuentaAtras.dias} d {cuentaAtras.horas} h {cuentaAtras.minutos} min{" "}
            {cuentaAtras.segundos} s
          </p>
        ) : ahora ? (
          <p style={{ margin: 0 }}>El Máximo ya ha pasado en este lugar.</p>
        ) : (
          <p style={{ margin: 0, opacity: 0.6 }}>Calculando…</p>
        )}
        <p style={{ margin: "0.75rem 0 0", opacity: 0.7 }}>
          Máximo el 12-08-2026 a las {formatHoraLocal(circ.maximo.instante)}{" "}
          en {observador.nombre}.
        </p>
      </article>

      {/* Meteorología */}
      <article style={estilos.tarjeta}>
        <h2 style={estilos.titulo}>Meteorología (Open-Meteo)</h2>
        {meteo.estado === "cargando" && (
          <p style={{ margin: 0, opacity: 0.6 }}>Cargando previsión…</p>
        )}
        {meteo.estado === "error" && (
          <p style={{ margin: 0, opacity: 0.8 }}>
            No hemos podido cargar la previsión ahora mismo. Inténtalo de
            nuevo en un rato.
          </p>
        )}
        {meteo.estado === "ok" && (
          <>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>
              {meteo.prevision.veredicto.texto}
            </p>
            <div role="list" aria-label="Nubosidad total por horas">
              {meteo.prevision.horas.map((hora) => (
                <div
                  role="listitem"
                  key={hora.hora}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "3.2rem 1fr 2.8rem",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.2rem 0",
                  }}
                >
                  <span style={{ ...estilos.etiqueta, fontSize: "0.9rem" }}>
                    {hora.hora}
                  </span>
                  <div
                    aria-hidden
                    style={{
                      height: "0.6rem",
                      borderRadius: "0.3rem",
                      background: "rgba(44, 49, 85, 0.6)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${hora.total}%`,
                        height: "100%",
                        borderRadius: "0.3rem",
                        background: "#ffd97a",
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      ...estilos.valor,
                      fontSize: "0.9rem",
                      textAlign: "right",
                    }}
                  >
                    {Math.round(hora.total)}%
                  </span>
                </div>
              ))}
            </div>
            <p style={{ margin: "0.75rem 0 0", opacity: 0.6, fontSize: "0.85rem" }}>
              Nubosidad total prevista el 12-08, hora peninsular.
            </p>
          </>
        )}
      </article>

      {/* Horizonte real por relieve */}
      <article style={estilos.tarjeta}>
        <h2 style={estilos.titulo}>¿Me tapará el monte?</h2>
        {horizonte.estado === "cargando" && (
          <p style={{ margin: 0, opacity: 0.6 }}>
            Midiendo el relieve hacia el {rumboSolDecisivo}…
          </p>
        )}
        {horizonte.estado === "error" && (
          <p style={{ margin: 0, opacity: 0.8 }}>
            No hemos podido medir el relieve ahora mismo. Inténtalo de nuevo
            en un rato.
          </p>
        )}
        {horizonte.estado === "ok" && veredictoHorizonte && (
          <>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>
              {veredictoHorizonte.tipo === "marino" && (
                <>
                  🌊 Horizonte marino hacia el {rumboSolDecisivo} — el mejor
                  horizonte posible
                </>
              )}
              {veredictoHorizonte.tipo === "despejado" && (
                <>
                  ✅ Horizonte despejado hacia el {rumboSolDecisivo}{" "}
                  (obstrucción máx{" "}
                  {formatGrados(veredictoHorizonte.obstruccionMax)} &lt; sol a{" "}
                  {formatGrados(solDecisivo.altitud)})
                </>
              )}
              {veredictoHorizonte.tipo === "obstruido" && (
                <span style={{ color: "#ffd97a" }}>
                  ⚠️ El terreno sube a{" "}
                  {formatGrados(veredictoHorizonte.obstruccionEnSol)} al{" "}
                  {rumboSolDecisivo} y el sol estará a{" "}
                  {formatGrados(solDecisivo.altitud)} durante {momentoDecisivo}:
                  búscate un sitio más alto o más despejado
                </span>
              )}
            </p>
            <GraficoHorizonte
              perfil={horizonte.perfil}
              recorridoSol={recorridoSol}
            />
            <p style={{ margin: "0.75rem 0 0", opacity: 0.7, fontSize: "0.85rem" }}>
              Este cálculo considera el relieve natural; en ciudad, evita
              edificios altos hacia el {rumbo}.
            </p>
            <p style={{ margin: "0.5rem 0 0", opacity: 0.6, fontSize: "0.85rem" }}>
              Relieve: Open-Meteo Elevation (Copernicus DEM ~90 m), radios
              1–50 km. Barras: obstrucción del terreno por acimut. Línea:
              recorrido del sol C1→C4.
            </p>
          </>
        )}
      </article>

      {/* Aviso de horizonte bajo */}
      {altitudMaximo < ALTITUD_AVISO_HORIZONTE && (
        <p role="alert" style={{ ...estilos.aviso, margin: 0 }}>
          ⚠️ Busca un horizonte oeste despejado: el sol estará muy bajo (
          {Math.round(altitudMaximo)}°)
        </p>
      )}

      {/* Nota de seguridad, siempre visible */}
      <p style={{ ...estilos.seguridad, margin: 0 }}>
        🕶️ Mira el eclipse solo con gafas certificadas ISO 12312-2. Nunca a
        simple vista, ni con gafas de sol.
      </p>
    </section>
  );
}
