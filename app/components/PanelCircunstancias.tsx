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
 * cuenta atrás en vivo y previsión de nubosidad de Open-Meteo con
 * veredicto simple.
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

  const altitudMaximo = posicionSolMaximo.altitud;
  const rumbo = puntoCardinal(posicionSolMaximo.acimut);

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
