"use client";

/**
 * Registra el service worker (`public/sw.js`) que hace la app instalable y
 * usable sin conexión. Solo en producción: en desarrollo el SW interferiría
 * con el HMR de Turbopack y serviría chunks obsoletos.
 *
 * No renderiza nada; se monta una vez en `app/layout.tsx`.
 */
import { useEffect } from "react";

export default function RegistroSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const registrar = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("No se pudo registrar el service worker:", error);
      });
    };

    // Tras load para no competir con la carga inicial de la página.
    if (document.readyState === "complete") {
      registrar();
    } else {
      window.addEventListener("load", registrar, { once: true });
      return () => window.removeEventListener("load", registrar);
    }
  }, []);

  return null;
}
