import { afterEach, describe, expect, test, vi } from "vitest";
import type { BandaTotalidadGeoJSON } from "./geodata";
import { puntoEnMultiPolygon } from "./geodata";
import { poligonoBanda } from "./mapa";
import {
  agruparCoordenadas,
  clasificarColorNube,
  fetchNubesFranja,
  limpiarCacheNubes,
  obtenerNubesFranja,
  puntosMuestreo,
  type Coordenada,
} from "./meteo-mapa";

// ---------------------------------------------------------------------------
// Banda sintética: tres líneas rectas oeste→este, como las reales pero con
// latitudes conocidas (norte 45°, central 44°, sur 43°).
// ---------------------------------------------------------------------------

function bandaSintetica(): BandaTotalidadGeoJSON {
  const linea = (
    limite: "norte" | "central" | "sur",
    lat: number,
  ): BandaTotalidadGeoJSON["features"][number] => ({
    type: "Feature",
    properties: { limite },
    geometry: {
      type: "LineString",
      coordinates: Array.from({ length: 19 }, (_, i) => [-12 + i, lat]),
    },
  });
  return {
    type: "FeatureCollection",
    features: [linea("norte", 45), linea("central", 44), linea("sur", 43)],
  };
}

describe("clasificarColorNube", () => {
  test("nubosidad < 25 % → verde", () => {
    expect(clasificarColorNube(0)).toBe("verde");
    expect(clasificarColorNube(24.9)).toBe("verde");
  });

  test("25–60 % → amarillo", () => {
    expect(clasificarColorNube(25)).toBe("amarillo");
    expect(clasificarColorNube(60)).toBe("amarillo");
  });

  test("> 60 % → gris", () => {
    expect(clasificarColorNube(60.1)).toBe("gris");
    expect(clasificarColorNube(100)).toBe("gris");
  });
});

describe("puntosMuestreo", () => {
  test("genera una rejilla gruesa de 40–60 puntos", () => {
    const puntos = puntosMuestreo(bandaSintetica());
    expect(puntos.length).toBeGreaterThanOrEqual(40);
    expect(puntos.length).toBeLessThanOrEqual(60);
  });

  test("muestrea dentro de la banda y en su margen, no más allá", () => {
    const banda = bandaSintetica();
    const poligono = poligonoBanda(banda);
    const puntos = puntosMuestreo(banda);

    let dentro = 0;
    for (const p of puntos) {
      if (
        puntoEnMultiPolygon([p.lon, p.lat], {
          type: "MultiPolygon",
          coordinates: [poligono.coordinates],
        })
      ) {
        dentro++;
      }
      // Ningún punto se aleja de la banda (43°–45°) más que el margen.
      expect(p.lat).toBeGreaterThanOrEqual(43 - 0.7);
      expect(p.lat).toBeLessThanOrEqual(45 + 0.7);
    }
    // La mayoría de la rejilla cae dentro de la Franja de totalidad
    // (tres de las cinco filas de cada columna).
    expect(dentro).toBeGreaterThanOrEqual(puntos.length / 2);
  });

  test("cubre la franja española de oeste a este, no el Atlántico", () => {
    const puntos = puntosMuestreo(bandaSintetica());
    const lons = puntos.map((p) => p.lon);
    expect(Math.min(...lons)).toBeGreaterThan(-10); // Galicia, no mar abierto
    expect(Math.max(...lons)).toBeGreaterThan(3); // llega a Baleares
    expect(Math.max(...lons)).toBeLessThan(5);
  });
});

