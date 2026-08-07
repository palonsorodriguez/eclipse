/**
 * Tests de lib/geodata: carga de los ficheros de `public/geodata/` y
 * cordura de los datos generados por `scripts/build-geodata.ts`.
 *
 * Referencias de cordura (IGN/NASA, ver ticket #5):
 * - La línea central de la Franja de totalidad pasa cerca de Burgos.
 * - Oviedo está dentro de la Franja; Sevilla, fuera.
 * - Madrid queda fuera de la Franja pero con Oscurecimiento > 99%.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cargarBandaTotalidad,
  cargarIsolineas,
  cargarUmbra,
  distanciaKm,
  puntoEnMultiPolygon,
  type BandaTotalidadGeoJSON,
  type IsolineasGeoJSON,
  type LimiteBanda,
  type UmbraJSON,
} from "./geodata";

const DIR_GEODATA = join(process.cwd(), "public", "geodata");

function leerFichero<T>(nombre: string): T {
  return JSON.parse(readFileSync(join(DIR_GEODATA, nombre), "utf8")) as T;
}

const banda = leerFichero<BandaTotalidadGeoJSON>("banda-totalidad.geojson");
const isolineas = leerFichero<IsolineasGeoJSON>("isolineas.geojson");
const umbra = leerFichero<UmbraJSON>("umbra.json");

/** Puntos de referencia, en orden GeoJSON [lon, lat]. */
const BURGOS: [number, number] = [-3.6969, 42.3439];
const OVIEDO: [number, number] = [-5.8593, 43.3614];
const SEVILLA: [number, number] = [-5.9845, 37.3891];
const MADRID: [number, number] = [-3.7038, 40.4168];

function lineaBanda(limite: LimiteBanda) {
  const feature = banda.features.find((f) => f.properties.limite === limite);
  if (!feature) throw new Error(`Falta la línea "${limite}" en la banda`);
  return feature.geometry.coordinates;
}

/**
 * Latitud de una línea de la banda en una longitud dada, interpolando
 * linealmente entre los dos vértices que la encierran (las líneas están
 * ordenadas de oeste a este).
 */
function latitudEn(limite: LimiteBanda, lon: number): number {
  const coords = lineaBanda(limite);
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    if (lon1 <= lon && lon <= lon2) {
      return lat1 + ((lat2 - lat1) * (lon - lon1)) / (lon2 - lon1);
    }
  }
  throw new Error(`La banda no cubre la longitud ${lon}`);
}

// ---------------------------------------------------------------------------
// Carga vía fetch (interfaz pública de lib/geodata)
// ---------------------------------------------------------------------------

describe("carga desde /geodata/ vía fetch", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (ruta: string) => {
        const nombre = ruta.replace("/geodata/", "");
        const cuerpo = readFileSync(join(DIR_GEODATA, nombre), "utf8");
        return new Response(cuerpo, { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("cargarBandaTotalidad devuelve las tres líneas de la Franja", async () => {
    const b = await cargarBandaTotalidad();
    expect(b.features.map((f) => f.properties.limite).sort()).toEqual([
      "central",
      "norte",
      "sur",
    ]);
  });

  test("cargarIsolineas devuelve los niveles 80/90/95/99", async () => {
    const iso = await cargarIsolineas();
    expect(iso.features.map((f) => f.properties.nivel).sort()).toEqual([
      0.8, 0.9, 0.95, 0.99,
    ]);
  });

  test("cargarUmbra devuelve instantes ordenados con elipses plausibles", async () => {
    const u = await cargarUmbra();
    expect(u.instantes.length).toBeGreaterThan(10);
    for (const i of u.instantes) {
      expect(i.semiejeMayorKm).toBeGreaterThanOrEqual(i.semiejeMenorKm);
      // La umbra del 2026 mide ~60 km de semieje menor sobre España; solo
      // en el último instante, rozando el terminador, baja de 20 km.
      expect(i.semiejeMenorKm).toBeGreaterThan(5);
      expect(i.semiejeMayorKm).toBeLessThanOrEqual(600);
      expect(i.orientacionGrados).toBeGreaterThanOrEqual(0);
      expect(i.orientacionGrados).toBeLessThan(180);
    }
  });
});

// ---------------------------------------------------------------------------
// Cordura de los datos generados
// ---------------------------------------------------------------------------

describe("banda-totalidad.geojson", () => {
  test("la línea central pasa a menos de 60 km de Burgos", () => {
    const distanciaMinima = Math.min(
      ...lineaBanda("central").map((p) => distanciaKm(p, BURGOS)),
    );
    expect(distanciaMinima).toBeLessThan(60);
  });

  test("Oviedo está dentro de la Franja de totalidad", () => {
    const [lon, lat] = OVIEDO;
    expect(lat).toBeGreaterThan(latitudEn("sur", lon));
    expect(lat).toBeLessThan(latitudEn("norte", lon));
  });

  test("Sevilla está fuera de la Franja de totalidad", () => {
    const [lon, lat] = SEVILLA;
    expect(lat).toBeLessThan(latitudEn("sur", lon));
  });

  test("la banda cubre de Galicia a Baleares con margen (lon −11 a 4.5)", () => {
    const coords = lineaBanda("central");
    expect(coords[0][0]).toBeLessThanOrEqual(-11);
    expect(coords[coords.length - 1][0]).toBeGreaterThanOrEqual(4.5);
  });
});

describe("isolineas.geojson", () => {
  test("la isolínea del 99% contiene a Madrid", () => {
    const nivel99 = isolineas.features.find((f) => f.properties.nivel === 0.99);
    expect(nivel99).toBeDefined();
    expect(puntoEnMultiPolygon(MADRID, nivel99!.geometry)).toBe(true);
  });

  test("la isolínea del 99% no contiene a Sevilla", () => {
    const nivel99 = isolineas.features.find((f) => f.properties.nivel === 0.99);
    expect(puntoEnMultiPolygon(SEVILLA, nivel99!.geometry)).toBe(false);
  });

  test("las regiones están anidadas: 99% ⊂ 95% ⊂ 90% ⊂ 80% sobre Madrid", () => {
    for (const f of isolineas.features) {
      // Madrid supera el 99%, así que debe caer dentro de todos los niveles.
      expect(puntoEnMultiPolygon(MADRID, f.geometry)).toBe(true);
    }
  });
});

describe("umbra.json", () => {
  test("la umbra avanza de oeste a este durante la ventana", () => {
    // En el último instante la umbra roza el terminador (puesta de sol) y
    // su centro deja de estar bien definido como avance hacia el este,
    // así que se excluye de la comprobación de monotonía.
    const lons = umbra.instantes.slice(0, -1).map((i) => i.centro.lon);
    for (let i = 1; i < lons.length; i++) {
      expect(lons[i]).toBeGreaterThan(lons[i - 1]);
    }
  });

  test("a media travesía el centro de la umbra cae dentro de la Franja", () => {
    const medio = umbra.instantes[Math.floor(umbra.instantes.length / 2)];
    const { lat, lon } = medio.centro;
    expect(lat).toBeGreaterThan(latitudEn("sur", lon));
    expect(lat).toBeLessThan(latitudEn("norte", lon));
  });
});
