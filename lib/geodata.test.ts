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
  destino,
  distanciaKm,
  N_RUMBOS_UMBRA,
  puntoEnMultiPolygon,
  rumboUmbra,
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

  test("cargarUmbra devuelve instantes ordenados con contornos plausibles", async () => {
    const u = await cargarUmbra();
    expect(u.instantes.length).toBeGreaterThan(10);
    let tAnterior = -Infinity;
    for (const i of u.instantes) {
      const t = new Date(i.t).getTime();
      expect(t).toBeGreaterThan(tAnterior);
      tAnterior = t;
      // Contorno real: un radio por cada uno de los 48 rumbos fijos.
      expect(i.radiosKm).toHaveLength(N_RUMBOS_UMBRA);
      for (const radio of i.radiosKm) {
        expect(radio).toBeGreaterThan(0);
        // Sin tope artificial, pero nunca más allá de la salvaguarda
        // geométrica (media circunferencia terrestre).
        expect(radio).toBeLessThanOrEqual(Math.PI * 6371);
      }
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
  test("la serie empieza a las 17:55 UT (entrada por el Atlántico)", () => {
    expect(umbra.instantes[0].t).toBe("2026-08-12T17:55:00.000Z");
    // A esa hora la sombra aún está en mitad del Atlántico norte.
    expect(umbra.instantes[0].centro.lon).toBeLessThan(-20);
  });

  // Nota (ticket #31): aquí vivían dos tests del modelo de elipse que se
  // eliminan con él, no se sustituyen: "la orientación de la elipse es
  // suave" (vigilaba el "volantazo" del ajuste PCA — el contorno real no
  // tiene orientación que cuantizar) y el cálculo de la cola vía
  // semieje mayor + orientación (ahora la cola se mide directamente sobre
  // los vértices del contorno, abajo).

  test("la cola del contorno (su punto más occidental) avanza hacia el este sin retroceder", () => {
    // El invariante físico del borde trasero: la punta de la lágrima se
    // estira hacia el terminador (este), pero la cola de la sombra nunca
    // retrocede. Con la elipse esto exigía un ancla artificial; con el
    // contorno real basta mirar el vértice más occidental.
    const lonsCola = umbra.instantes.map((i) =>
      Math.min(
        ...i.radiosKm.map(
          (radio, k) =>
            destino(i.centro.lat, i.centro.lon, rumboUmbra(k), radio).lon,
        ),
      ),
    );
    // Tolerancia de 0,05° (~4 km): ruido de bisección/redondeo.
    for (let i = 1; i < lonsCola.length; i++) {
      expect(lonsCola[i]).toBeGreaterThan(lonsCola[i - 1] - 0.05);
    }
  });

  test("el contorno no está capado: al atardecer algún radio supera los 600 km", () => {
    const maximo = Math.max(...umbra.instantes.flatMap((i) => i.radiosKm));
    expect(maximo).toBeGreaterThan(600);
  });

  test("destino y distanciaKm son inversos sobre la esfera media", () => {
    const p = destino(43, -6, 37, 250);
    expect(distanciaKm([-6, 43], [p.lon, p.lat])).toBeCloseTo(250, 6);
  });

  test("a media travesía el centro de la umbra cae dentro de la Franja", () => {
    // Punto medio de la travesía peninsular (lon −8° a 3°), no de la
    // serie completa, que ahora arranca en mitad del Atlántico.
    const peninsular = umbra.instantes.filter(
      (i) => i.centro.lon > -8 && i.centro.lon < 3,
    );
    expect(peninsular.length).toBeGreaterThan(0);
    const medio = peninsular[Math.floor(peninsular.length / 2)];
    const { lat, lon } = medio.centro;
    expect(lat).toBeGreaterThan(latitudEn("sur", lon));
    expect(lat).toBeLessThan(latitudEn("norte", lon));
  });
});
