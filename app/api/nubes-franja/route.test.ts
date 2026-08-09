/**
 * Tests del proxy /api/nubes-franja (issue #69): la rejilla de 55 puntos
 * vive en el servidor (derivada de public/geodata/banda-totalidad.geojson,
 * la real del repo), toda la capa sale de UNA llamada upstream, y la
 * respuesta lleva sello de generación y cabeceras de caché del edge.
 * Fetch upstream mockeado en el límite del sistema.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

/** Bloque horario de Open-Meteo con `nubosidad` constante todo el día. */
function bloqueHorario(nubosidad: number) {
  const time: string[] = [];
  const cloud_cover: number[] = [];
  for (let h = 0; h < 24; h++) {
    time.push(`2026-08-12T${String(h).padStart(2, "0")}:00`);
    cloud_cover.push(nubosidad);
  }
  return { time, cloud_cover };
}

/**
 * Mock de fetch que responde a cada petición con tantas previsiones como
 * coordenadas pida su URL (forma real de Open-Meteo multipunto).
 */
function mockOpenMeteo(nubosidad: number) {
  return vi.fn().mockImplementation((url: string) => {
    const latitudes = new URL(url).searchParams.get("latitude") ?? "";
    const n = latitudes === "" ? 0 : latitudes.split(",").length;
    const cuerpo = Array.from({ length: n }, () => ({
      hourly: bloqueHorario(nubosidad),
    }));
    return Promise.resolve(
      new Response(JSON.stringify(cuerpo), { status: 200 }),
    );
  });
}

describe("GET /api/nubes-franja", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("200 con la rejilla de 55 puntos en una sola llamada upstream", async () => {
    const fetchMock = mockOpenMeteo(30);
    vi.stubGlobal("fetch", fetchMock);

    const antes = Date.now();
    const respuesta = await GET();

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Cache-Control")).toBe(
      "public, s-maxage=1800, stale-while-revalidate=3600",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // El fetch upstream entra en la Data Cache: 30 min EN TOTAL.
    expect(fetchMock.mock.calls[0]![1]).toEqual({ next: { revalidate: 1800 } });

    const cuerpo = (await respuesta.json()) as {
      generado: string;
      puntos: Array<{ lat: number; lon: number; nubosidadMedia: number }>;
    };
    expect(cuerpo.puntos).toHaveLength(55);
    for (const punto of cuerpo.puntos) {
      expect(Number.isFinite(punto.lat)).toBe(true);
      expect(Number.isFinite(punto.lon)).toBe(true);
      expect(punto.nubosidadMedia).toBe(30);
    }
    // El sello de generación es un instante ISO reciente (frescura depurable).
    const generado = new Date(cuerpo.generado).getTime();
    expect(generado).toBeGreaterThanOrEqual(antes - 1000);
    expect(generado).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("502 sin caché si Open-Meteo falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 })),
    );

    const respuesta = await GET();

    expect(respuesta.status).toBe(502);
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
  });
});
