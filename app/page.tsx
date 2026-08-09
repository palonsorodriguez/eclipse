"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import BarraTiempo from "./components/BarraTiempo";
import BuscadorMunicipio from "./components/BuscadorMunicipio";
import PanelCircunstancias from "./components/PanelCircunstancias";
import VistaAstros from "./components/VistaAstros";
import VistaCielo from "./components/VistaCielo";
import { VENTANA_TOTALIDAD } from "@/lib/eclipse-2026";
import type { Municipio } from "@/lib/municipios";
import { relojLineaDeTiempo } from "@/lib/reloj-tiempo";
import { construirQuery, leerEstado, municipioPorSlug } from "@/lib/url-estado";

// MapLibre toca `window` al cargar: la Vista Mapa solo existe en cliente.
const VistaMapa = dynamic(() => import("./components/VistaMapa"), {
  ssr: false,
  loading: () => <p style={{ opacity: 0.6 }}>Cargando la Vista Mapa…</p>,
});

export default function Home() {
  const [observador, setObservador] = useState<Municipio | null>(null);
  // La URL no se reescribe hasta haber restaurado el estado entrante (#42):
  // si no, el primer render pisaría el `?m=…` recién abierto.
  const urlRestaurada = useRef(false);

  // Restaurar `?m=<slug>&t=<HHMMSS>` al abrir un enlace compartido (#42).
  // La `t` se fija por la API pública del reloj (`saltarA` recorta al rango);
  // el municipio se resuelve contra el Nomenclátor, importado dinámicamente
  // para no meter su JSON (~620 KB) en el bundle inicial.
  useEffect(() => {
    const { slug, t } = leerEstado(window.location.search);
    if (t !== null) relojLineaDeTiempo.saltarA(t);
    if (!slug) {
      urlRestaurada.current = true;
      return;
    }
    let cancelado = false;
    import("@/lib/municipios").then(({ municipios }) => {
      if (cancelado) return;
      const municipio = municipioPorSlug(slug, municipios);
      if (municipio) setObservador(municipio);
      urlRestaurada.current = true;
    });
    return () => {
      cancelado = true;
    };
  }, []);

  // Reflejar Observador y Línea de tiempo en la URL con replaceState (sin
  // ensuciar el historial). Los cambios de `t` llegan por la suscripción de
  // UI del reloj y se agrupan (300 ms): Safari limita el ritmo de
  // replaceState y en reproducción la t cambia cada segundo simulado.
  useEffect(() => {
    let temporizador: number | undefined;
    const escribir = () => {
      if (!urlRestaurada.current) return;
      const t = relojLineaDeTiempo.leerTUi();
      // Recién aterrizado, sin Observador ni slider tocado: URL limpia.
      const query =
        observador === null && t === relojLineaDeTiempo.tMin
          ? ""
          : construirQuery({ municipio: observador, t });
      history.replaceState(null, "", `${window.location.pathname}${query}`);
    };
    const baja = relojLineaDeTiempo.suscribirUi(() => {
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(escribir, 300);
    });
    escribir(); // el cambio de Observador se refleja de inmediato
    return () => {
      window.clearTimeout(temporizador);
      baja();
    };
  }, [observador]);

  // Clic en la Vista Mapa → Observador en el municipio más cercano.
  // `lib/municipios` se importa dinámicamente: su JSON (~620 KB) no debe
  // entrar en el bundle inicial (ver el aviso en ese módulo).
  const elegirEnMapa = useCallback(async (lat: number, lon: number) => {
    const [{ municipios }, { municipioMasCercano }] = await Promise.all([
      import("@/lib/municipios"),
      import("@/lib/mapa"),
    ]);
    setObservador(municipioMasCercano(lat, lon, municipios));
  }, []);

  return (
    <>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "var(--sp-pagina)",
          textAlign: "center",
          gap: "var(--sp-bloque)",
        }}
      >
        <div
          aria-hidden
          style={{
            width: "var(--disco-hero)",
            height: "var(--disco-hero)",
            borderRadius: "50%",
            background: "#0b0d17",
            boxShadow: "0 0 40px 12px rgba(255, 244, 214, 0.55)",
            marginBottom: "var(--sp-bloque)",
          }}
        />
        <h1 style={{ fontSize: "var(--fs-h1)", margin: 0 }}>Eclipse</h1>
        <p
          style={{
            fontSize: "var(--fs-subtitulo)",
            maxWidth: "36rem",
            opacity: 0.85,
            margin: "var(--sp-parrafo) 0",
          }}
        >
          Simulador del eclipse solar total del{" "}
          <strong>12 de agosto de 2026</strong> desde cualquier municipio de
          España.
        </p>
        <BuscadorMunicipio onSelect={setObservador} />
        {observador ? (
          <p style={{ margin: 0, textAlign: "center" }}>
            Observador: <strong>{observador.nombre}</strong> (
            {observador.provincia})
            {/* Las coordenadas envuelven como pareja de bloques enteros:
                en móvil caen limpias una bajo otra, nunca partidas. */}
            <span
              style={{
                opacity: 0.6,
                display: "inline-flex",
                flexWrap: "wrap",
                justifyContent: "center",
                columnGap: "0.6rem",
                marginLeft: "0.6rem",
                verticalAlign: "baseline",
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>
                Lat {observador.lat.toFixed(4)}°
              </span>
              <span style={{ whiteSpace: "nowrap" }}>
                Lon {observador.lon.toFixed(4)}°
              </span>
            </span>
          </p>
        ) : (
          <p style={{ opacity: 0.6, margin: 0 }}>
            Elige un municipio para situar al Observador.
          </p>
        )}
        {observador && <PanelCircunstancias observador={observador} />}
        <p style={{ opacity: 0.6, margin: "var(--sp-parrafo) 0" }}>
          Totalidad sobre España: {VENTANA_TOTALIDAD.inicio}–
          {VENTANA_TOTALIDAD.fin} (hora peninsular). En construcción.
        </p>
        <VistaCielo
          observador={
            observador ? { lat: observador.lat, lon: observador.lon } : undefined
          }
        />
        <VistaMapa
          observador={
            observador ? { lat: observador.lat, lon: observador.lon } : null
          }
          onSelect={elegirEnMapa}
        />
        <VistaAstros />
        <Link href="/info" style={{ color: "#ffe9a8", fontSize: "var(--fs-cuerpo)" }}>
          Cómo verlo sin dañarte la vista, y de dónde salen los datos
        </Link>
      </main>
      {/* La barra de tiempo única (#36): sticky al fondo del scroll, fuera
          del <main> centrado para ocupar todo el ancho del viewport. */}
      <BarraTiempo
        observador={
          observador ? { lat: observador.lat, lon: observador.lon } : null
        }
      />
    </>
  );
}
