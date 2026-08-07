import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Eclipse — 12 de agosto de 2026",
  description:
    "Simulador del eclipse solar total del 12 de agosto de 2026 visto desde cualquier municipio de España.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#0b0d17",
          color: "#e8e6f0",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
