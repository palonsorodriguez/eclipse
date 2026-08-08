import { afterEach, describe, expect, test, vi } from "vitest";
import {
  acimutsResto,
  alturaPerfil,
  construirPerfilCielo,
  fetchPerfilCielo,
  suavizarCircular,
  texturaPerfil,
  ALTURA_MAX_TEXTURA,
  PASO_ACIMUT_RESTO,
  RADIOS_KM_RESTO,
  TAM_TEXTURA_PERFIL,
  type PerfilCielo,
} from "./cielo-horizonte";
import {
  acimutsSector,
  fetchPerfilHorizonte,
  MAX_COORDS_POR_PETICION,
  RADIOS_KM,
  type ObstruccionAcimut,
  type PerfilHorizonte,
} from "./horizonte";

/** Obstrucción sintética (acimut, ángulo, fracción de mar). */
function obstruccion(
  acimut: number,
  angulo: number,
  fraccionMar = 0,
): ObstruccionAcimut {
  return { acimut, angulo, distanciaKm: 5, fraccionMar };
}

/** Perfil de sector sintético a partir de obstrucciones. */
function sector(acimuts: ObstruccionAcimut[]): PerfilHorizonte {
  return { elevacionObservador: 10, acimuts };
}

describe("acimutsResto", () => {
  test("cubre el complemento del sector con paso 8° sin pisar el sector", () => {
    const delSector = new Set(acimutsSector(285, 295));
    const resto = acimutsResto(285, 295);

    // Sector 265..315 → resto de 323 a 619 (=259) con paso 8: 38 acimuts.
    expect(resto[0]).toBe(323);
    expect(resto[resto.length - 1]).toBe(259);
    expect(resto).toHaveLength(38);
    for (const a of resto) {
      expect(delSector.has(a)).toBe(false);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(360);
    }
  });

  test("junto al sector, el círculo completo queda muestreado sin huecos grandes", () => {
    const todos = [...acimutsSector(285, 295), ...acimutsResto(285, 295)]
      .sort((a, b) => a - b);
    for (let i = 1; i < todos.length; i++) {
      expect(todos[i]! - todos[i - 1]!).toBeLessThanOrEqual(PASO_ACIMUT_RESTO);
    }
    // Y el hueco al cruzar 0/360 tampoco supera el paso del resto.
    expect(360 - todos[todos.length - 1]! + todos[0]!).toBeLessThanOrEqual(
      PASO_ACIMUT_RESTO,
    );
  });
});

describe("suavizarCircular", () => {
  test("un perfil constante queda intacto", () => {
    const valores = new Float32Array(360).fill(3);
    const suave = suavizarCircular(valores, 2);
    for (const v of suave) expect(v).toBeCloseTo(3, 5);
  });

  test("reparte un pico y conserva la media, también en la costura 0/360", () => {
    const valores = new Float32Array(360);
    valores[0] = 10; // pico exactamente en la costura
    const suave = suavizarCircular(valores, 2);

    expect(suave[0]).toBeCloseTo(2, 5); // 10 / (2·2+1)
    expect(suave[359]).toBeCloseTo(2, 5); // la ventana envuelve el círculo
    expect(suave[2]).toBeCloseTo(2, 5);
    expect(suave[3]).toBe(0);
    const media = suave.reduce((s, v) => s + v, 0) / 360;
    expect(media).toBeCloseTo(10 / 360, 5);
  });
});

