import { afterEach, describe, expect, test, vi } from "vitest";
import {
  acimutsSector,
  agrupar,
  anguloObstruccion,
  evaluarHorizonte,
  fetchElevaciones,
  fetchPerfilHorizonte,
  puntoDestino,
  urlElevacion,
  ESPERA_REINTENTO_MS,
  MAX_COORDS_POR_PETICION,
  MAX_REINTENTOS_429,
  RADIOS_KM,
  type MuestraRadial,
  type PerfilHorizonte,
} from "./horizonte";

describe("anguloObstruccion", () => {
  test("un monte 500 m por encima a 5 km subtiende ~5,7°", () => {
    const { angulo, distanciaKm } = anguloObstruccion(0, [
      { distanciaKm: 5, elevacion: 500 },
    ]);
    expect(angulo).toBeCloseTo(5.7, 1);
    expect(distanciaKm).toBe(5);
  });

  test("elige la muestra dominante (mayor ángulo), no la más alta", () => {
    // 300 m a 2 km (8,5°) domina sobre 1000 m a 30 km (1,8°).
    const muestras: MuestraRadial[] = [
      { distanciaKm: 30, elevacion: 1000 },
      { distanciaKm: 2, elevacion: 300 },
    ];
    const { distanciaKm } = anguloObstruccion(0, muestras);
    expect(distanciaKm).toBe(2);
  });

  test("terreno a la misma cota queda bajo la horizontal por curvatura", () => {
    // A 10 km, la caída por curvatura es d²/(2R) ≈ 7,8 m → ángulo negativo.
    const { angulo } = anguloObstruccion(100, [
      { distanciaKm: 10, elevacion: 100 },
    ]);
    expect(angulo).toBeLessThan(0);
    expect(angulo).toBeGreaterThan(-0.1);
  });

  test("la curvatura hunde un monte lejano: 100 m a 50 km no asoma", () => {
    // Caída por curvatura a 50 km ≈ 196 m > 100 m de desnivel.
    const lejos = anguloObstruccion(0, [{ distanciaKm: 50, elevacion: 100 }]);
    expect(lejos.angulo).toBeLessThan(0);
    // El mismo desnivel a 5 km sí asoma (caída ≈ 2 m).
    const cerca = anguloObstruccion(0, [{ distanciaKm: 5, elevacion: 100 }]);
    expect(cerca.angulo).toBeGreaterThan(1);
  });

  test("resta la elevación del observador", () => {
    // Observador a 500 m con terreno a 500 m: sin desnivel, ángulo ~0.
    const { angulo } = anguloObstruccion(500, [
      { distanciaKm: 1, elevacion: 500 },
    ]);
    expect(Math.abs(angulo)).toBeLessThan(0.01);
  });
});

describe("puntoDestino", () => {
  test("1 km al norte sube ~0,009° de latitud sin cambiar la longitud", () => {
    const destino = puntoDestino({ lat: 40, lon: -3 }, 0, 1);
    expect(destino.lat).toBeCloseTo(40.009, 3);
    expect(destino.lon).toBeCloseTo(-3, 5);
  });

  test("hacia el oeste (270°) baja la longitud sin cambiar la latitud", () => {
    const destino = puntoDestino({ lat: 43, lon: -8 }, 270, 10);
    expect(destino.lon).toBeLessThan(-8.1);
    expect(destino.lat).toBeCloseTo(43, 2);
  });
});

describe("acimutsSector", () => {
  test("cubre C1→C4 ± 20° con paso 2°", () => {
    const acimuts = acimutsSector(285, 295);
    expect(acimuts[0]).toBe(265);
    expect(acimuts[acimuts.length - 1]).toBe(315);
    expect(acimuts).toHaveLength(26);
    expect(acimuts[1]! - acimuts[0]!).toBe(2);
  });

  test("acepta los acimuts en cualquier orden", () => {
    expect(acimutsSector(295, 285)).toEqual(acimutsSector(285, 295));
  });

  test("normaliza a [0, 360) si el sector cruza el norte", () => {
    const acimuts = acimutsSector(350, 10);
    expect(acimuts[0]).toBe(330);
    expect(acimuts).toContain(0);
    expect(acimuts[acimuts.length - 1]).toBe(30);
    for (const a of acimuts) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(360);
    }
  });
});