describe("agruparCoordenadas", () => {
  test("parte en grupos de como mucho el máximo, conservando el orden", () => {
    const elementos = Array.from({ length: 55 }, (_, i) => i);
    const grupos = agruparCoordenadas(elementos, 25);
    expect(grupos.map((g) => g.length)).toEqual([25, 25, 5]);
    expect(grupos.flat()).toEqual(elementos);
  });

  test("una lista que cabe en el máximo queda en un solo grupo", () => {
    expect(agruparCoordenadas([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  test("lista vacía → sin grupos", () => {
    expect(agruparCoordenadas([], 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Acceso de red: fetch mockeado en el límite del sistema, con respuestas
// con la forma real de Open-Meteo (array de previsiones, una por punto,
// en el mismo orden que la petición).
// ---------------------------------------------------------------------------

/** Bloque horario de Open-Meteo con `nubosidad` en las horas de la ventana. */
function bloqueHorario(nubosidad: number) {
  const time: string[] = [];
  const cloud_cover: number[] = [];
  for (let h = 0; h < 24; h++) {
    time.push(`2026-08-12T${String(h).padStart(2, "0")}:00`);
    cloud_cover.push(nubosidad);
  }
  return { time, cloud_cover };
}

/** Cuenta las coordenadas pedidas en una URL de Open-Meteo. */
function coordenadasEnUrl(url: string): number {
  const latitudes = new URL(url).searchParams.get("latitude") ?? "";
  return latitudes === "" ? 0 : latitudes.split(",").length;
}

/**
 * Mock de fetch que responde a cada petición con tantas previsiones como
 * coordenadas pida su URL, todas con la misma `nubosidad`.
 */
function mockOpenMeteo(nubosidad: number) {
  return vi.fn().mockImplementation((url: string) => {
    const n = coordenadasEnUrl(url);
    const cuerpo = Array.from({ length: n }, () => ({
      hourly: bloqueHorario(nubosidad),
    }));
    return Promise.resolve(
      new Response(JSON.stringify(cuerpo), { status: 200 }),
    );
  });
}

function rejilla(n: number): Coordenada[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: 40 + i * 0.1,
    lon: -8 + i * 0.1,
  }));
}

describe("fetchNubesFranja", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("agrupa la rejilla entera en una sola petición", async () => {
    const fetchMock = mockOpenMeteo(30);
    vi.stubGlobal("fetch", fetchMock);

    const puntos = await fetchNubesFranja(rejilla(55));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(puntos).toHaveLength(55);
  });

  test("más de 100 puntos se reparten en varias peticiones de ≤ 100", async () => {
    const fetchMock = mockOpenMeteo(30);
    vi.stubGlobal("fetch", fetchMock);

    const puntos = await fetchNubesFranja(rejilla(120));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(coordenadasEnUrl(url as string)).toBeLessThanOrEqual(100);
    }
    expect(puntos).toHaveLength(120);
  });

  test("cada punto vuelve con sus coordenadas y la nubosidad media de la ventana", async () => {
    // Nubosidad distinta por hora: 19:00 → 20 %, 20:00 → 40 %, 21:00 → 60 %.
    const horario = bloqueHorario(0);
    horario.cloud_cover[19] = 20;
    horario.cloud_cover[20] = 40;
    horario.cloud_cover[21] = 60;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ hourly: horario }]), { status: 200 }),
      ),
    );

    const puntos = await fetchNubesFranja([{ lat: 43.48, lon: -8.24 }]);

    expect(puntos).toEqual([
      { lat: 43.48, lon: -8.24, nubosidadMedia: 40 },
    ]);
  });

  test("lanza error si la API responde con fallo HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 })),
    );
    await expect(fetchNubesFranja(rejilla(3))).rejects.toThrow("500");
  });

  test("lanza error si faltan las horas de la ventana", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ hourly: {} }]), { status: 200 }),
      ),
    );
    await expect(fetchNubesFranja([{ lat: 40, lon: -3 }])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cliente: obtenerNubesFranja pide el proxy /api/nubes-franja (issue #69)
// ---------------------------------------------------------------------------

/** Cuerpo de una respuesta correcta del proxy /api/nubes-franja. */
function respuestaProxyNubes(n: number, nubosidad: number) {
  return {
    generado: "2026-08-09T12:00:00.000Z",
    puntos: Array.from({ length: n }, (_, i) => ({
      lat: 40 + i * 0.1,
      lon: -8 + i * 0.1,
      nubosidadMedia: nubosidad,
    })),
  };
}

describe("obtenerNubesFranja", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    limpiarCacheNubes();
  });

  test("pide el proxy /api/nubes-franja, cachea 30 min y refresca al caducar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(respuestaProxyNubes(55, 10)), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const primera = await obtenerNubesFranja();
    const segunda = await obtenerNubesFranja();
    expect(fetchMock).toHaveBeenCalledTimes(1); // dentro de la caché
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/nubes-franja");
    expect(primera).toHaveLength(55);
    expect(segunda).toBe(primera);

    vi.setSystemTime(new Date("2026-08-12T10:31:00Z"));
    await obtenerNubesFranja();
    expect(fetchMock).toHaveBeenCalledTimes(2); // caché caducada → red
  });

  test("no cachea los fallos: el siguiente intento vuelve a la red", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 502 }))
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(respuestaProxyNubes(55, 10)), {
            status: 200,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(obtenerNubesFranja()).rejects.toThrow("502");
    const puntos = await obtenerNubesFranja();
    expect(puntos.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("lanza error si el proxy no trae puntos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ generado: "2026-08-09T12:00:00.000Z", puntos: [] }),
          { status: 200 },
        ),
      ),
    );
    await expect(obtenerNubesFranja()).rejects.toThrow();
  });
});
