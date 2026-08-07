import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clasificarVeredicto,
  fetchPrevisionEclipse,
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

describe("fetchPrevisionEclipse", () => {
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

  test("extrae la ventana 19:00–22:00 y clasifica el veredicto", async () => {
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

    const prevision = await fetchPrevisionEclipse(40.4168, -3.7038);

    expect(prevision.horas.map((h) => h.hora)).toEqual([
      "19:00",
      "20:00",
      "21:00",
      "22:00",
    ]);
    expect(prevision.horas[1]).toEqual({
      hora: "20:00",
      total: 15,
      baja: 10,
      media: 5,
      alta: 0,
    });
    expect(prevision.veredicto.clave).toBe("despejado");
  });

  test("lanza error si la API responde con fallo HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 })),
    );
    await expect(fetchPrevisionEclipse(40, -3)).rejects.toThrow("500");
  });

  test("lanza error si faltan los datos horarios", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ hourly: {} }), { status: 200 }),
      ),
    );
    await expect(fetchPrevisionEclipse(40, -3)).rejects.toThrow();
  });
});
