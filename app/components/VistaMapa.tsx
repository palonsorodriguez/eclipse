"use client";

/**
 * VistaMapa — la vista de planta del eclipse del 12-08-2026 sobre
 * MapLibre GL: mapa claro de España con la Franja de totalidad en beige,
 * la línea de centralidad discontinua, las Isolíneas de Oscurecimiento
 * etiquetadas, una isolínea en vivo ajustable (80–100 %) y la umbra
 * animada deslizándose con la Línea de tiempo.
 *
 * - Datos estáticos: `lib/geodata.ts` (banda, isolíneas, umbra cada 30 s).
 * - Geometría pura: `lib/mapa.ts` (polígono de la banda, interpolación de
 *   la umbra, elipse → GeoJSON, rejilla en vivo + contorno d3).
 * - Reloj: `lib/useLineaDeTiempo.ts`, el mismo patrón que la Vista Cielo.
 *
 * Este componente se importa con `next/dynamic` y `ssr: false` desde
 * `app/page.tsx`: MapLibre toca `window` al cargar y no sobrevive al SSR.
 *
 * Teselas: estilo Positron de CARTO (https://basemaps.cartocdn.com), uso
 * gratuito sin clave API con atribución © OpenStreetMap contributors
 * © CARTO (visible en el control del mapa y bajo él).
 */

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre resuelve su Web Worker relativo al propio bundle, un patrón que
// Turbopack no reescribe (404 en producción). El worker se sirve desde
// public/vendor/, copiado por scripts/copy-maplibre-worker.mjs
// (hooks predev/prebuild).
maplibregl.setWorkerUrl("/vendor/maplibre-gl/maplibre-gl-worker.mjs");
import { useCallback, useEffect, useRef, useState } from "react";
import type { Observador } from "@/lib/eclipse-engine";
import {
  cargarBandaTotalidad,
  cargarIsolineas,
  cargarUmbra,
  type BandaTotalidadGeoJSON,
  type InstanteUmbra,
  type IsolineasGeoJSON,
  type UmbraJSON,
} from "@/lib/geodata";
import {
  calcularRejillaOscurecimiento,
  contornoNivel,
  elipseAPoligono,
  formatoHoraCEST,
  interpolarUmbra,
  lineaBanda,
  poligonoBanda,
  puntoEtiquetaIsolinea,
  trayectoriaUmbra,
  type RejillaOscurecimiento,
} from "@/lib/mapa";
import { useLineaDeTiempo } from "@/lib/useLineaDeTiempo";

/** Estilo de teselas: CARTO Positron, libre y sin clave API. */
const ESTILO_MAPA =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/** Encuadre inicial y límites de paneo: España con margen. */
const CENTRO_INICIAL: [number, number] = [-3.7, 40.2];
const ZOOM_INICIAL = 5.5;
const LIMITES_MAPA: [[number, number], [number, number]] = [
  [-21, 26],
  [13, 51],
];

/** Línea de tiempo: 19:15–21:30 CEST del 12-08-2026 (CEST = UT+2). */
const T_MIN = Date.UTC(2026, 7, 12, 17, 15, 0);
const T_MAX = Date.UTC(2026, 7, 12, 19, 30, 0);

/** Hitos de país sobre la Línea de tiempo (hora peninsular). */
const HITOS = [
  { etiqueta: "Inicio parcial", t: Date.UTC(2026, 7, 12, 17, 34, 0) },
  { etiqueta: "Totalidad", t: Date.UTC(2026, 7, 12, 18, 29, 0) },
  { etiqueta: "Fin parcial", t: Date.UTC(2026, 7, 12, 19, 22, 0) },
] as const;

