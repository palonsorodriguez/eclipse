import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--fuente-texto" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--fuente-titulos",
});

export const metadata: Metadata = {
  title: "Eclipse — 12 de agosto de 2026",
  description:
    "Simulador del eclipse solar total del 12 de agosto de 2026 visto desde cualquier municipio de España.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body
        style={{
          margin: 0,
          fontFamily: "var(--fuente-texto), system-ui, sans-serif",
          background: "#0b0d17",
          color: "#dcd9e8",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
