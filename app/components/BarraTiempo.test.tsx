import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import BarraTiempo, {
  cuentaAtrasEclipse,
  marcasBarra,
  marcasBarraCompactas,
  siguienteModo,
  type MarcaBarra,
} from "./BarraTiempo";
import { ANTICIPO_SALTO_MS, type ContactosMs } from "@/lib/linea-tiempo-velocidad";
import { T_MAX, T_MIN, type ModoVelocidad } from "@/lib/reloj-tiempo";

// Contactos reales aproximados de un punto de la Franja de totalidad
// (Ferrol): C2/Máx/C3 se apiñan en ~2 min de las 2¼ h del rango.
const CONTACTOS_TOTAL: ContactosMs = {
  c1: Date.UTC(2026, 7, 12, 17, 34, 30),
  c2: Date.UTC(2026, 7, 12, 18, 27, 45),
  maximo: Date.UTC(2026, 7, 12, 18, 28, 40),
  c3: Date.UTC(2026, 7, 12, 18, 29, 35),
  c4: Date.UTC(2026, 7, 12, 19, 19, 50),
};

describe("siguienteModo (botón de velocidad cíclico)", () => {
  test("cicla Resumen → ×30 → ×60 → ×120 → ×300 → Resumen", () => {
    const vistos: ModoVelocidad[] = [];
    let modo: ModoVelocidad = "resumen";
    for (let i = 0; i < 5; i++) {
      modo = siguienteModo(modo);
      vistos.push(modo);
    }
    expect(vistos).toEqual([30, 60, 120, 300, "resumen"]);
  });
});

describe("marcasBarraCompactas (pantallas estrechas)", () => {
  test("eclipse total: C1 · Tot (destino C2 anticipado) · C4", () => {
    const compactas = marcasBarraCompactas(CONTACTOS_TOTAL, T_MIN, T_MAX);
    expect(compactas.map((m) => m.etiqueta)).toEqual(["C1", "Tot", "C4"]);
    expect(compactas[1].destino).toBe(CONTACTOS_TOTAL.c2! - ANTICIPO_SALTO_MS);
  });

  test("eclipse parcial (sin C2/C3): C1 · Máx · C4", () => {
    const parcial: ContactosMs = {
      ...CONTACTOS_TOTAL,
      c2: null,
      c3: null,
    };
    const compactas = marcasBarraCompactas(parcial, T_MIN, T_MAX);
    expect(compactas.map((m) => m.etiqueta)).toEqual(["C1", "Máx", "C4"]);
  });
});

describe("marcasBarra (marcas de Contactos clicables)", () => {
  test("cada marca salta a su Contacto con la anticipación de 12 s", () => {
    const marcas = marcasBarra(CONTACTOS_TOTAL, T_MIN, T_MAX);
    expect(marcas.map((m) => m.etiqueta)).toEqual([
      "C1",
      "C2",
      "Máx",
      "C3",
      "C4",
    ]);
    expect(marcas.find((m) => m.etiqueta === "C2")!.destino).toBe(
      CONTACTOS_TOTAL.c2! - ANTICIPO_SALTO_MS,
    );
    expect(marcas.find((m) => m.etiqueta === "Máx")!.destino).toBe(
      CONTACTOS_TOTAL.maximo - ANTICIPO_SALTO_MS,
    );
  });

  test("el nombre accesible lleva la hora CEST del Contacto", () => {
    const marcas = marcasBarra(CONTACTOS_TOTAL, T_MIN, T_MAX);
    // C2 a las 18:27:45 UT = 20:27:45 CEST.
    expect(marcas.find((m) => m.etiqueta === "C2")!.ariaLabel).toBe(
      "Saltar a C2 — 20:27:45 CEST",
    );
  });

  test("las etiquetas apiñadas (C2/Máx/C3) se separan; la posición real no", () => {
    const marcas = marcasBarra(CONTACTOS_TOTAL, T_MIN, T_MAX);
    const porEtiqueta = new Map<string, MarcaBarra>(
      marcas.map((m) => [m.etiqueta, m]),
    );
    const c2 = porEtiqueta.get("C2")!;
    const max = porEtiqueta.get("Máx")!;
    const c3 = porEtiqueta.get("C3")!;
    // Posición real: prácticamente el mismo punto del slider.
    expect(max.pct - c2.pct).toBeLessThan(2);
    // Etiquetas: separadas para que las áreas táctiles no se pisen.
    expect(max.pctEtiqueta - c2.pctEtiqueta).toBeGreaterThanOrEqual(3.9);
    expect(c3.pctEtiqueta - max.pctEtiqueta).toBeGreaterThanOrEqual(3.9);
  });

  test("en un eclipse parcial no hay marcas C2/C3", () => {
    const parcial: ContactosMs = {
      ...CONTACTOS_TOTAL,
      c2: null,
      c3: null,
    };
    expect(marcasBarra(parcial, T_MIN, T_MAX).map((m) => m.etiqueta)).toEqual([
      "C1",
      "Máx",
      "C4",
    ]);
  });
});

describe("cuentaAtrasEclipse (botón AHORA antes de la ventana)", () => {
  test("a días vista cuenta en días y horas", () => {
    // 9 de agosto a las 03:15 UT: exactamente 3d 14h antes de T_MIN.
    expect(cuentaAtrasEclipse(Date.UTC(2026, 7, 9, 3, 15, 0))).toBe("3d 14h");
  });

  test("el mismo día cuenta en horas y minutos, y al final en minutos y segundos", () => {
    expect(cuentaAtrasEclipse(Date.UTC(2026, 7, 12, 14, 10, 0))).toBe("3h 5m");
    expect(cuentaAtrasEclipse(Date.UTC(2026, 7, 12, 17, 11, 40))).toBe("3m 20s");
  });

  test("dentro de la ventana ya no hay cuenta atrás", () => {
    expect(cuentaAtrasEclipse(T_MIN)).toBeNull();
    expect(cuentaAtrasEclipse(Date.UTC(2026, 7, 12, 18, 0, 0))).toBeNull();
  });
});

describe("BarraTiempo", () => {
  test("una sola fila: play, slider, marcas clicables, hora CEST y velocidad", () => {
    const html = renderToStaticMarkup(<BarraTiempo />);

    // Un único slider de la Línea de tiempo.
    expect(html.match(/Línea de tiempo del eclipse/g)).toHaveLength(1);
    // Las marcas son botones con la hora CEST en el aria-label.
    expect(html).toMatch(/aria-label="Saltar a C1 — \d{2}:\d{2}:\d{2} CEST"/);
    expect(html).toMatch(/aria-label="Saltar a Máx — \d{2}:\d{2}:\d{2} CEST"/);
    // Botón de velocidad cíclico mostrando el modo actual (Resumen al abrir).
    expect(html).toContain("Velocidad de reproducción: Resumen");
    // Play visible.
    expect(html).toContain('aria-label="Reproducir"');
  });

  test("el botón AHORA está en la barra, sin directo activado al servir", () => {
    const html = renderToStaticMarkup(<BarraTiempo />);
    expect(html).toContain("🔴 AHORA");
    expect(html).toContain(
      'aria-label="AHORA: sincronizar la simulación con el reloj real"',
    );
    expect(html).toContain('aria-pressed="false"');
  });
});