/** Ciudades de referencia, [lon, lat]. */
const CIUDADES: ReadonlyArray<{ nombre: string; coord: [number, number] }> = [
  { nombre: "Santiago", coord: [-8.5449, 42.8782] },
  { nombre: "Oviedo", coord: [-5.8593, 43.3614] },
  { nombre: "Santander", coord: [-3.8099, 43.4623] },
  { nombre: "Bilbao", coord: [-2.935, 43.263] },
  { nombre: "Valladolid", coord: [-4.7245, 41.6523] },
  { nombre: "Zaragoza", coord: [-0.8891, 41.6488] },
  { nombre: "Barcelona", coord: [2.1686, 41.3874] },
  { nombre: "Madrid", coord: [-3.7038, 40.4168] },
  { nombre: "Valencia", coord: [-0.3763, 39.4699] },
  { nombre: "Palma", coord: [2.6502, 39.5696] },
  { nombre: "Sevilla", coord: [-5.9845, 37.3891] },
];

/** Colores de la vista (referencia visual acordada). */
const COLOR_BANDA = "#e8d9b0";
const COLOR_BORDE_BANDA = "#b3985f";
const COLOR_CENTRAL = "#c9a227";
const COLOR_ISOLINEA = "#a89968";
const COLOR_FRANJA_VIVA = "#ffb347";
const COLOR_BORDE_FRANJA_VIVA = "#e8912d";

const FC_VACIA = {
  type: "FeatureCollection",
  features: [],
} as GeoJSON.FeatureCollection;

// ---------------------------------------------------------------------------
// Rejilla en vivo memoizada a nivel de módulo: se calcula una sola vez por
// sesión (~2 s en trozos) y sirve para cualquier nivel del slider y para
// cualquier remontaje del componente.
// ---------------------------------------------------------------------------

let promesaRejilla: Promise<RejillaOscurecimiento> | null = null;
let progresoRejilla = 0;
const oyentesProgreso = new Set<(fraccion: number) => void>();

