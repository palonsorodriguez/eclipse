/**
 * Tests de lib/mapa: la lógica pura de la Vista Mapa — interpolación de la
 * umbra, elipse → polígono GeoJSON, polígono de la banda, selección de
 * isolíneas, contorno en vivo y municipio más cercano.
 *
 * Los datos reales de `public/geodata/` se leen de disco como en
 * `lib/geodata.test.ts`; la interpolación de la umbra se prueba además con
 * instantes sintéticos para fijar los casos límite.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MultiPolygon } from "geojson";
import { describe, expect, test } from "vitest";
import {
  distanciaKm,
  puntoEnMultiPolygon,
  type BandaTotalidadGeoJSON,
  type InstanteUmbra,
  type IsolineasGeoJSON,
  type UmbraJSON,
} from "./geodata";
import {
  contornoNivel,
  elipseAPoligono,
  formatoHoraCEST,
  interpolarUmbra,
  maxOscurecimientoEn,
  municipioMasCercano,
  poligonoBanda,
  puntoEtiquetaIsolinea,
  seleccionarIsolinea,
  trayectoriaUmbra,
  type RejillaOscurecimiento,
} from "./mapa";
import { municipios } from "./municipios";

const DIR_GEODATA = join(process.cwd(), "public", "geodata");

function leerFichero<T>(nombre: string): T {
  return JSON.parse(readFileSync(join(DIR_GEODATA, nombre), "utf8")) as T;
}

const banda = leerFichero<BandaTotalidadGeoJSON>("banda-totalidad.geojson");
const isolineas = leerFichero<IsolineasGeoJSON>("isolineas.geojson");
const umbra = leerFichero<UmbraJSON>("umbra.json");

/** Dos instantes sintéticos separados 30 s, con movimiento en todo. */
const INSTANTES: InstanteUmbra[] = [
  {
    t: "2026-08-12T18:20:00.000Z",
    centro: { lat: 48, lon: -13 },
    semiejeMayorKm: 200,
    semiejeMenorKm: 60,
    orientacionGrados: 90,
  },
  {
    t: "2026-08-12T18:20:30.000Z",
    centro: { lat: 47, lon: -12 },
    semiejeMayorKm: 220,
    semiejeMenorKm: 64,
    orientacionGrados: 110,
  },
];

describe("interpolarUmbra", () => {
  test("en el punto medio interpola centro, semiejes y orientación", () => {
    const media = interpolarUmbra(INSTANTES, new Date("2026-08-12T18:20:15Z"));
    expect(media).not.toBeNull();
    expect(media!.centro.lat).toBeCloseTo(47.5, 6);
    expect(media!.centro.lon).toBeCloseTo(-12.5, 6);
    expect(media!.semiejeMayorKm).toBeCloseTo(210, 6);
    expect(media!.semiejeMenorKm).toBeCloseTo(62, 6);
    expect(media!.orientacionGrados).toBeCloseTo(100, 6);
  });

  test("en un instante exacto devuelve ese instante", () => {
    const exacto = interpolarUmbra(INSTANTES, new Date(INSTANTES[1].t));
    expect(exacto!.centro).toEqual(INSTANTES[1].centro);
    expect(exacto!.orientacionGrados).toBeCloseTo(110, 6);
  });

  test("fuera de la ventana con umbra devuelve null", () => {
    expect(
      interpolarUmbra(INSTANTES, new Date("2026-08-12T18:19:59Z")),
    ).toBeNull();
    expect(
      interpolarUmbra(INSTANTES, new Date("2026-08-12T18:20:31Z")),
    ).toBeNull();
    expect(interpolarUmbra([], new Date("2026-08-12T18:20:00Z"))).toBeNull();
  });

  test("la orientación cruza el 0 por el camino corto (170° → 10°)", () => {
    const giro: InstanteUmbra[] = [
      { ...INSTANTES[0], orientacionGrados: 170 },
      { ...INSTANTES[1], orientacionGrados: 10 },
    ];
    const media = interpolarUmbra(giro, new Date("2026-08-12T18:20:15Z"));
    expect(media!.orientacionGrados).toBeCloseTo(0, 6);
  });

  test("con los datos reales, la umbra existe a las 18:27 UT y no a las 18:00", () => {
    const dentro = interpolarUmbra(
      umbra.instantes,
      new Date("2026-08-12T18:27:15Z"),
    );
    expect(dentro).not.toBeNull();
    // A esa hora la sombra ya está sobre la península (lon > −10°).
    expect(dentro!.centro.lon).toBeGreaterThan(-10);
    expect(
      interpolarUmbra(umbra.instantes, new Date("2026-08-12T18:00:00Z")),
    ).toBeNull();
  });
});