describe("agrupar", () => {
  test("parte en grupos de como mucho el tamaño pedido, en orden", () => {
    const grupos = agrupar([1, 2, 3, 4, 5], 2);
    expect(grupos).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("una lista que cabe entera va en un único grupo", () => {
    expect(agrupar([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });
});

/**
 * Mockea global fetch para Open-Meteo Elevation: responde a cada petición
 * con una elevación por coordenada según `elevacionEn(lat, lon, indice)`,
 * donde `indice` es el índice global del punto entre todas las peticiones.
 */
function mockElevacion(
  elevacionEn: (lat: number, lon: number, indice: number) => number,
) {
  let indiceGlobal = 0;
  const mock = vi.fn().mockImplementation(async (url: string) => {
    const params = new URL(url).searchParams;
    const lats = params.get("latitude")!.split(",").map(Number);
    const lons = params.get("longitude")!.split(",").map(Number);
    const elevation = lats.map((lat, i) =>
      elevacionEn(lat, lons[i]!, indiceGlobal++),
    );
    return new Response(JSON.stringify({ elevation }), { status: 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("fetchElevaciones", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("agrupa en peticiones de como mucho 100 coordenadas y conserva el orden", async () => {
    const mock = mockElevacion((_lat, _lon, indice) => indice * 10);
    const puntos = Array.from({ length: 250 }, (_, i) => ({
      lat: 40 + i * 0.001,
      lon: -3,
    }));

    const elevaciones = await fetchElevaciones(puntos);

    expect(mock).toHaveBeenCalledTimes(3);
    for (const [url] of mock.mock.calls) {
      const lats = new URL(url as string).searchParams.get("latitude")!;
      expect(lats.split(",").length).toBeLessThanOrEqual(
        MAX_COORDS_POR_PETICION,
      );
    }
    expect(elevaciones).toHaveLength(250);
    expect(elevaciones[0]).toBe(0);
    expect(elevaciones[249]).toBe(2490);
  });

  test("lanza error si la API responde con fallo HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 })),
    );
    await expect(fetchElevaciones([{ lat: 40, lon: -3 }])).rejects.toThrow(
      "500",
    );
  });

  test("ante un 429 (límite por minuto) espera y reintenta hasta recuperar", async () => {
    vi.useFakeTimers();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limit", { status: 429 }))
      .mockResolvedValue(
        new Response(JSON.stringify({ elevation: [7] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", mock);

    const promesa = fetchElevaciones([{ lat: 40, lon: -3 }]);
    await vi.advanceTimersByTimeAsync(ESPERA_REINTENTO_MS);

    await expect(promesa).resolves.toEqual([7]);
    expect(mock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test("si el 429 persiste tras los reintentos, lanza error", async () => {
    vi.useFakeTimers();
    const mock = vi
      .fn()
      .mockResolvedValue(new Response("rate limit", { status: 429 }));
    vi.stubGlobal("fetch", mock);

    const promesa = fetchElevaciones([{ lat: 40, lon: -3 }]);
    promesa.catch(() => {}); // evita el aviso de rechazo no manejado
    for (let i = 0; i < MAX_REINTENTOS_429; i++) {
      await vi.advanceTimersByTimeAsync(ESPERA_REINTENTO_MS);
    }

    await expect(promesa).rejects.toThrow("429");
    expect(mock).toHaveBeenCalledTimes(1 + MAX_REINTENTOS_429);
    vi.useRealTimers();
  });

  test("lanza error si faltan elevaciones en la respuesta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ elevation: [1] }), { status: 200 }),
      ),
    );
    await expect(
      fetchElevaciones([
        { lat: 40, lon: -3 },
        { lat: 41, lon: -3 },
      ]),
    ).rejects.toThrow();
  });
});

describe("fetchPerfilHorizonte", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("terreno llano a la cota del observador → sin obstrucción positiva", async () => {
    mockElevacion(() => 600);
    const perfil = await fetchPerfilHorizonte(
      { lat: 41.5, lon: -2.5 },
      285,
      295,
    );

    expect(perfil.elevacionObservador).toBe(600);
    expect(perfil.acimuts).toHaveLength(26);
    for (const { angulo, fraccionMar } of perfil.acimuts) {
      expect(angulo).toBeLessThanOrEqual(0);
      expect(fraccionMar).toBe(0);
    }
  });

  test("una sierra de 800 m alrededor produce obstrucción de decenas de grados", async () => {
    // El primer punto (el Observador) está a 0 m; todo lo demás a 800 m.
    mockElevacion((_lat, _lon, indice) => (indice === 0 ? 0 : 800));
    const perfil = await fetchPerfilHorizonte(
      { lat: 42.9, lon: -0.5 },
      285,
      295,
    );

    expect(perfil.elevacionObservador).toBe(0);
    for (const { angulo, distanciaKm } of perfil.acimuts) {
      // atan(800 m / 1 km) ≈ 38,7°, dominado por el radio más cercano.
      expect(angulo).toBeGreaterThan(35);
      expect(distanciaKm).toBe(RADIOS_KM[0]);
    }
  });

  test("agrupa todas las coordenadas del sector en peticiones de ≤ 100", async () => {
    const mock = mockElevacion(() => 0);
    await fetchPerfilHorizonte({ lat: 39.6, lon: 2.9 }, 285, 295);

    // 1 (observador) + 26 acimuts × 16 radios = 417 puntos → 5 peticiones.
    expect(mock).toHaveBeenCalledTimes(5);
    let total = 0;
    for (const [url] of mock.mock.calls) {
      const lats = new URL(url as string).searchParams.get("latitude")!;
      const n = lats.split(",").length;
      expect(n).toBeLessThanOrEqual(MAX_COORDS_POR_PETICION);
      total += n;
    }
    expect(total).toBe(1 + 26 * RADIOS_KM.length);
  });

  test("cachea por Observador: la segunda llamada no vuelve a pedir", async () => {
    const mock = mockElevacion(() => 100);
    const observador = { lat: 43.4832, lon: -8.2369 };

    const primero = await fetchPerfilHorizonte(observador, 285, 295);
    const llamadasTrasPrimero = mock.mock.calls.length;
    const segundo = await fetchPerfilHorizonte(observador, 285, 295);

    expect(mock.mock.calls.length).toBe(llamadasTrasPrimero);
    expect(segundo).toBe(primero);
  });

  test("un fallo de red no envenena la caché: se puede reintentar", async () => {
    const observador = { lat: 36.72, lon: -4.42 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 })),
    );
    await expect(
      fetchPerfilHorizonte(observador, 285, 295),
    ).rejects.toThrow();
    vi.unstubAllGlobals();

    mockElevacion(() => 50);
    const perfil = await fetchPerfilHorizonte(observador, 285, 295);
    expect(perfil.elevacionObservador).toBe(50);
  });
});

describe("urlElevacion", () => {
  test("construye la URL con listas de coordenadas separadas por comas", () => {
    const url = urlElevacion([
      { lat: 43.4832, lon: -8.2369 },
      { lat: 40.4168, lon: -3.7038 },
    ]);
    expect(url).toBe(
      "https://api.open-meteo.com/v1/elevation?latitude=43.48320,40.41680&longitude=-8.23690,-3.70380",
    );
  });
});

describe("evaluarHorizonte", () => {
  /** Perfil sintético a partir de (acimut, ángulo, fracción de mar). */
  function perfil(
    entradas: [acimut: number, angulo: number, fraccionMar?: number][],
  ): PerfilHorizonte {
    return {
      elevacionObservador: 10,
      acimuts: entradas.map(([acimut, angulo, fraccionMar]) => ({
        acimut,
        angulo,
        distanciaKm: 5,
        fraccionMar: fraccionMar ?? 0,
      })),
    };
  }

  test("mar en el acimut del sol sin relieve → marino", () => {
    const veredicto = evaluarHorizonte(
      perfil([
        [280, -0.02, 1],
        [290, -0.02, 1],
        [300, 2.5, 0.2],
      ]),
      291,
      10,
    );
    expect(veredicto.tipo).toBe("marino");
    expect(veredicto.obstruccionEnSol).toBe(0);
  });

  test("relieve por debajo del sol → despejado, con la obstrucción máxima", () => {
    const veredicto = evaluarHorizonte(
      perfil([
        [280, 0.8],
        [290, 1.2],
        [300, 0.5],
      ]),
      285,
      10.3,
    );
    expect(veredicto.tipo).toBe("despejado");
    expect(veredicto.obstruccionMax).toBeCloseTo(1.2);
    expect(veredicto.acimutObstruccionMax).toBe(290);
  });

  test("el terreno alcanza al sol en su acimut → obstruido", () => {
    const veredicto = evaluarHorizonte(
      perfil([
        [280, 2],
        [290, 6],
        [300, 2],
      ]),
      289,
      4.1,
    );
    expect(veredicto.tipo).toBe("obstruido");
    expect(veredicto.obstruccionEnSol).toBe(6);
  });

  test("mar lejos del sol no da veredicto marino si hacia el sol hay monte", () => {
    const veredicto = evaluarHorizonte(
      perfil([
        [280, -0.02, 1],
        [300, 5, 0],
      ]),
      299,
      10,
    );
    expect(veredicto.tipo).toBe("despejado");
  });
});
