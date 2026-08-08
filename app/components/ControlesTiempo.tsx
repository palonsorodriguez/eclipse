"use client";

/**
 * ControlesTiempo — barra de control de la Línea de tiempo compartida por
 * la Vista Cielo y la Vista Mapa: play/pausa, slider con marcas, selector
 * de velocidad (Resumen · ×30 · ×60 · ×120 · ×300) y botones de salto a
 * los Contactos que existan para el Observador (C2/C3 no existen en un
 * eclipse parcial).
 *
 * El estado del reloj llega en `linea` (useLineaDeTiempo); el reloj entero
 * es único y compartido (`lib/reloj-tiempo.ts`), así que play, pausa,
 * salto o arrastre desde cualquiera de las dos barras mueven todas las
 * vistas a la vez. Cada vista aporta sus propias marcas sobre el slider.
 */

import { destinosSalto, type ContactosMs } from "@/lib/linea-tiempo-velocidad";
import {
  VELOCIDADES_FIJAS,
  type LineaDeTiempo,
  type ModoVelocidad,
} from "@/lib/useLineaDeTiempo";

/** Paleta de la barra: panel oscuro y acento dorado de la app. */
const COLOR_PANEL = "#141830";
const COLOR_ACENTO = "#ffd97a";

const CEST_OFFSET_MS = 2 * 3600_000;

function formatoCEST(tMs: number, conSegundos = true): string {
  const iso = new Date(tMs + CEST_OFFSET_MS).toISOString();
  return iso.slice(11, conSegundos ? 19 : 16);
}

/** Una marca sobre el slider: etiqueta corta y su instante. */
export interface MarcaTiempo {
  etiqueta: string;
  t: number;
}

export interface ControlesTiempoProps {
  /** Extremos de la Línea de tiempo (ms de época). */
  tMin: number;
  tMax: number;
  /** Reloj de la vista (instancia de useLineaDeTiempo). */
  linea: LineaDeTiempo;
  /** Contactos del Observador para los saltos; null → sin botones. */
  contactos: ContactosMs | null;
  /** Marcas propias de la vista sobre el slider (C1–C4, hitos de país…). */
  marcas?: readonly MarcaTiempo[];
}

const estiloBotonBase = {
  border: "1px solid rgba(255, 255, 255, 0.25)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  borderRadius: 6,
  fontSize: "0.8rem",
  padding: "4px 10px",
  fontVariantNumeric: "tabular-nums" as const,
};

export default function ControlesTiempo({
  tMin,
  tMax,
  linea,
  contactos,
  marcas = [],
}: ControlesTiempoProps) {
  const {
    tUi,
    reproduciendo,
    alternarReproduccion,
    fijarTiempo,
    saltarA,
    modo,
    fijarModo,
  } = linea;

  const saltos = contactos ? destinosSalto(contactos, tMin, tMax) : [];

  const opcionesVelocidad: ReadonlyArray<{
    modo: ModoVelocidad;
    etiqueta: string;
  }> = [
    { modo: "resumen", etiqueta: "Resumen" },
    ...VELOCIDADES_FIJAS.map((v) => ({ modo: v, etiqueta: `×${v}` }) as const),
  ];

  return (
    <div style={{ position: "relative", marginTop: 28 }}>
      {/* Marcas de la vista sobre el slider */}
      {marcas.map((m) => {
        const pct = ((m.t - tMin) / (tMax - tMin)) * 100;
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
              whiteSpace: "nowrap",
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

      {/* Play/pausa + slider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={alternarReproduccion}
          aria-label={reproduciendo ? "Pausar" : "Reproducir"}
          style={{
            fontSize: "1.1rem",
            width: 44,
            height: 44,
            flex: "none",
            borderRadius: "50%",
            border: `1px solid rgba(255, 255, 255, 0.35)`,
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {reproduciendo ? "⏸" : "▶"}
        </button>
        <input
          type="range"
          min={tMin}
          max={tMax}
          step={1000}
          value={tUi}
          onChange={(e) => fijarTiempo(Number(e.target.value))}
          aria-label="Línea de tiempo del eclipse"
          style={{ flex: 1, accentColor: COLOR_ACENTO }}
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
        <span>{formatoCEST(tMin, false)}</span>
        <span>{formatoCEST(tMax, false)}</span>
      </div>

      {/* Velocidad + saltos */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 10,
          padding: "8px 10px",
          borderRadius: 8,
          background: COLOR_PANEL,
        }}
      >
        <div
          role="group"
          aria-label="Velocidad de reproducción"
          style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
        >
          <span style={{ fontSize: "0.75rem", opacity: 0.6, marginRight: 2 }}>
            Velocidad
          </span>
          {opcionesVelocidad.map((opcion) => {
            const activa = modo === opcion.modo;
            return (
              <button
                key={opcion.etiqueta}
                type="button"
                onClick={() => fijarModo(opcion.modo)}
                aria-pressed={activa}
                title={
                  opcion.modo === "resumen"
                    ? "Velocidad automática: rápido cuando no pasa nada, cámara lenta en los momentos buenos"
                    : `Velocidad fija ×${opcion.modo}`
                }
                style={{
                  ...estiloBotonBase,
                  ...(activa
                    ? {
                        background: COLOR_ACENTO,
                        color: COLOR_PANEL,
                        borderColor: COLOR_ACENTO,
                        fontWeight: 700,
                      }
                    : {}),
                }}
              >
                {opcion.etiqueta}
              </button>
            );
          })}
        </div>

        {saltos.length > 0 && (
          <div
            role="group"
            aria-label="Saltar a un Contacto"
            style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
          >
            <span style={{ fontSize: "0.75rem", opacity: 0.6, marginRight: 2 }}>
              Ir a
            </span>
            {saltos.map((salto) => (
              <button
                key={salto.etiqueta}
                type="button"
                onClick={() => saltarA(salto.destino)}
                title={`${salto.etiqueta} — ${formatoCEST(salto.t)} CEST`}
                style={{ ...estiloBotonBase, color: COLOR_ACENTO }}
              >
                {salto.etiqueta}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
