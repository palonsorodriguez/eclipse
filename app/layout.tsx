import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
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

/**
 * Escala tipográfica y de densidad de TODA la app (issue #60), definida
 * UNA sola vez: los componentes consumen estas variables en sus estilos
 * inline (`fontSize: "var(--fs-titulo)"`) y la media query de ≤480 px las
 * reduce todas a la vez — nada de repetir media queries por componente.
 *
 * - `--fs-*`: tamaños de fuente (h1, títulos de sección, cuerpo, datos…).
 * - `--sp-*`: espaciados verticales (padding de página/tarjeta, gaps).
 * - `--pad-*`: rellenos de controles (inputs y botones).
 * En móvil los espaciados bajan ~30 % y las fuentes un punto: denso y
 * legible, no encogido desde escritorio.
 */
const CSS_ESCALA = `
:root {
  --fs-h1: 2rem;
  --fs-h2: 1.5rem;
  --fs-titulo: 1.3rem;
  --fs-subtitulo: 1.1rem;
  --fs-cuerpo: 1.04rem;
  --fs-dato-grande: 1.6rem;
  --fs-dato: 1rem;
  --fs-peque: 0.9rem;
  --fs-nota: 0.85rem;
  --fs-mini: 0.8rem;
  --lh-cuerpo: 1.7;
  --sp-pagina: 2rem;
  --sp-bloque: 1rem;
  --sp-parrafo: 1rem;
  --sp-tarjeta: 1.25rem;
  --sp-tarjeta-v: 0.75rem;
  --sp-seccion-info: 3.25rem;
  --pad-control: 0.75rem 1rem;
  --pad-boton: 0.75rem 0.9rem;
  --disco-hero: 120px;
}
@media (max-width: 480px) {
  :root {
    --fs-h1: 1.5rem;
    --fs-h2: 1.2rem;
    --fs-titulo: 1.05rem;
    --fs-subtitulo: 1rem;
    --fs-cuerpo: 0.95rem;
    --fs-dato-grande: 1.35rem;
    --fs-dato: 0.9rem;
    --fs-peque: 0.82rem;
    --fs-nota: 0.78rem;
    --fs-mini: 0.72rem;
    --lh-cuerpo: 1.55;
    --sp-pagina: 1rem;
    --sp-bloque: 0.7rem;
    --sp-parrafo: 0.35rem;
    --sp-tarjeta: 0.85rem;
    --sp-tarjeta-v: 0.5rem;
    --sp-seccion-info: 2rem;
    --pad-control: 0.55rem 0.75rem;
    --pad-boton: 0.55rem 0.7rem;
    --disco-hero: 84px;
  }
}
`;

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
        <style>{CSS_ESCALA}</style>
        <RegistroSW />
        {children}
      </body>
    </html>
  );
}
