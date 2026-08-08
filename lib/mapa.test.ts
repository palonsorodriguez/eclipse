/**
 * Tests de lib/mapa: la lógica pura de la Vista Mapa — interpolación de la
 * umbra, contorno real → polígono GeoJSON, polígono de la banda, selección
 * de isolíneas, contorno en vivo y municipio más cercano.
 *
 * Los datos reales de `public/geodata/` se leen de disco como en
 * `lib/geodata.test.ts`; la interpolación de la umbra se prueba además con
 * instantes sintéticos para fijar los casos límite.
 *
 * Nota (ticket #31): los tests de `interpolarOrientacion`, `elipseAPoligono`
 * y `puntoEnElipse` se eliminaron con el modelo de elipse: el contorno ya
 * son los radios medidos por rumbo y no quedan orientación ni semiejes que
 * interpolar. Los sustituyen los tests de `contornoUmbra` y `puntoEnUmbra`,
 * que además fijan lo que la elipse no podía garantizar (la lágrima
 * asimétrica, Oviedo dentro en su Máximo, Sevilla siempre fuera).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MultiPolygon } from "geojson";
import { describe, expect, test } from "vitest";
import {
  destino,
  distanciaKm,
  N_RUMBOS_UMBRA,
  puntoEnMultiPolygon,
  rumboUmbra,
  type BandaTotalidadGeoJSON,
  type InstanteUmbra,
  type IsolineasGeoJSON,
  type UmbraJSON,
} from "./geodata";
import {
  contornoNivel,
  contornoUmbra,
  formatoHoraCEST,
  interpolarUmbra,
  llegadaUmbra,
  maxOscurecimientoEn,
  municipioMasCercano,
  poligonoBanda,
  puntoEnUmbra,
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

/** Puntos de referencia, en orden GeoJSON [lon, lat]. */
const OVIEDO: [number, number] = [-5.8593, 43.3614];
const SEVILLA: [number, number] = [-5.9845, 37.3891];

/**
 * Radios sintéticos dependientes del rumbo (`base + i·paso`): si la
 * interpolación mezclara índices, el error sería visible.
 */
function radiosLineales(base: number, paso: number): number[] {
  return Array.from({ length: N_RUMBOS_UMBRA }, (_, i) => base + i * paso);
}

/** Dos instantes sintéticos separados 30 s, con movimiento en todo. */
const INSTANTES: InstanteUmbra[] = [
  {
    t: "2026-08-12T18:20:00.000Z",
    centro: { lat: 48, lon: -13 },
    radiosKm: radiosLineales(100, 1),
  },
  {
    t: "2026-08-12T18:20:30.000Z",
    centro: { lat: 47, lon: -12 },
    radiosKm: radiosLineales(200, 3),
  },
];

