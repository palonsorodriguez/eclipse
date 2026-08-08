"use client";

/**
 * BarraTiempo — la barra de tiempo única de la app (issue #36): sticky
 * abajo, de una sola fila (~60 px), estilo reproductor de vídeo. Sustituye
 * a las dos instancias de ControlesTiempo (una por vista, tres filas cada
 * una) que se montaban antes.
 *
 *   [▶] [slider con marcas de Contactos clicables] [hora CEST + %] [velocidad]
 *
 * - Las marcas C1/C2/Máx/C3/C4 sobre el slider SON los botones de salto:
 *   tocar una salta a su Contacto con la anticipación de 12 s de
 *   `destinosSalto` (área táctil ~32 px, aria-label con la hora CEST).
 * - La velocidad es un único botón que cicla Resumen → ×30 → ×60 → ×120
 *   → ×300 → Resumen.
 * - El reloj es el único compartido (`lib/reloj-tiempo.ts`): play, pausa,
 *   arrastre o salto desde esta barra mueven todas las vistas a la vez.
 * - En móvil (≤480 px) la misma fila cabe en 375 px: la hora pierde los
 *   segundos y el % de Oscurecimiento se oculta (media queries del
 *   <style> del componente); nada de scroll horizontal.
 */

import { useMemo } from "react";
import { createEclipseEngine, type Observador } from "@/lib/eclipse-engine";
import { destinosSalto, type ContactosMs } from "@/lib/linea-tiempo-velocidad";
import { T_MIN, T_MAX } from "@/lib/reloj-tiempo";
import {
  useLineaDeTiempo,
  VELOCIDADES_FIJAS,
  type ModoVelocidad,
} from "@/lib/useLineaDeTiempo";

/** Ferrol, el Observador por defecto de las vistas mientras no hay municipio. */
const FERROL: Observador = { lat: 43.4832, lon: -8.2369 };

/** Paleta de la barra: panel oscuro y acento dorado de la app. */
const COLOR_PANEL = "#141830";
const COLOR_ACENTO = "#ffd97a";

/** Altura total de la fila de la barra, en px. */
export const ALTURA_BARRA = 60;

const CEST_OFFSET_MS = 2 * 3600_000;

function formatoCEST(tMs: number, conSegundos = true): string {
  const iso = new Date(tMs + CEST_OFFSET_MS).toISOString();
  return iso.slice(11, conSegundos ? 19 : 16);
}

function formatoPorcentaje(fraccion: number): string {
  return (fraccion * 100).toFixed(1).replace(".", ",");
}

// ---------------------------------------------------------------------------
// Ciclo del botón de velocidad
// ---------------------------------------------------------------------------

/** Orden del ciclo del botón: Resumen → ×30 → ×60 → ×120 → ×300 → Resumen. */
export const CICLO_VELOCIDAD: readonly ModoVelocidad[] = [
  "resumen",
  ...VELOCIDADES_FIJAS,
];

/** Siguiente modo del ciclo del botón de velocidad. */
export function siguienteModo(modo: ModoVelocidad): ModoVelocidad {
  const indice = CICLO_VELOCIDAD.indexOf(modo);
  return CICLO_VELOCIDAD[(indice + 1) % CICLO_VELOCIDAD.length];
}

/** Etiqueta visible del modo en el botón de velocidad. */
export function etiquetaModo(modo: ModoVelocidad): string {
  return modo === "resumen" ? "Resumen" : `×${modo}`;
}

// ---------------------------------------------------------------------------
// Marcas de Contactos sobre el slider (los botones de salto)
// ---------------------------------------------------------------------------

/**
 * Separación mínima entre etiquetas vecinas, en % del slider: en un eclipse
 * total C2/Máx/C3 caben en ~2 min de las 2¼ h de la Línea de tiempo (~1,5 %)
 * y sus áreas táctiles se pisarían por completo. La rayita de cada marca
 * queda en la posición real del Contacto; solo la etiqueta se aparta.
 */
