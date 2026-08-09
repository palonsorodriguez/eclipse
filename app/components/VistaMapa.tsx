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
 *   la umbra, contorno real → GeoJSON, rejilla en vivo + contorno d3).
 * - Reloj: `lib/reloj-tiempo.ts` vía `useLineaDeTiempo` — el reloj único
 *   compartido con la Vista Cielo (mismo t, mismo play, mismo bucle).
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { circunstanciasLocales, type Observador } from "@/lib/eclipse-engine";
import type { ContactosMs } from "@/lib/linea-tiempo-velocidad";
import {
  cargarBandaTotalidad,
  cargarIsolineas,
  cargarUmbra,
  distanciaKm,
  type BandaTotalidadGeoJSON,
  type InstanteUmbra,
  type IsolineasGeoJSON,
  type UmbraJSON,
} from "@/lib/geodata";
import {
  calcularRejillaOscurecimiento,
  contornoNivel,
  contornoUmbra,
  formatoHoraCEST,
  interpolarUmbra,
  lineaBanda,
  llegadaUmbra,
  poligonoBanda,
  puntoEtiquetaIsolinea,
  trayectoriaUmbra,
  type RejillaOscurecimiento,
} from "@/lib/mapa";
import {
  clasificarColorNube,
  obtenerNubesFranja,
  type ColorNube,
  type PuntoNube,
} from "@/lib/meteo-mapa";
import { useLineaDeTiempo } from "@/lib/useLineaDeTiempo";

/** Estilo de teselas: CARTO Positron, libre y sin clave API. */
const ESTILO_MAPA =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/**
 * Encuadre inicial y límites de paneo: España con margen atlántico hacia
 * el oeste (lon mín −21°), para ver venir la entrada de la sombra por el
 * Atlántico antes de que toque Galicia.
 */
const CENTRO_INICIAL: [number, number] = [-5.3, 40.3];
const ZOOM_INICIAL = 5;
const LIMITES_MAPA: [[number, number], [number, number]] = [
  [-21, 26],
  [13, 51],
];

/**
 * Observador por defecto para la curva del resumen y los saltos mientras
 * no hay municipio elegido: Ferrol, el mismo que usa la Vista Cielo.
 */
const OBSERVADOR_DEFECTO: Observador = { lat: 43.4832, lon: -8.2369 };

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

/** Colores de la capa de nubes por categoría de nubosidad media. */
const COLORES_NUBES: Record<ColorNube, string> = {
  verde: "#3f9e4d",
  amarillo: "#e3b52a",
  gris: "#8a8f98",
};