describe("construirPerfilCielo", () => {
  test("interpola entre muestras y recorta las alturas negativas a cero", () => {
    // Dos muestras: 4° en el acimut 100 y −1° (bajo horizonte) en el 120.
    const perfil = construirPerfilCielo(
      sector([obstruccion(100, 4)]),
      [obstruccion(120, -1)],
    );

    expect(perfil.alturas).toHaveLength(360);
    // El suavizado lima ligeramente la cresta: ~4° con tolerancia de ±0,5.
    expect(alturaPerfil(perfil.alturas, 100)).toBeCloseTo(4, 0);
    // A mitad de camino, la interpolación baja hacia 0 (el −1 se recorta).
    expect(alturaPerfil(perfil.alturas, 110)).toBeCloseTo(2, 1);
    expect(alturaPerfil(perfil.alturas, 120)).toBeLessThan(0.2);
    for (const h of perfil.alturas) expect(h).toBeGreaterThanOrEqual(0);
  });

  test("no tiene costura: el perfil en 0° y 360° es el mismo", () => {
    const perfil = construirPerfilCielo(
      sector([obstruccion(350, 6)]),
      [obstruccion(10, 2)],
    );
    expect(alturaPerfil(perfil.alturas, 0)).toBeCloseTo(
      alturaPerfil(perfil.alturas, 360),
      5,
    );
    // Entre 350 y 10 la interpolación cruza el norte con continuidad.
    expect(alturaPerfil(perfil.alturas, 0)).toBeGreaterThan(2);
    expect(alturaPerfil(perfil.alturas, 0)).toBeLessThan(6);
  });

  test("marca como mar los acimuts marinos y como tierra los montes", () => {
    // Costa NO (caso Ferrol/Covas): mar hacia 280–320, monte hacia 100.
    const perfil = construirPerfilCielo(
      sector([
        obstruccion(280, -0.02, 1),
        obstruccion(300, -0.02, 0.9),
        obstruccion(320, -0.02, 1),
      ]),
      [obstruccion(100, 5, 0), obstruccion(140, 4, 0)],
    );

    expect(alturaPerfil(perfil.mar, 300)).toBeGreaterThan(0.9);
    expect(alturaPerfil(perfil.mar, 120)).toBeLessThan(0.05);
    // Y el mar no levanta silueta: altura ~0 en el sector marino.
    expect(alturaPerfil(perfil.alturas, 300)).toBeLessThan(0.1);
  });

  test("un acimut con mucho mar pero relieve que asoma NO es horizonte marino", () => {
    const perfil = construirPerfilCielo(
      sector([obstruccion(290, 2.0, 0.9)]),
      [],
    );
    expect(alturaPerfil(perfil.mar, 290)).toBe(0);
  });
});

describe("texturaPerfil", () => {
  test("cuantiza altura en luminancia y mar en alfa, con la escala documentada", () => {
    const alturas = new Float32Array(360);
    const mar = new Float32Array(360);
    // Acimut 0: altura máxima de la textura, tierra. Acimut 180: mar llano.
    for (let d = 0; d < 360; d++) {
      alturas[d] = d < 90 || d >= 270 ? ALTURA_MAX_TEXTURA : 0;
      mar[d] = d >= 90 && d < 270 ? 1 : 0;
    }
    const perfil: PerfilCielo = { alturas, mar };
    const datos = texturaPerfil(perfil);

    expect(datos).toHaveLength(TAM_TEXTURA_PERFIL * 2);
    // Texel del acimut 0 (índice 0): altura 30° → 255, sin mar.
    expect(datos[0]).toBe(255);
    expect(datos[1]).toBe(0);
    // Texel del acimut 180 (mitad de la textura): mar llano.
    const mitad = TAM_TEXTURA_PERFIL / 2;
    expect(datos[mitad * 2]).toBe(0);
    expect(datos[mitad * 2 + 1]).toBe(255);
  });

  test("las alturas por encima del máximo saturan sin desbordar", () => {
    const perfil: PerfilCielo = {
      alturas: new Float32Array(360).fill(45),
      mar: new Float32Array(360),
    };
    const datos = texturaPerfil(perfil);
    expect(datos[0]).toBe(255);
  });
});

describe("alturaPerfil", () => {
  test("interpola linealmente y envuelve en 360°", () => {
    const valores = new Float32Array(360);
    valores[359] = 2;
    valores[0] = 4;
    expect(alturaPerfil(valores, 359.5)).toBeCloseTo(3, 5);
    expect(alturaPerfil(valores, -0.5)).toBeCloseTo(3, 5);
    expect(alturaPerfil(valores, 720)).toBeCloseTo(4, 5);
  });
});

/**
 * Mockea global fetch para Open-Meteo Elevation con una elevación fija por
 * coordenada según `elevacionEn(lat, lon)`.
 */