const SEPARACION_MIN_PCT = 4;

export interface MarcaBarra {
  etiqueta: string;
  /** Adónde salta el clic (con la anticipación de `destinosSalto`). */
  destino: number;
  /** Nombre accesible del botón, con la hora CEST del Contacto. */
  ariaLabel: string;
  /** Posición real del Contacto sobre el slider (0–100). */
  pct: number;
  /** Posición de la etiqueta, separada de sus vecinas si se solapan. */
  pctEtiqueta: number;
}

/**
 * Modelo de las marcas clicables de la barra para unos Contactos: una por
 * Contacto existente dentro del rango, con su destino de salto anticipado
 * y las etiquetas decongestionadas a una separación mínima.
 */
export function marcasBarra(
  contactos: ContactosMs,
  tMin: number,
  tMax: number,
): MarcaBarra[] {
  const saltos = destinosSalto(contactos, tMin, tMax);
  const pcts = saltos.map((s) => ((s.t - tMin) / (tMax - tMin)) * 100);

  // Decongestión en dos pasadas: hacia delante impone la separación mínima,
  // hacia atrás recoge el sobrante si la última se salió del 100 %.
  const etiquetas = pcts.slice();
  for (let i = 1; i < etiquetas.length; i++) {
    etiquetas[i] = Math.max(etiquetas[i], etiquetas[i - 1] + SEPARACION_MIN_PCT);
  }
  for (let i = etiquetas.length - 1; i >= 0; i--) {
    const tope =
      i === etiquetas.length - 1 ? 100 : etiquetas[i + 1] - SEPARACION_MIN_PCT;
    etiquetas[i] = Math.max(0, Math.min(etiquetas[i], tope));
  }

  return saltos.map((salto, i) => ({
    etiqueta: salto.etiqueta,
    destino: salto.destino,
    ariaLabel: `Saltar a ${salto.etiqueta} — ${formatoCEST(salto.t)} CEST`,
    pct: pcts[i],
    pctEtiqueta: etiquetas[i],
  }));
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/**
 * Estilos con media query (los estilos inline no pueden): en pantallas
 * estrechas la hora pierde los segundos y el % se oculta para que la fila
 * entera quepa en 375 px sin scroll horizontal.
 */
const CSS_BARRA = `
.bt-fila {
  display: flex;
  align-items: center;
  gap: 12px;
  height: ${ALTURA_BARRA}px;
  padding: 0 14px;
  max-width: 1100px;
  margin: 0 auto;
}
.bt-hora-grande { font-size: 1.25rem; font-weight: 600; }
.bt-marca {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  min-width: 32px;
  height: 32px;
  padding: 0 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: ${COLOR_ACENTO};
  font-size: 0.7rem;
  line-height: 1;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.bt-marca:hover { text-decoration: underline; }
@media (max-width: 480px) {
  .bt-fila { gap: 8px; padding: 0 10px; }
  .bt-seg, .bt-pct { display: none; }
  .bt-hora-grande { font-size: 1.05rem; }
}
`;

export interface BarraTiempoProps {
  /** Observador actual (lat/lon); sin él, Ferrol como las vistas. */
  observador?: Observador | null;
}

export default function BarraTiempo({ observador }: BarraTiempoProps) {
  const lat = observador?.lat ?? FERROL.lat;
  const lon = observador?.lon ?? FERROL.lon;

  // Motor astronómico del Observador: Contactos para marcas/curva del
  // resumen y Oscurecimiento para el indicador de la barra.
  const engine = useMemo(() => createEclipseEngine({ lat, lon }), [lat, lon]);

  const contactos = useMemo((): ContactosMs => {
    const circ = engine.circunstancias;
    return {
      c1: circ.c1.instante.getTime(),
      c2: circ.c2 ? circ.c2.instante.getTime() : null,
      maximo: circ.maximo.instante.getTime(),
      c3: circ.c3 ? circ.c3.instante.getTime() : null,
      c4: circ.c4.instante.getTime(),
    };
  }, [engine]);

  const {
    tUi,
    reproduciendo,
    alternarReproduccion,
    fijarTiempo,
    saltarA,
    modo,
    fijarModo,
  } = useLineaDeTiempo({ contactos });

  const marcas = useMemo(() => marcasBarra(contactos, T_MIN, T_MAX), [contactos]);

  const oscuracion = useMemo(
    () => engine.obscurationAt(new Date(tUi)),
    [engine, tUi],
  );

  const hora = formatoCEST(tUi); // "20:27:34"

  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 20,
        width: "100%",
        background: COLOR_PANEL,
        borderTop: "1px solid rgba(255, 255, 255, 0.14)",
        boxSizing: "border-box",
      }}
    >
      <style>{CSS_BARRA}</style>
      <div
        className="bt-fila"
        role="group"
        aria-label="Barra de tiempo del eclipse"
      >
        <button
          type="button"
          onClick={alternarReproduccion}
          aria-label={reproduciendo ? "Pausar" : "Reproducir"}
          style={{
            fontSize: "1rem",
            width: 40,
            height: 40,
            flex: "none",
            borderRadius: "50%",
            border: "1px solid rgba(255, 255, 255, 0.35)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {reproduciendo ? "⏸" : "▶"}
        </button>

        {/* Slider con las marcas de Contactos clicables encima */}
        <div
          style={{
            position: "relative",
            flex: 1,
            alignSelf: "stretch",
            minWidth: 80,
          }}
        >
          {marcas.map((marca) => (
            <span key={marca.etiqueta}>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: `${marca.pct}%`,
                  top: 27,
                  width: 1,
                  height: 7,
                  background: "rgba(255, 217, 122, 0.8)",
                  transform: "translateX(-50%)",
                  pointerEvents: "none",
                }}
              />
              <button
                type="button"
                className="bt-marca"
                onClick={() => saltarA(marca.destino)}
                aria-label={marca.ariaLabel}
                title={marca.ariaLabel.replace("Saltar a ", "")}
                style={{ left: `${marca.pctEtiqueta}%` }}
              >
                {marca.etiqueta}
              </button>
            </span>
          ))}
          <input
            type="range"
            min={T_MIN}
            max={T_MAX}
            step={1000}
            value={tUi}
            onChange={(e) => fijarTiempo(Number(e.target.value))}
            aria-label="Línea de tiempo del eclipse"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 6,
              width: "100%",
              margin: 0,
              accentColor: COLOR_ACENTO,
            }}
          />
        </div>

        {/* Hora CEST grande + % de Oscurecimiento */}
        <div
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
            textAlign: "right",
          }}
        >
          <span className="bt-hora-grande">
            {hora.slice(0, 5)}
            <span className="bt-seg">{hora.slice(5)}</span>
          </span>{" "}
          <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>CEST</span>
          <span className="bt-pct" style={{ fontSize: "0.9rem" }}>
            {" · "}
            {formatoPorcentaje(oscuracion)} %
          </span>
        </div>

        <button
          type="button"
          onClick={() => fijarModo(siguienteModo(modo))}
          aria-label={`Velocidad de reproducción: ${etiquetaModo(modo)}. Pulsa para cambiar`}
          title={
            modo === "resumen"
              ? "Velocidad automática: rápido cuando no pasa nada, cámara lenta en los momentos buenos. Pulsa para ciclar."
              : `Velocidad fija ×${modo}. Pulsa para ciclar.`
          }
          style={{
            flex: "none",
            minWidth: 74,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid rgba(255, 255, 255, 0.3)",
            background: "transparent",
            color: COLOR_ACENTO,
            fontSize: "0.8rem",
            cursor: "pointer",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {etiquetaModo(modo)}
        </button>
      </div>
    </div>
  );
}