describe("elipseAPoligono", () => {
  const elipse: InstanteUmbra = {
    t: "2026-08-12T18:25:00.000Z",
    centro: { lat: 43, lon: -6 },
    semiejeMayorKm: 250,
    semiejeMenorKm: 60,
    orientacionGrados: 100,
  };

  test("produce un anillo cerrado que contiene el centro", () => {
    const poligono = elipseAPoligono(elipse);
    const anillo = poligono.coordinates[0];
    expect(anillo[0]).toEqual(anillo[anillo.length - 1]);
    expect(
      puntoEnMultiPolygon(
        [elipse.centro.lon, elipse.centro.lat],
        { type: "MultiPolygon", coordinates: [poligono.coordinates] },
      ),
    ).toBe(true);
  });

  test("los vértices distan del centro entre el semieje menor y el mayor", () => {
    const anillo = elipseAPoligono(elipse).coordinates[0];
    const centro = [elipse.centro.lon, elipse.centro.lat];
    const distancias = anillo.map((p) => distanciaKm(centro, p));
    // Tolerancia del 3 %: aproximación plana local + esfera media.
    expect(Math.max(...distancias)).toBeCloseTo(elipse.semiejeMayorKm, -1);
    expect(Math.min(...distancias)).toBeCloseTo(elipse.semiejeMenorKm, -1);
    for (const d of distancias) {
      expect(d).toBeGreaterThan(elipse.semiejeMenorKm * 0.97);
      expect(d).toBeLessThan(elipse.semiejeMayorKm * 1.03);
    }
  });

  test("la escala amplía la elipse (halo del borde difuso)", () => {
    const halo = elipseAPoligono(elipse, 64, 1.2).coordinates[0];
    const centro = [elipse.centro.lon, elipse.centro.lat];
    const maxHalo = Math.max(...halo.map((p) => distanciaKm(centro, p)));
    expect(maxHalo).toBeGreaterThan(elipse.semiejeMayorKm * 1.15);
  });
});

describe("poligonoBanda", () => {
  const poligono = poligonoBanda(banda);
  const multi: MultiPolygon = {
    type: "MultiPolygon",
    coordinates: [poligono.coordinates],
  };

  test("es un anillo cerrado", () => {
    const anillo = poligono.coordinates[0];
    expect(anillo[0]).toEqual(anillo[anillo.length - 1]);
  });

  test("Oviedo queda dentro de la Franja y Sevilla fuera", () => {
    expect(puntoEnMultiPolygon([-5.8593, 43.3614], multi)).toBe(true);
    expect(puntoEnMultiPolygon([-5.9845, 37.3891], multi)).toBe(false);
  });
});

describe("seleccionarIsolinea", () => {
  test("encuentra la isolínea de un nivel existente", () => {
    const nivel95 = seleccionarIsolinea(isolineas, 0.95);
    expect(nivel95?.properties.nivel).toBe(0.95);
    expect(nivel95?.geometry.type).toBe("MultiPolygon");
  });

  test("devuelve undefined para un nivel sin isolínea precalculada", () => {
    expect(seleccionarIsolinea(isolineas, 0.85)).toBeUndefined();
  });

  test("el punto de etiqueta cae sobre el contorno de la isolínea", () => {
    const nivel80 = seleccionarIsolinea(isolineas, 0.8)!;
    const punto = puntoEtiquetaIsolinea(nivel80.geometry)!;
    expect(punto).toBeDefined();
    const enContorno = nivel80.geometry.coordinates.some((poligono) =>
      poligono[0].some((p) => p[0] === punto[0] && p[1] === punto[1]),
    );
    expect(enContorno).toBe(true);
  });
});

