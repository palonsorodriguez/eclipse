/**
 * Tests del proxy /api/meteo (issue #69): redondeo interno a la clave de
 * zona, sello de generación, cabeceras de caché y conversión de los
 * fallos upstream (incluido el 200 + error:true de Open-Meteo) en 502
 * sin caché. Fetch upstream mockeado en el límite del sistema.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { GET } from "./route";

function peticion(query: string): Request {
  return new Request(`https://eclipse.example/api/meteo${query}`);
}

/** Respuesta de Open-Meteo con las 24 horas del 12-08-2026 a `nubosidad` %. */
function cuerpoOpenMeteo(nubosidad: number) {
  const time: string[] = [];
  const valores: number[] = [];
  for (let h = 0; h < 24; h++) {
    time.push(`2026-08-12T${String(h).padStart(2, "0")}:00`);
    valores.push(nubosidad);
  }
  return {
    hourly: {
      time,
      cloud_cover: valores,
      cloud_cover_low: valores,
      cloud_cover_mid: valores,
      cloud_cover_high: valores,
    },
  };
}

describe("GET /api/meteo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("400 sin caché con parámetros inválidos", async () => {
    for (const query of ["", "?lat=40", "?lat=abc&lon=-3", "?lat=91&lon=-3", "?lat=40&lon=181"]) {
      const respuesta = await GET(peticion(query));
      expect(respuesta.status).toBe(400);
      expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  test("redondea internamente a la clave de zona antes de llamar a Open-Meteo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cuerpoOpenMeteo(10)), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await GET(peticion("?lat=40.4168&lon=-3.7038"));

    const urlUpstream = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(urlUpstream.hostname).toBe("api.open-meteo.com");
    expect(urlUpstream.searchParams.get("latitude")).toBe("40.5000");
    expect(urlUpstream.searchParams.get("longitude")).toBe("-3.7500");
    // El fetch upstream entra en la Data Cache: 30 min por zona.
    expect(fetchMock.mock.calls[0]![1]).toEqual({ next: { revalidate: 1800 } });
  });

  test("200 con zona, sello de generación, horas y Cache-Control cacheable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(cuerpoOpenMeteo(40)), { status: 200 }),
      ),
    );

    const antes = Date.now();
    const respuesta = await GET(peticion("?lat=43.4832&lon=-8.2369"));

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Cache-Control")).toBe(
      "public, s-maxage=1800, stale-while-revalidate=3600",
    );
    const cuerpo = (await respuesta.json()) as {
      zona: { lat: number; lon: number };
      generado: string;
      horas: unknown[];
    };
    expect(cuerpo.zona).toEqual({ lat: 43.5, lon: -8.25 });
    expect(cuerpo.horas).toHaveLength(4);
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

    const respuesta = await GET(peticion("?lat=40&lon=-3"));

    expect(respuesta.status).toBe(502);
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
  });

  test("502 sin caché con el aviso de límite (200 + error:true)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: true, reason: "Hourly API request limit exceeded" }),
          { status: 200 },
        ),
      ),
    );

    const respuesta = await GET(peticion("?lat=40&lon=-3"));

    expect(respuesta.status).toBe(502);
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
    const cuerpo = (await respuesta.json()) as { error: string };
    expect(cuerpo.error).toContain("limit");
  });
});