describe("interpolarUmbra", () => {
  test("en el punto medio interpola el centro y cada radio por su índice", () => {
    const media = interpolarUmbra(INSTANTES, new Date("2026-08-12T18:20:15Z"));
    expect(media).not.toBeNull();
    expect(media!.centro.lat).toBeCloseTo(47.5, 6);
    expect(media!.centro.lon).toBeCloseTo(-12.5, 6);
    expect(media!.radiosKm).toHaveLength(N_RUMBOS_UMBRA);
    media!.radiosKm.forEach((radio, i) => {
      // lerp(100 + i, 200 + 3i, 0.5) = 150 + 2i.
      expect(radio).toBeCloseTo(150 + 2 * i, 6);
    });
  });

  test("en un instante exacto devuelve ese instante", () => {
    const exacto = interpolarUmbra(INSTANTES, new Date(INSTANTES[1].t));
    expect(exacto!.centro).toEqual(INSTANTES[1].centro);
    exacto!.radiosKm.forEach((radio, i) => {
      expect(radio).toBeCloseTo(INSTANTES[1].radiosKm[i], 6);
    });
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

  test("con los datos reales, la umbra existe a las 18:27 UT y no a las 17:40", () => {
    const dentro = interpolarUmbra(
      umbra.instantes,
      new Date("2026-08-12T18:27:15Z"),
    );
    expect(dentro).not.toBeNull();
    // A esa hora la sombra ya está sobre la península (lon > −10°).
    expect(dentro!.centro.lon).toBeGreaterThan(-10);
    // A las 18:00 la serie extendida ya trae la sombra en el Atlántico…
    const atlantico = interpolarUmbra(
      umbra.instantes,
      new Date("2026-08-12T18:00:00Z"),
    );
    expect(atlantico).not.toBeNull();
    expect(atlantico!.centro.lon).toBeLessThan(-20);
    // …pero antes de las 17:55 aún no hay datos.
    expect(
      interpolarUmbra(umbra.instantes, new Date("2026-08-12T17:40:00Z")),
    ).toBeNull();
  });

  test("los radios interpolan de forma continua entre dos keyframes reales", () => {
    // Dos instantes consecutivos con la sombra sobre la península.
    const iA = umbra.instantes.findIndex((i) => i.centro.lon > -6);
    expect(iA).toBeGreaterThan(0);
    const a = umbra.instantes[iA];
    const b = umbra.instantes[iA + 1];
    const tA = new Date(a.t).getTime();
    const tB = new Date(b.t).getTime();

    // Muestras cada 5 s: cada radio queda entre sus dos extremos y avanza
    // en pasos proporcionales (1/6 del salto total), sin discontinuidades.
    const N_MUESTRAS = 6;
    let previo = a.radiosKm;
    for (let m = 1; m <= N_MUESTRAS; m++) {
      const t = tA + (m / N_MUESTRAS) * (tB - tA);
      const u = interpolarUmbra(umbra.instantes, new Date(t));
      expect(u).not.toBeNull();
      u!.radiosKm.forEach((radio, k) => {
        const lo = Math.min(a.radiosKm[k], b.radiosKm[k]);
        const hi = Math.max(a.radiosKm[k], b.radiosKm[k]);
        expect(radio).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(radio).toBeLessThanOrEqual(hi + 1e-9);
        const saltoMaximo =
          Math.abs(b.radiosKm[k] - a.radiosKm[k]) / N_MUESTRAS + 1e-6;
        expect(Math.abs(radio - previo[k])).toBeLessThanOrEqual(saltoMaximo);
      });
      previo = u!.radiosKm;
    }
    // La última muestra coincide con el keyframe de llegada.
    previo.forEach((radio, k) => {
      expect(radio).toBeCloseTo(b.radiosKm[k], 6);
    });
  });
});

describe("contornoUmbra", () => {
  const instante: InstanteUmbra = {
    t: "2026-08-12T18:25:00.000Z",
    centro: { lat: 43, lon: -6 },
    radiosKm: radiosLineales(60, 5),
  };

  test("produce un anillo cerrado de un vértice por rumbo que contiene el centro", () => {
    const poligono = contornoUmbra(instante);
    const anillo = poligono.coordinates[0];
    expect(anillo).toHaveLength(N_RUMBOS_UMBRA + 1);
    expect(anillo[0]).toEqual(anillo[anillo.length - 1]);
    expect(
      puntoEnMultiPolygon(
        [instante.centro.lon, instante.centro.lat],
        { type: "MultiPolygon", coordinates: [poligono.coordinates] },
      ),
    ).toBe(true);
  });

  test("cada vértice dista del centro exactamente su radio", () => {
    const anillo = contornoUmbra(instante).coordinates[0];
    const centro = [instante.centro.lon, instante.centro.lat];
    for (let i = 0; i < N_RUMBOS_UMBRA; i++) {
      // `destino` y `distanciaKm` son inversos sobre la misma esfera
      // media: la coincidencia es exacta salvo redondeo flotante.
      expect(Math.abs(distanciaKm(centro, anillo[i]) - instante.radiosKm[i]))
        .toBeLessThan(1e-6);
    }
  });

  test("la escala amplía el contorno (halo del borde difuso)", () => {
    const centro = [instante.centro.lon, instante.centro.lat];
    const halo = contornoUmbra(instante, 1.18).coordinates[0];
    for (let i = 0; i < N_RUMBOS_UMBRA; i++) {
      expect(distanciaKm(centro, halo[i]))
        .toBeCloseTo(instante.radiosKm[i] * 1.18, 6);
    }
  });

  test("representa la lágrima asimétrica que la elipse no podía", () => {
    // Punta de 500 km solo hacia el este (rumbos 82,5°–97,5°, índices
    // 11–13): el contorno debe contener un punto a 400 km al este pero
    // no su simétrico al oeste — imposible con una elipse centrada.
    const radios = Array<number>(N_RUMBOS_UMBRA).fill(60);
    radios[11] = 500;
    radios[12] = 500;
    radios[13] = 500;
    const lagrima: InstanteUmbra = { ...instante, radiosKm: radios };
    const este = destino(43, -6, 90, 400);
    const oeste = destino(43, -6, 270, 400);
    expect(puntoEnUmbra(lagrima, [este.lon, este.lat])).toBe(true);
    expect(puntoEnUmbra(lagrima, [oeste.lon, oeste.lat])).toBe(false);
  });
});

describe("puntoEnUmbra y llegadaUmbra", () => {
  /** Contorno casi circular de ~80 km de radio. */
  const instante: InstanteUmbra = {
    t: "2026-08-12T18:25:00.000Z",
    centro: { lat: 43, lon: -6 },
    radiosKm: Array<number>(N_RUMBOS_UMBRA).fill(80),
  };

  test("el centro está dentro y los puntos lejanos fuera", () => {
    expect(puntoEnUmbra(instante, [-6, 43])).toBe(true);
    expect(puntoEnUmbra(instante, [0, 43])).toBe(false);
    expect(puntoEnUmbra(instante, [-6, 45])).toBe(false);
  });

  test("coincide con el polígono generado por contornoUmbra", () => {
    const irregular: InstanteUmbra = {
      ...instante,
      radiosKm: radiosLineales(50, 4),
    };
    const multi: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [contornoUmbra(irregular).coordinates],
    };
    // Rejilla de sondas alrededor del centro: ambas pruebas de
    // pertenencia deben coincidir salvo justo en el borde.
    for (let dLat = -3; dLat <= 3; dLat += 0.5) {
      for (let dLon = -3; dLon <= 3; dLon += 0.5) {
        const p: [number, number] = [-6 + dLon, 43 + dLat];
        expect(puntoEnUmbra(irregular, p)).toBe(puntoEnMultiPolygon(p, multi));
      }
    }
  });

  test("llegadaUmbra devuelve el primer instante en que el contorno toca el punto", () => {
    // Serie sintética: el centro avanza hacia el este 1° por instante,
    // con un contorno circular de 100 km.
    const serie: InstanteUmbra[] = [0, 1, 2, 3].map((k) => ({
      t: `2026-08-12T18:2${k}:00.000Z`,
      centro: { lat: 43, lon: -8 + k },
      radiosKm: Array<number>(N_RUMBOS_UMBRA).fill(100),
    }));
    // Un punto en lon −5.5 queda a ~41 km del centro del instante k=2
    // (lon −6) y a más de 100 km de los anteriores.
    expect(llegadaUmbra(serie, [-5.5, 43])).toBe(
      Date.UTC(2026, 7, 12, 18, 22, 0),
    );
    // Un punto lejos de la trayectoria nunca se toca.
    expect(llegadaUmbra(serie, [-5.5, 47])).toBeNull();
    expect(llegadaUmbra([], [-5.5, 43])).toBeNull();
  });

  test("con los datos reales, la umbra llega a Oviedo hacia las 20:27 CEST", () => {
    const llegada = llegadaUmbra(umbra.instantes, OVIEDO);
    expect(llegada).not.toBeNull();
    expect(formatoHoraCEST(llegada!)).toMatch(/^20:2[5-8]$/);
  });
});

describe("contorno real de la umbra (datos de umbra.json)", () => {
  test("el polígono interpolado contiene a Oviedo en su Máximo (18:27:51 UT)", () => {
    // El Máximo de Oviedo (20:27:51 CEST) cae entre dos keyframes de la
    // serie: el contorno interpolado debe cubrir la ciudad. La elipse
    // ajustada fallaba por unos km en casos así cerca del borde.
    const enMaximo = interpolarUmbra(
      umbra.instantes,
      new Date("2026-08-12T18:27:51Z"),
    );
    expect(enMaximo).not.toBeNull();
    expect(puntoEnUmbra(enMaximo!, OVIEDO)).toBe(true);
  });

  test("Sevilla, fuera de la Franja, no cae dentro del contorno en ningún instante", () => {
    for (const instante of umbra.instantes) {
      expect(puntoEnUmbra(instante, SEVILLA)).toBe(false);
    }
    expect(llegadaUmbra(umbra.instantes, SEVILLA)).toBeNull();
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