/** Entradas de la leyenda compacta de la capa de nubes. */
const LEYENDA_NUBES: ReadonlyArray<{ color: ColorNube; texto: string }> = [
  { color: "verde", texto: "< 25 %" },
  { color: "amarillo", texto: "25–60 %" },
  { color: "gris", texto: "> 60 %" },
];

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

  const [nubesActivas, setNubesActivas] = useState(false);
  const [nubes, setNubes] = useState<PuntoNube[] | null>(null);
  const [cargandoNubes, setCargandoNubes] = useState(false);
  const [errorNubes, setErrorNubes] = useState(false);

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
    // Marcas horarias CEST cada 2 min sobre la trayectoria de la umbra
    // (20:26 · 20:28 · 20:30…): dónde estará el centro de la sombra y a
    // qué hora.
    for (const instante of umbra.instantes) {
      const fecha = new Date(instante.t);
      if (fecha.getUTCSeconds() !== 0 || fecha.getUTCMinutes() % 2 !== 0) {
        continue;
      }
      marcadores.push(
        new maplibregl.Marker({
          element: crearEtiqueta(
            formatoHoraCEST(fecha.getTime()),
            true,
            "#55504a",
          ),
          anchor: "left",
          offset: [-3, 0],
        })
          .setLngLat([instante.centro.lon, instante.centro.lat])
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

  // --- Capa de nubes: previsión al activar el toggle ------------------------
  // La descarga se refresca en cada activación, no en cada carga de la
  // página; `obtenerNubesFranja` cachea en memoria 30 min, así que activar
  // y desactivar el toggle no repite la petición dentro de esa ventana.
  // La rejilla de puntos vive en el servidor (proxy /api/nubes-franja,
  // issue #69): ya no hace falta la banda para pedir la capa.
  useEffect(() => {
    if (!nubesActivas) return;
    let cancelado = false;
    setCargandoNubes(true);
    setErrorNubes(false);
    obtenerNubesFranja()
      .then((puntos) => {
        if (!cancelado) setNubes(puntos);
      })
      .catch(() => {
        if (!cancelado) setErrorNubes(true);
      })
      .finally(() => {
        if (!cancelado) setCargandoNubes(false);
      });
    return () => {
      cancelado = true;
    };
  }, [nubesActivas]);

  // Círculos coloreados por nubosidad media, bajo los límites de la banda
  // y la umbra para no tapar la geometría del eclipse.
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !capasListas || !nubesActivas || !nubes) return;

    mapa.addSource("nubes", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: nubes.map((punto) => ({
          type: "Feature",
          properties: {
            color: COLORES_NUBES[clasificarColorNube(punto.nubosidadMedia)],
          },
          geometry: { type: "Point", coordinates: [punto.lon, punto.lat] },
        })),
      },
    });
    mapa.addLayer(
      {
        id: "nubes-circulos",
        type: "circle",
        source: "nubes",
        paint: {
          "circle-color": ["get", "color"],
          "circle-opacity": 0.4,
          "circle-blur": 0.35,
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            9,
            7,
            26,
          ],
        },
      },
      "banda-limites",
    );

    return () => {
      if (mapaRef.current === mapa && mapa.getSource("nubes")) {
        if (mapa.getLayer("nubes-circulos")) mapa.removeLayer("nubes-circulos");
        mapa.removeSource("nubes");
      }
    };
  }, [capasListas, nubesActivas, nubes]);

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

  // --- Indicador de borde: la sombra se ve venir aunque esté fuera ----------
  // Punto de referencia de la distancia y la hora de llegada: el Observador
  // si está definido; si no, el centro del encuadre actual. "Llega" es el
  // primer instante tabulado (paso 30 s) en que el contorno de la umbra
  // toca ese punto (`llegadaUmbra` en lib/mapa.ts).
  const observadorRef = useRef(observador);
  observadorRef.current = observador;
  const indicadorRef = useRef<HTMLDivElement | null>(null);
  const ultimoTUmbraRef = useRef<number | null>(null);

  const actualizarIndicador = useCallback(() => {
    const mapa = mapaRef.current;
    const el = indicadorRef.current;
    if (!mapa || !el) return;
    const instantes = instantesUmbraRef.current;
    const t = ultimoTUmbraRef.current;
    if (!capasListasRef.current || instantes.length === 0 || t === null) {
      el.style.display = "none";
      return;
    }
    const tFin = new Date(instantes[instantes.length - 1].t).getTime();
    if (t > tFin) {
      // La sombra ya salió de la superficie: no hay nada que anticipar.
      el.style.display = "none";
      return;
    }
    // Antes del primer instante tabulado la sombra aún viene de camino:
    // se anticipa con su primera posición conocida.
    const t0 = new Date(instantes[0].t).getTime();
    const umbra = interpolarUmbra(instantes, new Date(Math.max(t, t0)));
    if (!umbra) {
      el.style.display = "none";
      return;
    }
    const centroSombra: [number, number] = [umbra.centro.lon, umbra.centro.lat];
    if (mapa.getBounds().contains(centroSombra)) {
      el.style.display = "none";
      return;
    }

    const encuadre = mapa.getCenter();
    const obs = observadorRef.current;
    const referencia: [number, number] = obs
      ? [obs.lon, obs.lat]
      : [encuadre.lng, encuadre.lat];
    const km = Math.max(10, Math.round(distanciaKm(referencia, centroSombra) / 10) * 10);
    const llegada = llegadaUmbra(instantes, referencia);
    const sufijoLlegada =
      llegada !== null && llegada >= t
        ? ` — llega ${formatoHoraCEST(llegada)}`
        : "";

    // Lado del encuadre por el que asoma la sombra (rumbo aproximado del
    // centro de la sombra visto desde el centro del encuadre).
    const dx =
      (centroSombra[0] - encuadre.lng) *
      Math.cos((encuadre.lat * Math.PI) / 180);
    const dy = centroSombra[1] - encuadre.lat;
    const texto = `sombra a ${km} km${sufijoLlegada}`;
    el.style.left = "";
    el.style.right = "";
    el.style.top = "";
    el.style.bottom = "";
    if (Math.abs(dx) >= Math.abs(dy)) {
      el.style.top = "50%";
      el.style.transform = "translateY(-50%)";
      if (dx < 0) {
        el.style.left = "10px";
        el.textContent = `⏴ ${texto}`;
      } else {
        el.style.right = "10px";
        el.textContent = `${texto} ⏵`;
      }
    } else {
      el.style.left = "50%";
      el.style.transform = "translateX(-50%)";
      if (dy > 0) {
        el.style.top = "10px";
        el.textContent = `⏶ ${texto}`;
      } else {
        el.style.bottom = "10px";
        el.textContent = `⏷ ${texto}`;
      }
    }
    el.style.display = "block";
  }, []);

  // Reevaluar el indicador al panear/zoomear y cuando cambian las capas o
  // el Observador (la Línea de tiempo ya lo reevalúa en cada frame).
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !mapaListo) return;
    mapa.on("move", actualizarIndicador);
    return () => {
      mapa.off("move", actualizarIndicador);
    };
  }, [mapaListo, actualizarIndicador]);
  useEffect(() => {
    actualizarIndicador();
  }, [capasListas, observador, actualizarIndicador]);

  // --- Umbra animada: se actualiza en cada frame de la Línea de tiempo ------
  const pintarUmbra = useCallback(
    (t: number) => {
      const mapa = mapaRef.current;
      if (!mapa || !capasListasRef.current) return;
      if (ultimoTUmbraRef.current === t) return;
      ultimoTUmbraRef.current = t;

      const umbra = interpolarUmbra(instantesUmbraRef.current, new Date(t));
      actualizarIndicador();
      const fuente = mapa.getSource<maplibregl.GeoJSONSource>("umbra");
      if (!fuente) return;
      if (!umbra) {
        fuente.setData(FC_VACIA);
        return;
      }
      fuente.setData({
        type: "FeatureCollection",
        features: [
          // Halo exterior: borde difuso barato (contorno ampliado, tenue).
          {
            type: "Feature",
            properties: { opacidad: 0.14 },
            geometry: contornoUmbra(umbra, 1.18),
          },
          {
            type: "Feature",
            properties: { opacidad: 0.45 },
            geometry: contornoUmbra(umbra),
          },
        ],
      });
    },
    [actualizarIndicador],
  );

  // Contactos del Observador (o de Ferrol por defecto) para la curva del
  // modo resumen y los botones de salto. Clave por lat/lon: el objeto
  // `observador` puede cambiar de identidad sin cambiar de valor.
  const lat = observador?.lat ?? OBSERVADOR_DEFECTO.lat;
  const lon = observador?.lon ?? OBSERVADOR_DEFECTO.lon;
  const contactos = useMemo((): ContactosMs => {
    const circ = circunstanciasLocales({ lat, lon });
    return {
      c1: circ.c1.instante.getTime(),
      c2: circ.c2 ? circ.c2.instante.getTime() : null,
      maximo: circ.maximo.instante.getTime(),
      c3: circ.c3 ? circ.c3.instante.getTime() : null,
      c4: circ.c4.instante.getTime(),
    };
  }, [lat, lon]);

  // Reloj único de la Línea de tiempo, compartido con la Vista Cielo y la
  // barra única de la home: esta vista solo suscribe su pintor de la umbra
  // al bucle común (los controles viven en BarraTiempo, #36).
  useLineaDeTiempo({ contactos, onFrame: pintarUmbra });

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
      <h2 style={{ fontSize: "var(--fs-titulo)", margin: "var(--sp-parrafo) 0 8px" }}>
        Vista Mapa
      </h2>
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
        <div
          ref={indicadorRef}
          aria-live="polite"
          style={{
            position: "absolute",
            display: "none",
            padding: "0.3rem 0.7rem",
            borderRadius: 999,
            background: "rgba(20, 24, 48, 0.85)",
            color: "#ffd97a",
            fontSize: "var(--fs-mini)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 2,
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

      {/* Control de la isolínea en vivo (la hora la muestra la barra única) */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 12,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            fontSize: "var(--fs-dato)",
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
            style={{
              width: "clamp(120px, 40vw, 180px)",
              accentColor: COLOR_FRANJA_VIVA,
            }}
          />
        </label>

        {/* Capa de nubes: toggle + leyenda compacta */}
        <button
          type="button"
          aria-pressed={nubesActivas}
          onClick={() => setNubesActivas((activas) => !activas)}
          style={{
            padding: "0.3rem 0.8rem",
            borderRadius: 999,
            border: `1px solid ${nubesActivas ? "#6b7280" : "#c5c9cf"}`,
            background: nubesActivas ? "#eef1f5" : "transparent",
            color: nubesActivas ? "#1f2937" : "inherit",
            fontSize: "var(--fs-dato)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ☁️ Nubes
        </button>
        {nubesActivas && cargandoNubes && (
          <span style={{ opacity: 0.65, fontSize: "var(--fs-nota)" }}>
            Cargando previsión…
          </span>
        )}
        {nubesActivas && errorNubes && !cargandoNubes && (
          <span role="alert" style={{ color: "#b45309", fontSize: "var(--fs-nota)" }}>
            Previsión no disponible ahora mismo.
          </span>
        )}
        {nubesActivas && nubes && !cargandoNubes && !errorNubes && (
          <span
            aria-label="Leyenda de nubosidad media prevista (ventana 19:30–21:30)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              fontSize: "var(--fs-mini)",
              opacity: 0.85,
            }}
          >
            {LEYENDA_NUBES.map(({ color, texto }) => (
              <span
                key={color}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: COLORES_NUBES[color],
                    opacity: 0.75,
                    flex: "none",
                  }}
                />
                {texto}
              </span>
            ))}
            <span style={{ opacity: 0.7 }}>nubes 19:30–21:30</span>
          </span>
        )}
      </div>
      {!rejilla && !errorDatos && (
        <p style={{ margin: "4px 0 0", opacity: 0.65, fontSize: "var(--fs-nota)" }}>
          Calculando la isolínea en vivo con el motor astronómico…{" "}
          {Math.round(progreso * 100)} %
        </p>
      )}

      <p
        style={{
          margin: "var(--sp-tarjeta-v) 0 0",
          opacity: 0.7,
          fontSize: "var(--fs-nota)",
        }}
      >
        Haz clic en el mapa para situar al Observador en el municipio más
        cercano. La sombra (umbra) entra por el Atlántico y cruza la
        península entre las 20:20 y las 20:34 aproximadamente; las marcas
        sobre su trayectoria indican la hora (CEST) de paso del centro.
      </p>
      <p style={{ margin: "4px 0 0", opacity: 0.5, fontSize: "var(--fs-mini)" }}>
        Mapa: © OpenStreetMap contributors © CARTO.
      </p>
    </section>
  );
}
