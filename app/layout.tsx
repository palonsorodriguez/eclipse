import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import RegistroSW from "./components/RegistroSW";

const inter = Inter({ subsets: ["latin"], variable: "--fuente-texto" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--fuente-titulos",
});

const DESCRIPCION =
  "Simulador del eclipse solar total del 12 de agosto de 2026 visto desde cualquier municipio de España.";

// Título de la tarjeta al compartir (WhatsApp, redes) — ticket #42.
const TITULO_OG = "¿Cómo se verá el eclipse del 12-08-2026 desde tu municipio?";

export const metadata: Metadata = {
  // Base para resolver la imagen OG en absoluto: dominio de producción en
  // Vercel; en local, el puerto de `next dev`.
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  ),
  title: "Eclipse — 12 de agosto de 2026",
  description: DESCRIPCION,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: TITULO_OG,
    description: DESCRIPCION,
    type: "website",
    locale: "es_ES",
    siteName: "Eclipse",
    // Imagen estática versionada; se regenera con `node scripts/generar-og.mjs`.
    images: [{ url: "/og.png", width: 1200, height: 630, alt: TITULO_OG }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITULO_OG,
    description: DESCRIPCION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d17",
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
        <RegistroSW />
        {children}
        <footer
          style={{
            textAlign: "center",
            fontSize: "0.85rem",
            opacity: 0.55,
            // La barra de tiempo sticky mide 61 px: el pie respira sobre ella.
            padding: "2.5rem 1rem calc(2rem + 61px)",
          }}
        >
          Hecho en Ferrol, bajo la franja de totalidad — Pablo Alonso · 2026
        </footer>
        {/* Vercel Web Analytics sin paquete npm (su peer opcional de Svelte
            choca con el vite de vitest): el script oficial responde en
            /_vercel/insights/ cuando Analytics está activado en el proyecto. */}
        <Script src="/_vercel/insights/script.js" strategy="lazyOnload" />
      </body>
    </html>
  );
}