describe("isolínea en vivo", () => {
  test("maxOscurecimientoEn coincide con las referencias de cordura", () => {
    // Oviedo: dentro de la Franja → exactamente 1.
    expect(maxOscurecimientoEn(43.3614, -5.8593)).toBe(1);
    // Madrid: fuera de la Franja pero con Oscurecimiento > 99 %.
    const madrid = maxOscurecimientoEn(40.4168, -3.7038);
    expect(madrid).toBeGreaterThan(0.99);
    expect(madrid).toBeLessThan(1);
    // Sevilla: en torno al 94–95 %.
    const sevilla = maxOscurecimientoEn(37.3891, -5.9845);
    expect(sevilla).toBeGreaterThan(0.9);
    expect(sevilla).toBeLessThan(0.96);
  });

  test("contornoNivel separa el interior del exterior de la región", () => {
    // Rejilla sintética 11×11 radial: valor 1 en el centro que decae con
    // la distancia — la región ≥ 0,9 es un disco en torno al centro.
    const nx = 11;
    const ny = 11;
    const valores = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const d = Math.hypot(i - 5, j - 5);
        valores[j * nx + i] = Math.max(0, 1 - d / 8);
      }
    }
    const rejilla: RejillaOscurecimiento = {
      lonMin: -10,
      latMin: 35,
      paso: 1,
      nx,
      ny,
      valores,
    };
    const contorno = contornoNivel(rejilla, 0.9);
    expect(contorno.coordinates.length).toBeGreaterThan(0);
    // Centro de la rejilla: (lon −5, lat 40) → dentro; esquina → fuera.
    expect(puntoEnMultiPolygon([-5, 40], contorno)).toBe(true);
    expect(puntoEnMultiPolygon([-9.5, 35.5], contorno)).toBe(false);
  });

  test("un nivel inalcanzable produce una geometría vacía", () => {
    const valores = new Float64Array(4).fill(0.5);
    const rejilla: RejillaOscurecimiento = {
      lonMin: 0,
      latMin: 0,
      paso: 1,
      nx: 2,
      ny: 2,
      valores,
    };
    expect(contornoNivel(rejilla, 0.9).coordinates).toEqual([]);
  });
});

describe("municipioMasCercano", () => {
  test("un clic junto a la Puerta del Sol devuelve Madrid", () => {
    const municipio = municipioMasCercano(40.4169, -3.7035, municipios);
    expect(municipio.nombre).toBe("Madrid");
  });

  test("un clic en el mar devuelve un municipio costero cercano", () => {
    // Punto en el Cantábrico frente a Gijón.
    const municipio = municipioMasCercano(43.65, -5.66, municipios);
    expect(distanciaKm([-5.66, 43.65], [municipio.lon, municipio.lat]))
      .toBeLessThan(50);
  });
});

describe("trayectoriaUmbra y formato", () => {
  test("la trayectoria une los centros en orden temporal", () => {
    const linea = trayectoriaUmbra(umbra.instantes);
    expect(linea.coordinates.length).toBe(umbra.instantes.length);
    // La sombra avanza de oeste a este.
    const lons = linea.coordinates.map((p) => p[0]);
    expect(lons[0]).toBeLessThan(lons[lons.length - 1]);
  });

  test("formatoHoraCEST convierte UT a hora peninsular", () => {
    expect(formatoHoraCEST(Date.UTC(2026, 7, 12, 18, 29, 0))).toBe("20:29");
    expect(formatoHoraCEST(Date.UTC(2026, 7, 12, 17, 15, 30), true)).toBe(
      "19:15:30",
    );
  });
});
