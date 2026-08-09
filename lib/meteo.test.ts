import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clasificarVeredicto,
  claveZona,
  fetchHorasOpenMeteo,
  fetchPrevisionEclipse,
  urlApiMeteo,
  type NubosidadHora,
} from "./meteo";

/** Previsión de la ventana del eclipse con la misma nubosidad cada hora. */
function ventana(nubosidad: Omit<NubosidadHora, "hora">): NubosidadHora[] {
  return ["19:00", "20:00", "21:00", "22:00"].map((hora) => ({
    hora,
    ...nubosidad,
  }));
}

describe("clasificarVeredicto", () => {
  test("total < 25 % → despejado", () => {
    const veredicto = clasificarVeredicto(
      ventana({ total: 10, baja: 5, media: 5, alta: 0 }),
    );
    expect(veredicto.clave).toBe("despejado");
    expect(veredicto.texto).toBe("☀️ Despejado — ¡a disfrutarlo!");
  });

  test("25–60 % → nubes y claros", () => {
    const veredicto = clasificarVeredicto(
      ventana({ total: 45, baja: 30, media: 15, alta: 10 }),
    );
    expect(veredicto.clave).toBe("nubes-y-claros");
    expect(veredicto.texto).toBe("🌤️ Nubes y claros — hay opciones");
  });

  test("> 60 % con la capa alta dominante → nubes altas", () => {
    const veredicto = clasificarVeredicto(
      ventana({ total: 85, baja: 10, media: 15, alta: 80 }),
    );
    expect(veredicto.clave).toBe("nubes-altas");
    expect(veredicto.texto).toBe("🌥️ Nubes altas — el eclipse puede intuirse");
  });

  test("> 60 % con nubes bajas/medias dominantes → cubierto", () => {
    const veredicto = clasificarVeredicto(
      ventana({ total: 90, baja: 80, media: 40, alta: 10 }),
    );
    expect(veredicto.clave).toBe("cubierto");
    expect(veredicto.texto).toBe(
      "☁️ Cubierto — busca otro sitio (mira la Vista Mapa)",
    );
  });

  test("promedia las horas de la ventana", () => {
    // 10, 20, 20, 30 → media 20 % → despejado aunque una hora llegue al 30 %
    const horas: NubosidadHora[] = [
      { hora: "19:00", total: 10, baja: 10, media: 0, alta: 0 },
      { hora: "20:00", total: 20, baja: 20, media: 0, alta: 0 },
      { hora: "21:00", total: 20, baja: 20, media: 0, alta: 0 },
      { hora: "22:00", total: 30, baja: 30, media: 0, alta: 0 },
    ];
    expect(clasificarVeredicto(horas).clave).toBe("despejado");
  });
});

describe("claveZona", () => {
  test("redondea al nodo más cercano de la rejilla de 0,25°", () => {
    expect(claveZona(40.4168, -3.7038)).toEqual({ lat: 40.5, lon: -3.75 });
    expect(claveZona(43.4832, -8.2369)).toEqual({ lat: 43.5, lon: -8.25 });
  });

  test("dos municipios vecinos comparten clave de zona", () => {
    // Ferrol y Narón (~3 km): misma zona → misma URL → una sola llamada
    // upstream para ambos.
    expect(claveZona(43.4832, -8.2369)).toEqual(claveZona(43.5027, -8.1926));
  });

  test("los nodos exactos de la rejilla no cambian", () => {
    expect(claveZona(40.25, -3.5)).toEqual({ lat: 40.25, lon: -3.5 });
    expect(claveZona(0, 0)).toEqual({ lat: 0, lon: 0 });
  });

  test("no produce -0 junto al ecuador ni al meridiano", () => {
    const zona = claveZona(-0.1, -0.1);
    expect(Object.is(zona.lat, -0)).toBe(false);
    expect(Object.is(zona.lon, -0)).toBe(false);
  });
});

describe("urlApiMeteo", () => {
  test("la URL del proxy lleva la clave de zona, no el punto exacto", () => {
    // Todos los usuarios de la zona de Madrid piden la MISMA URL: la
    // caché del edge (y la del SW) sirve una única copia para todos.
    expect(urlApiMeteo(40.4168, -3.7038)).toBe("/api/meteo?lat=40.50&lon=-3.75");
  });
});

