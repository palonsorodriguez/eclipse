import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/nubes-franja deriva su rejilla de la banda de totalidad leyendo
  // el geojson del filesystem en runtime; el trazado automático de ficheros
  // no siempre detecta lecturas con fs, así que se incluye explícitamente
  // en el bundle de esa función serverless (issue #69).
  outputFileTracingIncludes: {
    "/api/nubes-franja": ["./public/geodata/banda-totalidad.geojson"],
  },
};

export default nextConfig;
