"use client";

import { useEffect, useRef, useState } from "react";
import type { Municipio } from "@/lib/municipios";

interface Props {
  onSelect: (municipio: Municipio) => void;
}

type Buscar = (consulta: string, limite?: number) => Municipio[];

/**
 * Buscador de municipios con autocompletado.
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
    <div style={{ position: "relative", width: "100%", maxWidth: "24rem" }}>
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
          padding: "0.75rem 1rem",
          fontSize: "1rem",
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
              <span style={{ opacity: 0.6, fontSize: "0.875rem" }}>
                ({municipio.provincia})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