function mockElevacion(elevacionEn: (lat: number, lon: number) => number) {
  const mock = vi.fn().mockImplementation(async (url: string) => {
    const params = new URL(url).searchParams;
    const lats = params.get("latitude")!.split(",").map(Number);
    const lons = params.get("longitude")!.split(",").map(Number);
    const elevation = lats.map((lat, i) => elevacionEn(lat, lons[i]!));
    return new Response(JSON.stringify({ elevation }), { status: 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("fetchPerfilCielo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("respeta el presupuesto documentado: cabe en la ventana del límite", async () => {
    const mock = mockElevacion(() => 100);
    await fetchPerfilCielo({ lat: 41.1, lon: -1.1 }, 285, 295);

    // Sector: 1 + 26 × 16 = 417. Resto: 38 × 4 = 152. Total 569 → 7 lotes,
    // por debajo de las ~600 coordenadas/min medidas en #43.
    let total = 0;
    for (const [url] of mock.mock.calls) {
      const n = new URL(url as string).searchParams
        .get("latitude")!
        .split(",").length;
      expect(n).toBeLessThanOrEqual(MAX_COORDS_POR_PETICION);
      total += n;
    }
    expect(total).toBe(
      1 + 26 * RADIOS_KM.length + 38 * RADIOS_KM_RESTO.length,
    );
    expect(total).toBeLessThan(600);
    expect(mock).toHaveBeenCalledTimes(7);
  });

  test("comparte la caché del sector con el panel: no repite sus peticiones", async () => {
    const mock = mockElevacion(() => 50);
    const observador = { lat: 43.4832, lon: -8.2369 };

    // El panel pide primero el sector (5 peticiones)…
    await fetchPerfilHorizonte(observador, 285, 295);
    const trasPanel = mock.mock.calls.length;
    expect(trasPanel).toBe(5);

    // …y la Vista Cielo solo añade el resto del círculo (2 más).
    await fetchPerfilCielo(observador, 285, 295);
    expect(mock.mock.calls.length - trasPanel).toBe(2);
  });

  test("cachea por Observador: la segunda llamada no vuelve a pedir", async () => {
    const mock = mockElevacion(() => 200);
    const observador = { lat: 42.2, lon: 3.1 };

    const primero = await fetchPerfilCielo(observador, 285, 295);
    const llamadas = mock.mock.calls.length;
    const segundo = await fetchPerfilCielo(observador, 285, 295);

    expect(mock.mock.calls.length).toBe(llamadas);
    expect(segundo).toBe(primero);
  });

  test("un fallo de red rechaza sin envenenar la caché", async () => {
    const observador = { lat: 36.1, lon: -5.4 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 })),
    );
    await expect(
      fetchPerfilCielo(observador, 285, 295),
    ).rejects.toThrow();
    vi.unstubAllGlobals();

    mockElevacion(() => 0);
    const perfil = await fetchPerfilCielo(observador, 285, 295);
    expect(perfil.alturas).toHaveLength(360);
  });

  test("una costa al ONO produce mar hacia el sector y monte a su espalda", async () => {
    // Geometría tipo Ferrol/Covas: el mar al oeste del meridiano del
    // Observador (lon < lonObs → elevación 0), tierra alta al este.
    const observador = { lat: 43.7, lon: -8.05 };
    mockElevacion((lat, lon) =>
      lon < observador.lon ? 0 : lat === observador.lat ? 30 : 400,
    );
    const perfil = await fetchPerfilCielo(observador, 285, 295);

    // Hacia el ONO (sector del eclipse): horizonte marino, silueta plana.
    expect(alturaPerfil(perfil.mar, 292)).toBeGreaterThan(0.5);
    expect(alturaPerfil(perfil.alturas, 292)).toBeLessThan(0.2);
    // Hacia el E (resto del círculo): tierra con relieve.
    expect(alturaPerfil(perfil.mar, 90)).toBeLessThan(0.5);
    expect(alturaPerfil(perfil.alturas, 90)).toBeGreaterThan(1);
  });
});
