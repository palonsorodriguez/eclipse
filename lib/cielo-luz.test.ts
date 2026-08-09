import { describe, expect, it } from "vitest";
import {
  ajustarCalidad,
  alfaCorona,
  altitudMinimaVisible,
  alturaTerreno,
  CAPAS_TERRENO,
  factorLuna,
  glareParcialidad,
  gradienteExtincion,
  intensidadAnillo360,
  intensidadCromosfera,
  luzAmbiente,
  tinteExtincion,
} from "./cielo-luz";

describe("factorLuna (acoplamiento Luna–cielo)", () => {
  it("es monótono creciente con el brillo y está acotado", () => {
    let previo = -Infinity;
    for (let b = 0; b <= 1.001; b += 0.05) {
      const f = factorLuna(b);
      expect(f).toBeGreaterThanOrEqual(0.28);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(previo);
      previo = f;
    }
  });

  it("de día la Luna es indistinguible del cielo (factor exactamente 1)", () => {
    expect(factorLuna(1)).toBe(1);
  });
});

describe("tinteExtincion", () => {
  it("no tiñe con el Sol alto y amarillea al bajar", () => {
    expect(tinteExtincion(25)).toEqual([1, 1, 1]);
    const baleares = tinteExtincion(2); // Sol a ~2°: corona amarilla
    expect(baleares[0]).toBe(1);
    expect(baleares[1]).toBeLessThan(0.75);
    expect(baleares[2]).toBeLessThan(baleares[1]); // pierde más azul que verde
  });

  it("g y b decrecen monótonamente al bajar la altitud", () => {
    let gPrevio = -Infinity;
    let bPrevio = -Infinity;
    for (let alt = 0; alt <= 22; alt += 1) {
      const [, g, b] = tinteExtincion(alt);
      expect(g).toBeGreaterThanOrEqual(gPrevio);
      expect(b).toBeGreaterThanOrEqual(bPrevio);
      gPrevio = g;
      bPrevio = b;
    }
  });
});

describe("gradienteExtincion", () => {
  it("nulo con el Sol alto, máximo pegado al horizonte", () => {
    expect(gradienteExtincion(20)).toBe(0);
    expect(gradienteExtincion(15)).toBe(0);
    expect(gradienteExtincion(0.5)).toBeCloseTo(0.55);
    // Galicia (~11°) apenas nota el gradiente; Baleares (~2°) sí.
    expect(gradienteExtincion(11)).toBeLessThan(gradienteExtincion(2));
  });
});

describe("intensidadAnillo360 y alfaCorona", () => {
  it("el anillo crepuscular emerge al apagarse el cielo y es pleno en Totalidad", () => {
    expect(intensidadAnillo360(1, false)).toBe(0);
    expect(intensidadAnillo360(0.12, false)).toBe(0);
    expect(intensidadAnillo360(0.06, false)).toBeCloseTo(0.5);
    expect(intensidadAnillo360(0, true)).toBe(1);
  });

  it("la corona se funde en los últimos instantes, sin pop", () => {
    expect(alfaCorona(0.5, false)).toBe(0);
    expect(alfaCorona(0.01, false)).toBe(0);
    expect(alfaCorona(0.005, false)).toBeCloseTo(0.5);
    expect(alfaCorona(0, true)).toBe(1);
  });
});

describe("glareParcialidad (el glare que respira, #56)", () => {
  it("intensidad y radio caen monótonamente con el Oscurecimiento", () => {
    let intPrevia = Infinity;
    let radioPrevio = Infinity;
    for (let o = 0; o <= 1.0001; o += 0.01) {
      const g = glareParcialidad(o);
      expect(g.intensidad).toBeLessThanOrEqual(intPrevia);
      expect(g.radio).toBeLessThanOrEqual(radioPrevio);
      intPrevia = g.intensidad;
      radioPrevio = g.radio;
    }
  });

  it("sin eclipse el glare es pleno; la caída se percibe pronto", () => {
    expect(glareParcialidad(0)).toEqual({
      intensidad: 1,
      radio: 1,
      creciente: 0,
    });
    // Al 50% de Oscurecimiento la intensidad ya ha caído a ~un tercio:
    // el resplandor "respira" mucho antes del tramo final.
    expect(glareParcialidad(0.5).intensidad).toBeLessThan(0.4);
  });

  it("a partir del ~60% el glare adelgaza con decisión", () => {
    const r60 = glareParcialidad(0.6).radio;
    const r85 = glareParcialidad(0.85).radio;
    expect(r60).toBeGreaterThanOrEqual(0.75); // aún reconocible como halo
    expect(r85).toBeLessThanOrEqual(0.55); // claramente más fino
  });

  it("el creciente solo aparece por encima del ~85% y crece monótono", () => {
    expect(glareParcialidad(0.6).creciente).toBe(0);
    expect(glareParcialidad(0.85).creciente).toBe(0);
    let previo = 0;
    for (let o = 0.85; o <= 1.0001; o += 0.01) {
      const c = glareParcialidad(o).creciente;
      expect(c).toBeGreaterThanOrEqual(previo);
      previo = c;
    }
    expect(glareParcialidad(0.92).creciente).toBeGreaterThan(0);
  });

  it("colapso final: hacia el punto del anillo de diamante", () => {
    const final = glareParcialidad(1);
    expect(final.intensidad).toBe(0);
    expect(final.radio).toBeLessThanOrEqual(0.2); // un punto, no un halo
    expect(final.creciente).toBe(1); // centrado en el punto de contacto
    expect(glareParcialidad(0.99).intensidad).toBeLessThan(0.005);
  });
});

