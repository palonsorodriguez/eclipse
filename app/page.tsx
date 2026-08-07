import Link from "next/link";
import { VENTANA_TOTALIDAD } from "@/lib/eclipse-2026";

export default function Home() {
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
      <p style={{ opacity: 0.6 }}>
        Totalidad sobre España: {VENTANA_TOTALIDAD.inicio}–
        {VENTANA_TOTALIDAD.fin} (hora peninsular). En construcción.
      </p>
      <Link href="/info" style={{ color: "#ffe9a8", fontSize: "1.05rem" }}>
        Cómo verlo sin dañarte la vista, y de dónde salen los datos
      </Link>
    </main>
  );
}
