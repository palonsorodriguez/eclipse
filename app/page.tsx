"use client";

import Link from "next/link";
import { useState } from "react";
import BuscadorMunicipio from "./components/BuscadorMunicipio";
import PanelCircunstancias from "./components/PanelCircunstancias";
import VistaCielo from "./components/VistaCielo";
import { VENTANA_TOTALIDAD } from "@/lib/eclipse-2026";
import type { Municipio } from "@/lib/municipios";

export default function Home() {
  const [observador, setObservador] = useState<Municipio | null>(null);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
        textAlign: "center",
        gap: "1rem",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: "#0b0d17",
          boxShadow: "0 0 40px 12px rgba(255, 244, 214, 0.55)",
          marginBottom: "1rem",
        }}
      />
      <h1 style={{ fontSize: "2rem", margin: 0 }}>Eclipse</h1>
      <p style={{ fontSize: "1.1rem", maxWidth: "36rem", opacity: 0.85 }}>
        Simulador del eclipse solar total del{" "}
        <strong>12 de agosto de 2026</strong> desde cualquier municipio de
        España.
      </p>
      <BuscadorMunicipio onSelect={setObservador} />
      {observador ? (
        <p style={{ margin: 0 }}>
          Observador: <strong>{observador.nombre}</strong> (
          {observador.provincia}){" "}
          <span style={{ opacity: 0.6 }}>
            — {observador.lat.toFixed(4)}°, {observador.lon.toFixed(4)}°
          </span>
        </p>
      ) : (
        <p style={{ opacity: 0.6, margin: 0 }}>
          Elige un municipio para situar al Observador.
        </p>
      )}
      {observador && <PanelCircunstancias observador={observador} />}
      <p style={{ opacity: 0.6 }}>
        Totalidad sobre España: {VENTANA_TOTALIDAD.inicio}–
        {VENTANA_TOTALIDAD.fin} (hora peninsular). En construcción.
      </p>
      <VistaCielo
        observador={
          observador ? { lat: observador.lat, lon: observador.lon } : undefined
        }
      />
      <Link href="/info" style={{ color: "#ffe9a8", fontSize: "1.05rem" }}>
        Cómo verlo sin dañarte la vista, y de dónde salen los datos
      </Link>
    </main>
  );
}