// ---------------------------------------------------------------------------
// Cliente: fetchPrevisionEclipse pide el proxy /api/meteo (fetch mockeado)
// ---------------------------------------------------------------------------

describe("fetchPrevisionEclipse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Cuerpo de una respuesta correcta del proxy /api/meteo. */
  function respuestaProxy(horas: NubosidadHora[]) {
    return {
      zona: { lat: 40.5, lon: -3.75 },
      generado: "2026-08-09T12:00:00.000Z",
      horas,
    };
  }

  test("pide el proxy con la clave de zona y clasifica el veredicto", async () => {
    const horas = ventana({ total: 10, baja: 5, media: 5, alta: 0 });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(respuestaProxy(horas)), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const prevision = await fetchPrevisionEclipse(40.4168, -3.7038);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/meteo?lat=40.50&lon=-3.75");
    expect(prevision.horas).toEqual(horas);
    expect(prevision.veredicto.clave).toBe("despejado");
  });

  test("lanza error si el proxy responde con fallo HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 502 })),
    );
    await expect(fetchPrevisionEclipse(40, -3)).rejects.toThrow("502");
  });

  test("lanza error si el proxy no trae horas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ generado: "2026-08-09T12:00:00.000Z", horas: [] }),
          { status: 200 },
        ),
      ),
    );
    await expect(fetchPrevisionEclipse(40, -3)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Servidor: fetchHorasOpenMeteo parsea el formato upstream (fetch mockeado)
// ---------------------------------------------------------------------------

describe("fetchHorasOpenMeteo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Respuesta de Open-Meteo con las 24 horas del 12-08-2026. */
  function respuestaOpenMeteo(porHora: {
    [hora: string]: { total: number; baja: number; media: number; alta: number };
  }) {
    const time: string[] = [];
    const cloud_cover: number[] = [];
    const cloud_cover_low: number[] = [];
    const cloud_cover_mid: number[] = [];
    const cloud_cover_high: number[] = [];
    for (let h = 0; h < 24; h++) {
      const hora = `${String(h).padStart(2, "0")}:00`;
      const valores = porHora[hora] ?? { total: 0, baja: 0, media: 0, alta: 0 };
      time.push(`2026-08-12T${hora}`);
      cloud_cover.push(valores.total);
      cloud_cover_low.push(valores.baja);
      cloud_cover_mid.push(valores.media);
      cloud_cover_high.push(valores.alta);
    }
    return {
      hourly: { time, cloud_cover, cloud_cover_low, cloud_cover_mid, cloud_cover_high },
    };
  }

  test("extrae la ventana 19:00–22:00 del formato Open-Meteo", async () => {
    const cuerpo = respuestaOpenMeteo({
      "19:00": { total: 10, baja: 5, media: 5, alta: 0 },
      "20:00": { total: 15, baja: 10, media: 5, alta: 0 },
      "21:00": { total: 20, baja: 10, media: 5, alta: 5 },
      "22:00": { total: 25, baja: 10, media: 10, alta: 5 },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(cuerpo), { status: 200 }),
      ),
    );

    const horas = await fetchHorasOpenMeteo(40.4168, -3.7038);

    expect(horas.map((h) => h.hora)).toEqual([
      "19:00",
      "20:00",
      "21:00",
      "22:00",
    ]);
    expect(horas[1]).toEqual({
      hora: "20:00",
      total: 15,
      baja: 10,
      media: 5,
      alta: 0,
    });
  });

  test("propaga las opciones de fetch (revalidate de la Data Cache)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(respuestaOpenMeteo({})), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchHorasOpenMeteo(40, -3, { next: { revalidate: 1800 } });

    expect(fetchMock.mock.calls[0]![1]).toEqual({ next: { revalidate: 1800 } });
  });

  test("lanza error si la API responde con fallo HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 })),
    );
    await expect(fetchHorasOpenMeteo(40, -3)).rejects.toThrow("500");
  });

  test("lanza error con el aviso de límite (200 + error:true)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: true, reason: "Hourly API request limit exceeded" }),
          { status: 200 },
        ),
      ),
    );
    await expect(fetchHorasOpenMeteo(40, -3)).rejects.toThrow(
      "Hourly API request limit exceeded",
    );
  });

  test("lanza error si faltan los datos horarios", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ hourly: {} }), { status: 200 }),
      ),
    );
    await expect(fetchHorasOpenMeteo(40, -3)).rejects.toThrow();
  });
});
