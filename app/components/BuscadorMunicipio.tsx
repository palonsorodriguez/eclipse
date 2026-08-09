"use client";

import { useEffect, useRef, useState } from "react";
import type { Municipio } from "@/lib/municipios";

interface Props {
  onSelect: (municipio: Municipio) => void;
}

type Buscar = (consulta: string, limite?: number) => Municipio[];

const ESTILO_BOTON: React.CSSProperties = {
  padding: "var(--pad-boton)",
  fontSize: "var(--fs-dato)",
  color: "#e8e6f0",
  background: "#141830",
  border: "1px solid #2c3155",
  borderRadius: "0.5rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/**
 * Buscador de municipios con autocompletado, más los dos accesos rápidos del
 * ticket #42: "📍 Usar mi ubicación" (geolocalización → Municipio más
 * cercano) y "Compartir" (Web Share API en móvil; si no existe, copia la URL
 * al portapapeles con un toast "enlace copiado").
 *
 * Peso: el dataset (~620 KB sin comprimir) supera el umbral de ~500 KB, así
 * que `lib/municipios` (que importa el JSON) se carga con `import()` dinámico
 * en el primer montaje del componente: el bundler lo separa en un chunk propio
 * y el JSON nunca entra en el bundle inicial de la página.
 */
export default function BuscadorMunicipio({ onSelect }: Props) {
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<Municipio[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [indiceActivo, setIndiceActivo] = useState(-1);
  const buscarRef = useRef<Buscar | null>(null);
  const [listo, setListo] = useState(false);
  const [localizando, setLocalizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timerToastRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerToastRef.current), []);

  const mostrarToast = (texto: string) => {
    setToast(texto);
    window.clearTimeout(timerToastRef.current);
    timerToastRef.current = window.setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    let cancelado = false;
    import("@/lib/municipios").then((modulo) => {
      if (cancelado) return;
      buscarRef.current = modulo.buscarMunicipios;
      setListo(true);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    if (!listo || !buscarRef.current) return;
    const encontrados = buscarRef.current(consulta, 8);
    setResultados(encontrados);
    setIndiceActivo(encontrados.length > 0 ? 0 : -1);
  }, [consulta, listo]);

  const seleccionar = (municipio: Municipio) => {
    setConsulta(municipio.nombre);
    setAbierto(false);
    onSelect(municipio);
  };

  // "📍 Usar mi ubicación": geolocalización del navegador → Municipio más
  // cercano por haversine. Los errores (permiso denegado, sin señal) degradan
  // a un aviso suave bajo el buscador, nunca a una excepción.
  const usarMiUbicacion = () => {
    setAviso(null);
    if (!("geolocation" in navigator)) {
      setAviso("Tu navegador no permite usar la ubicación; busca tu municipio.");
      return;
    }
    setLocalizando(true);
    navigator.geolocation.getCurrentPosition(
      async (posicion) => {
        try {
          const [{ municipios }, { municipioMasCercano }] = await Promise.all([
            import("@/lib/municipios"),
            import("@/lib/mapa"),
          ]);
          seleccionar(
            municipioMasCercano(
              posicion.coords.latitude,
              posicion.coords.longitude,
              municipios,
            ),
          );
        } catch {
          setAviso("No hemos podido situar tu municipio; búscalo a mano.");
        } finally {
          setLocalizando(false);
        }
      },
      (error) => {
        setLocalizando(false);
        setAviso(
          error.code === error.PERMISSION_DENIED
            ? "Sin permiso de ubicación — no pasa nada, busca tu municipio."
            : "No hemos podido obtener tu ubicación; busca tu municipio.",
        );
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  // "Compartir": Web Share API si existe (móvil); si no, portapapeles + toast.
  const compartir = async () => {
    const url = window.location.href;
    const datos = {
      title: "Eclipse — 12 de agosto de 2026",
      text: "¿Cómo se verá el eclipse del 12-08-2026 desde tu municipio?",
      url,
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(datos);
        return;
      } catch {
        return; // cancelado por el usuario: silencio
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      mostrarToast("enlace copiado");
    } catch {
      mostrarToast("no se pudo copiar el enlace");
    }
  };

  const alTeclear = (evento: React.KeyboardEvent<HTMLInputElement>) => {
    if (!abierto || resultados.length === 0) {
      if (evento.key === "ArrowDown" && resultados.length > 0) setAbierto(true);
      return;
    }
    switch (evento.key) {
      case "ArrowDown":
        evento.preventDefault();
        setIndiceActivo((i) => (i + 1) % resultados.length);
        break;
      case "ArrowUp":
        evento.preventDefault();
        setIndiceActivo((i) => (i - 1 + resultados.length) % resultados.length);
        break;
      case "Enter":
        evento.preventDefault();
        if (indiceActivo >= 0) seleccionar(resultados[indiceActivo]!);
        break;
      case "Escape":
        setAbierto(false);
        break;
    }
  };

  const mostrarLista = abierto && resultados.length > 0;

  return (
    <div style={{ width: "100%", maxWidth: "32rem" }}>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <div style={{ position: "relative", flex: "1 1 14rem" }}>
          <input
            type="text"
            role="combobox"
            aria-expanded={mostrarLista}
            aria-controls="lista-municipios"
            aria-activedescendant={
              indiceActivo >= 0 ? `municipio-opcion-${indiceActivo}` : undefined
            }
            aria-autocomplete="list"
            aria-label="Buscar municipio"
            placeholder={listo ? "Busca tu municipio…" : "Cargando municipios…"}
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              setAbierto(true);
            }}
            onFocus={() => setAbierto(true)}
            onBlur={() => setTimeout(() => setAbierto(false), 150)}
            onKeyDown={alTeclear}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "var(--pad-control)",
              fontSize: "var(--fs-dato)",
              color: "#e8e6f0",
              background: "#141830",
              border: "1px solid #2c3155",
              borderRadius: "0.5rem",
              outline: "none",
            }}
          />
          {mostrarLista && (
            <ul
              id="lista-municipios"
              role="listbox"
              style={{
                position: "absolute",
                top: "calc(100% + 0.25rem)",
                left: 0,
                right: 0,
                margin: 0,
                padding: "0.25rem",
                listStyle: "none",
                background: "#141830",
                border: "1px solid #2c3155",
                borderRadius: "0.5rem",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
                zIndex: 10,
                textAlign: "left",
              }}
            >
              {resultados.map((municipio, i) => (
                <li
                  key={`${municipio.nombre}|${municipio.provincia}`}
                  id={`municipio-opcion-${i}`}
                  role="option"
                  aria-selected={i === indiceActivo}
                  onMouseDown={(e) => {
                    e.preventDefault(); // que el blur del input no cierre antes del click
                    seleccionar(municipio);
                  }}
                  onMouseEnter={() => setIndiceActivo(i)}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                    background: i === indiceActivo ? "#232a52" : "transparent",
                  }}
                >
                  {municipio.nombre}{" "}
                  <span style={{ opacity: 0.6, fontSize: "var(--fs-nota)" }}>
                    ({municipio.provincia})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={usarMiUbicacion}
          disabled={localizando}
          title="Usar mi ubicación"
          style={{ ...ESTILO_BOTON, opacity: localizando ? 0.6 : 1 }}
        >
          {localizando ? "Localizando…" : "📍 Usar mi ubicación"}
        </button>
        <button type="button" onClick={compartir} style={ESTILO_BOTON}>
          Compartir
        </button>
      </div>
      {aviso && (
        <p
          role="status"
          style={{
            margin: "0.5rem 0 0",
            fontSize: "var(--fs-peque)",
            opacity: 0.75,
          }}
        >
          {aviso}
        </p>
      )}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: "5rem",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "0.5rem 1rem",
            background: "#232a52",
            border: "1px solid #2c3155",
            borderRadius: "0.5rem",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
            zIndex: 30,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