describe("intensidadCromosfera", () => {
  const c2 = 1_000_000;
  const c3 = 1_100_000;

  it("visible a ambos lados de C2 y C3, apagada lejos de los contactos", () => {
    expect(intensidadCromosfera(c2, c2, c3)).toBe(1);
    expect(intensidadCromosfera(c2 - 4000, c2, c3)).toBeCloseTo(0.5);
    expect(intensidadCromosfera(c2 + 4000, c2, c3)).toBeCloseTo(0.5); // dentro
    expect(intensidadCromosfera(c3 + 4000, c2, c3)).toBeCloseTo(0.5);
    expect(intensidadCromosfera((c2 + c3) / 2, c2, c3)).toBe(0); // pleno centro
    expect(intensidadCromosfera(c2 - 60_000, c2, c3)).toBe(0);
  });

  it("sin Totalidad no hay cromosfera", () => {
    expect(intensidadCromosfera(c2, null, null)).toBe(0);
  });
});

describe("luzAmbiente", () => {
  it("en Totalidad el terreno queda en penumbra fría (domina el azul)", () => {
    const [r, g, b] = luzAmbiente(0);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("de día hay más luz que en Totalidad", () => {
    const dia = luzAmbiente(1);
    const totalidad = luzAmbiente(0);
    expect(dia[0]).toBeGreaterThan(totalidad[0]);
    expect(dia[1]).toBeGreaterThan(totalidad[1]);
  });
});

describe("ajustarCalidad", () => {
  it("baja un escalón cuando el frame se encarece", () => {
    expect(ajustarCalidad(30, 1)).toBe(0.75);
    expect(ajustarCalidad(30, 0.75)).toBe(0.5);
    expect(ajustarCalidad(30, 0.5)).toBe(0.5); // no hay más abajo
  });

  it("sube un escalón con margen sobrado y mantiene en la banda muerta", () => {
    expect(ajustarCalidad(10, 0.5)).toBe(0.75);
    expect(ajustarCalidad(10, 1)).toBe(1);
    expect(ajustarCalidad(18, 0.75)).toBe(0.75); // banda muerta: no oscila
  });
});

describe("alturaTerreno", () => {
  it("es periódico en 360°: el paneo no encuentra costuras", () => {
    for (let capa = 0; capa < CAPAS_TERRENO.length; capa++) {
      for (const az of [0, 45.3, 180, 359.99]) {
        expect(alturaTerreno(az + 360, capa)).toBeCloseTo(
          alturaTerreno(az, capa),
          10,
        );
      }
    }
  });

  it("cada capa respeta su amplitud y nunca baja de 0", () => {
    for (let capa = 0; capa < CAPAS_TERRENO.length; capa++) {
      for (let az = 0; az < 360; az += 7) {
        const h = alturaTerreno(az, capa);
        expect(h).toBeGreaterThan(0);
        expect(h).toBeLessThanOrEqual(CAPAS_TERRENO[capa].amplitud);
      }
    }
  });

  it("altitudMinimaVisible es el máximo de las siluetas", () => {
    for (const az of [0, 90, 200, 300]) {
      let esperado = 0;
      for (let capa = 0; capa < CAPAS_TERRENO.length; capa++) {
        esperado = Math.max(esperado, alturaTerreno(az, capa));
      }
      expect(altitudMinimaVisible(az)).toBeCloseTo(esperado);
    }
  });
});