function obtenerRejilla(
  onProgreso: (fraccion: number) => void,
): Promise<RejillaOscurecimiento> {
  oyentesProgreso.add(onProgreso);
  onProgreso(progresoRejilla);
  promesaRejilla ??= calcularRejillaOscurecimiento((fraccion) => {
    progresoRejilla = fraccion;
    for (const oyente of oyentesProgreso) oyente(fraccion);
  });
  return promesaRejilla;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

interface DatosGeo {
  banda: BandaTotalidadGeoJSON;
  isolineas: IsolineasGeoJSON;
  umbra: UmbraJSON;
}

export interface VistaMapaProps {
  /** Observador actual, para marcarlo sobre el mapa. */
  observador?: Observador | null;
  /** Clic en el mapa: nuevo punto elegido por el usuario. */
  onSelect?: (lat: number, lon: number) => void;
}

/** Marcador DOM con punto y texto, sin depender de los glifos del estilo. */
function crearEtiqueta(texto: string, conPunto: boolean, color: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText =
    "display:flex;align-items:center;gap:4px;pointer-events:none;";
  if (conPunto) {
    const punto = document.createElement("span");
    punto.style.cssText =
      "width:6px;height:6px;border-radius:50%;background:#4a4a4a;box-shadow:0 0 0 1.5px #fff;flex:none;";
    el.append(punto);
  }
  const span = document.createElement("span");
  span.textContent = texto;
  span.style.cssText = `font-size:11px;font-weight:600;color:${color};text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 4px #fff;white-space:nowrap;`;
  el.append(span);
  return el;
}

export default function VistaMapa({ observador, onSelect }: VistaMapaProps) {
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<maplibregl.Map | null>(null);
  const [mapaListo, setMapaListo] = useState(false);
  const [capasListas, setCapasListas] = useState(false);
  const capasListasRef = useRef(false);

  const [datos, setDatos] = useState<DatosGeo | null>(null);
  const [errorDatos, setErrorDatos] = useState(false);
  const instantesUmbraRef = useRef<readonly InstanteUmbra[]>([]);

  const [nivelPct, setNivelPct] = useState(90);
  const [rejilla, setRejilla] = useState<RejillaOscurecimiento | null>(null);
  const [progreso, setProgreso] = useState(0);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // --- Carga de los datos geográficos estáticos -----------------------------
  useEffect(() => {
    let cancelado = false;
    Promise.all([cargarBandaTotalidad(), cargarIsolineas(), cargarUmbra()])
      .then(([banda, isolineas, umbra]) => {
        if (cancelado) return;
        instantesUmbraRef.current = umbra.instantes;
        setDatos({ banda, isolineas, umbra });
      })
      .catch(() => {
        if (!cancelado) setErrorDatos(true);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // --- Rejilla en vivo (memoizada a nivel de módulo) ------------------------
  useEffect(() => {
    let activo = true;
    const onProgreso = (fraccion: number): void => {
      if (activo) setProgreso(fraccion);
    };
    obtenerRejilla(onProgreso).then((resultado) => {
      if (activo) setRejilla(resultado);
    });
    return () => {
      activo = false;
      oyentesProgreso.delete(onProgreso);
    };
  }, []);

  // --- Mapa base ------------------------------------------------------------
  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;

    const mapa = new maplibregl.Map({
      container: contenedor,
      style: ESTILO_MAPA,
      center: CENTRO_INICIAL,
      zoom: ZOOM_INICIAL,
      minZoom: 4,
      maxZoom: 12,
      maxBounds: LIMITES_MAPA,
      attributionControl: { compact: false },
    });
    mapa.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    mapa.getCanvas().style.cursor = "crosshair";
    mapa.on("click", (e) => {
      onSelectRef.current?.(e.lngLat.lat, e.lngLat.lng);
    });
    mapa.on("load", () => setMapaListo(true));
    mapaRef.current = mapa;

    return () => {
      capasListasRef.current = false;
      setCapasListas(false);
      setMapaListo(false);
      mapaRef.current = null;
      mapa.remove();
    };
  }, []);

  // --- Capas del eclipse (cuando hay mapa y datos) --------------------------
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !mapaListo || !datos) return;

    const { banda, isolineas, umbra } = datos;

    mapa.addSource("banda", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: poligonoBanda(banda) },
    });
    mapa.addSource("banda-lineas", { type: "geojson", data: banda });
    mapa.addSource("isolineas", { type: "geojson", data: isolineas });
    mapa.addSource("franja-viva", { type: "geojson", data: FC_VACIA });
    mapa.addSource("trayectoria-umbra", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: trayectoriaUmbra(umbra.instantes),
      },
    });
    mapa.addSource("umbra", { type: "geojson", data: FC_VACIA });

    // Franja de totalidad: relleno beige translúcido y bordes finos.
    mapa.addLayer({
      id: "banda-relleno",
      type: "fill",
      source: "banda",
      paint: { "fill-color": COLOR_BANDA, "fill-opacity": 0.35 },
    });
    // Franja en vivo (Oscurecimiento ≥ X %), resaltada en ámbar.
    mapa.addLayer({
      id: "franja-viva-relleno",
      type: "fill",
      source: "franja-viva",
      paint: { "fill-color": COLOR_FRANJA_VIVA, "fill-opacity": 0.28 },
    });
    mapa.addLayer({
      id: "franja-viva-borde",
      type: "line",
      source: "franja-viva",
      paint: {
        "line-color": COLOR_BORDE_FRANJA_VIVA,
        "line-width": 2,
        "line-opacity": 0.9,
      },
    });
    // Isolíneas fijas en gris-dorado tenue.
    mapa.addLayer({
      id: "isolineas-borde",
      type: "line",
      source: "isolineas",
      paint: {
        "line-color": COLOR_ISOLINEA,
        "line-width": 1,
        "line-opacity": 0.55,
      },
    });
    // Bordes de la banda y línea de centralidad discontinua dorada.
    mapa.addLayer({
      id: "banda-limites",
      type: "line",
      source: "banda-lineas",
      filter: ["!=", ["get", "limite"], "central"],
      paint: {
        "line-color": COLOR_BORDE_BANDA,
        "line-width": 1.2,
        "line-opacity": 0.8,
      },
    });
    mapa.addLayer({
      id: "banda-central",
      type: "line",
      source: "banda-lineas",
      filter: ["==", ["get", "limite"], "central"],
      paint: {
        "line-color": COLOR_CENTRAL,
        "line-width": 2,
        "line-dasharray": [2.5, 2],
      },
    });
    // Trayectoria de la umbra: línea tenue punteada.
    mapa.addLayer({
      id: "trayectoria-umbra-linea",
      type: "line",
      source: "trayectoria-umbra",
      paint: {
        "line-color": "#55504a",
        "line-width": 1,
        "line-opacity": 0.5,
        "line-dasharray": [1, 2.5],
      },
    });
    // Umbra animada: halo difuso + núcleo (opacidad por feature).
    mapa.addLayer({
      id: "umbra-relleno",
      type: "fill",
      source: "umbra",
      paint: {
        "fill-color": "#000000",
        "fill-opacity": ["get", "opacidad"],
      },
    });

    // Etiquetas DOM (ciudades e isolíneas): no dependen de los glifos
    // del estilo de teselas.
    const marcadores: maplibregl.Marker[] = [];
    for (const ciudad of CIUDADES) {
      marcadores.push(
        new maplibregl.Marker({
          element: crearEtiqueta(ciudad.nombre, true, "#3a3a3a"),
          anchor: "left",
          offset: [-3, 0],
        })
          .setLngLat(ciudad.coord)
          .addTo(mapa),
      );
    }
    for (const isolinea of isolineas.features) {
      const punto = puntoEtiquetaIsolinea(isolinea.geometry);
      if (!punto) continue;
      marcadores.push(
        new maplibregl.Marker({
          element: crearEtiqueta(
            `${Math.round(isolinea.properties.nivel * 100)} %`,
            false,
            "#8a7a45",
          ),
          anchor: "center",
        })
          .setLngLat([punto[0], punto[1]])
          .addTo(mapa),
      );
    }

    capasListasRef.current = true;
    setCapasListas(true);

    return () => {
      capasListasRef.current = false;
      setCapasListas(false);
      for (const marcador of marcadores) marcador.remove();
      // El desmontaje del mapa (efecto anterior) ya destruye capas y
      // fuentes; solo hay que limpiarlas si el mapa sigue vivo.
      if (mapaRef.current === mapa && mapa.getSource("banda")) {
        for (const id of [
          "umbra-relleno",
          "trayectoria-umbra-linea",
          "banda-central",
          "banda-limites",
          "isolineas-borde",
          "franja-viva-borde",
          "franja-viva-relleno",
          "banda-relleno",
        ]) {
          if (mapa.getLayer(id)) mapa.removeLayer(id);
        }
        for (const id of [
          "umbra",
          "trayectoria-umbra",
          "franja-viva",
          "isolineas",
          "banda-lineas",
          "banda",
        ]) {
          if (mapa.getSource(id)) mapa.removeSource(id);
        }
      }
    };
  }, [mapaListo, datos]);

  // --- Isolínea en vivo: rejilla + nivel → contorno -------------------------
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !capasListas || !rejilla) return;
    const fuente = mapa.getSource<maplibregl.GeoJSONSource>("franja-viva");
    fuente?.setData({
      type: "Feature",
      properties: {},
      geometry: contornoNivel(rejilla, nivelPct / 100),
    });
  }, [capasListas, rejilla, nivelPct]);

  // --- Umbra animada: se actualiza en cada frame de la Línea de tiempo ------
  const ultimoTUmbraRef = useRef<number | null>(null);
  const pintarUmbra = useCallback((t: number) => {
    const mapa = mapaRef.current;
    if (!mapa || !capasListasRef.current) return;
    if (ultimoTUmbraRef.current === t) return;
    ultimoTUmbraRef.current = t;

    const umbra = interpolarUmbra(instantesUmbraRef.current, new Date(t));
    const fuente = mapa.getSource<maplibregl.GeoJSONSource>("umbra");
    if (!fuente) return;
    if (!umbra) {
      fuente.setData(FC_VACIA);
      return;
    }
    fuente.setData({
      type: "FeatureCollection",
      features: [
        // Halo exterior: borde difuso barato (elipse ampliada, tenue).
        {
          type: "Feature",
          properties: { opacidad: 0.14 },
          geometry: elipseAPoligono(umbra, 64, 1.18),
        },
        {
          type: "Feature",
          properties: { opacidad: 0.45 },
          geometry: elipseAPoligono(umbra),
        },
      ],
    });
  }, []);

  const { tUi, reproduciendo, alternarReproduccion, fijarTiempo } =
    useLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX, onFrame: pintarUmbra });

  // --- Marcador del Observador ----------------------------------------------
  const marcadorObservadorRef = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !mapaListo) return;
    marcadorObservadorRef.current?.remove();
    marcadorObservadorRef.current = null;
    if (observador) {
      marcadorObservadorRef.current = new maplibregl.Marker({
        color: "#d97706",
        scale: 0.85,
      })
        .setLngLat([observador.lon, observador.lat])
        .addTo(mapa);
    }
    return () => {
      marcadorObservadorRef.current?.remove();
      marcadorObservadorRef.current = null;
    };
  }, [mapaListo, observador]);

  return (
    <section
      aria-label="Vista Mapa"
      style={{ width: "100%", maxWidth: 960, margin: "0 auto", textAlign: "left" }}
    >
      <h2 style={{ fontSize: "1.3rem", marginBottom: 8 }}>Vista Mapa</h2>
      <div style={{ position: "relative" }}>
        <div
          ref={contenedorRef}
          role="application"
          aria-label="Mapa de España con la trayectoria del eclipse"
          style={{
            width: "100%",
            height: "clamp(360px, 60vh, 540px)",
            borderRadius: 8,
            overflow: "hidden",
            background: "#dfe8ec",
          }}
        />
        {errorDatos && (
          <p
            role="alert"
            style={{
              position: "absolute",
              inset: "auto 12px 12px",
              margin: 0,
              padding: "0.5rem 0.75rem",
              borderRadius: 6,
              background: "rgba(20, 24, 48, 0.9)",
              color: "#ffd97a",
            }}
          >
            No se han podido cargar los datos del eclipse. Recarga la página
            para intentarlo de nuevo.
          </p>
        )}
      </div>

      {/* Hora simulada + control de la isolínea en vivo */}
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
          {formatoHoraCEST(tUi, true)}{" "}
          <span style={{ fontSize: "0.9rem", opacity: 0.6 }}>CEST</span>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>
            Oscurecimiento ≥{" "}
            <strong style={{ color: COLOR_FRANJA_VIVA }}>{nivelPct} %</strong>
          </span>
          <input
            type="range"
            min={80}
            max={100}
            step={1}
            value={nivelPct}
            disabled={!rejilla}
            onChange={(e) => setNivelPct(Number(e.target.value))}
            aria-label="Nivel de Oscurecimiento de la isolínea en vivo"
            style={{ width: 180, accentColor: COLOR_FRANJA_VIVA }}
          />
        </label>
      </div>
      {!rejilla && !errorDatos && (
        <p style={{ margin: "4px 0 0", opacity: 0.65, fontSize: "0.85rem" }}>
          Calculando la isolínea en vivo con el motor astronómico…{" "}
          {Math.round(progreso * 100)} %
        </p>
      )}

      {/* Línea de tiempo con hitos y play */}
      <div style={{ position: "relative", marginTop: 34 }}>
        {HITOS.map((hito) => {
          const pct = ((hito.t - T_MIN) / (T_MAX - T_MIN)) * 100;
          return (
            <div
              key={hito.etiqueta}
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: -26,
                transform: "translateX(-50%)",
                fontSize: "0.72rem",
                opacity: 0.85,
                textAlign: "center",
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
              title={`${hito.etiqueta} — ${formatoHoraCEST(hito.t)} CEST`}
            >
              {hito.etiqueta} {formatoHoraCEST(hito.t)}
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
            onChange={(e) => fijarTiempo(Number(e.target.value))}
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
          <span>{formatoHoraCEST(T_MIN)}</span>
          <span>{formatoHoraCEST(T_MAX)}</span>
        </div>
      </div>

      <p style={{ margin: "10px 0 0", opacity: 0.7, fontSize: "0.85rem" }}>
        Haz clic en el mapa para situar al Observador en el municipio más
        cercano. La sombra (umbra) cruza la península entre las 20:20 y las
        20:34 aproximadamente.
      </p>
      <p style={{ margin: "4px 0 0", opacity: 0.5, fontSize: "0.75rem" }}>
        Mapa: © OpenStreetMap contributors © CARTO.
      </p>
    </section>
  );
}
