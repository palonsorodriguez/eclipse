/**
 * Tests de la lógica pura de la Vista Cielo (`cielo-render.ts`):
 * proyección alt-az → canvas, curva de brillo del cielo y escalado
 * coherente de los discos de Sol y Luna.
 */

import { describe, expect, test } from "vitest";
import type { PosicionesSolLuna } from "./eclipse-engine";
import {
  brilloCielo,
  brilloEscena,
  configEscena,
  escenaSolLuna,
  nombreAcimut,
  proyectarAltAz,
  yHorizonte,
} from "./cielo-render";

const CFG = configEscena(255, 960, 540); // cámara mirando al OSO

describe("proyectarAltAz (mapeo alt-az → canvas)", () => {
  test("el horizonte en el acimut central cae en el centro horizontal y en la línea del horizonte", () => {
    const p = proyectarAltAz(0, CFG.acimutCentro, CFG);
    expect(p.x).toBeCloseTo(CFG.ancho / 2, 6);
    expect(p.y).toBeCloseTo(yHorizonte(CFG), 6);
  });

  test("subir en altitud mueve el punto hacia arriba (y menor), hasta el borde superior en altitudMax", () => {
    const bajo = proyectarAltAz(5, CFG.acimutCentro, CFG);
    const alto = proyectarAltAz(20, CFG.acimutCentro, CFG);
    expect(alto.y).toBeLessThan(bajo.y);
    const tope = proyectarAltAz(CFG.altitudMax, CFG.acimutCentro, CFG);
    expect(tope.y).toBeCloseTo(0, 6);
  });

  test("un acimut mayor que el central queda a la derecha; uno menor, a la izquierda", () => {
    const derecha = proyectarAltAz(10, CFG.acimutCentro + 15, CFG);
    const izquierda = proyectarAltAz(10, CFG.acimutCentro - 15, CFG);
    expect(derecha.x).toBeGreaterThan(CFG.ancho / 2);
    expect(izquierda.x).toBeLessThan(CFG.ancho / 2);
  });

  test("el acimut envuelve en 0/360: con la cámara a 10°, el acimut 350° queda a la izquierda", () => {
    const cfg = configEscena(10, 960, 540);
    const p = proyectarAltAz(10, 350, cfg);
    expect(p.x).toBeLessThan(cfg.ancho / 2);
  });
});

describe("brilloCielo (curva de brillo del cielo)", () => {
  test("es 1 sin eclipse y casi 0 en la Totalidad", () => {
    expect(brilloCielo(0)).toBe(1);
    expect(brilloCielo(1)).toBeLessThan(1e-6);
  });

  test("es monótona decreciente con el Oscurecimiento", () => {
    let anterior = Infinity;
    for (let o = 0; o <= 1.0001; o += 0.01) {
      const b = brilloCielo(o);
      expect(b).toBeLessThanOrEqual(anterior);
      anterior = b;
    }
  });

  test("apenas cambia hasta ~70% y se desploma en el tramo final", () => {
    expect(brilloCielo(0.5)).toBeGreaterThan(0.8);
    expect(brilloCielo(0.7)).toBeGreaterThan(0.5);
    expect(brilloCielo(0.99)).toBeLessThan(0.01);
  });

  test("brilloEscena mantiene penumbra (no negro) fuera de la Totalidad y 0 dentro", () => {
    // Madrid: máximo ~99,9% sin Totalidad → penumbra extraña pero no negro.
    expect(brilloEscena(0.999, false)).toBeGreaterThan(0);
    expect(brilloEscena(1, true)).toBe(0);
  });
});

describe("escenaSolLuna (escalado de discos)", () => {
  /** Geometría sintética: Sol y Luna casi superpuestos, separación en altitud. */
  const POS: PosicionesSolLuna = {
    sol: { altitud: 12, acimut: 255, radioAparente: 0.2629 },
    luna: { altitud: 12.3, acimut: 255, radioAparente: 0.2739 },
    separacionAngular: 0.3,
  };

  test("el disco solar ocupa la fracción de canvas configurada (~1/6 de la altura)", () => {
    const { sol } = escenaSolLuna(POS, CFG);
    expect(sol.radio * 2).toBeCloseTo(CFG.alto * CFG.fraccionDiscoSolar, 6);
  });

  test("la razón de radios Luna/Sol se conserva tras el zoom", () => {
    const { sol, luna } = escenaSolLuna(POS, CFG);
    expect(luna.radio / sol.radio).toBeCloseTo(
      POS.luna.radioAparente / POS.sol.radioAparente,
      6,
    );
  });

  test("la separación relativa (separación / radio solar) se conserva en píxeles", () => {
    const { sol, luna } = escenaSolLuna(POS, CFG);
    const separacionPx = Math.hypot(luna.x - sol.x, luna.y - sol.y);
    expect(separacionPx / sol.radio).toBeCloseTo(
      POS.separacionAngular / POS.sol.radioAparente,
      2,
    );
  });

  test("con separación mayor que la suma de radios, los discos no se tocan en pantalla", () => {
    const lejos: PosicionesSolLuna = {
      sol: POS.sol,
      luna: { altitud: 13.2, acimut: 255, radioAparente: 0.2739 },
      separacionAngular: 1.2,
    };
    const { sol, luna } = escenaSolLuna(lejos, CFG);
    const separacionPx = Math.hypot(luna.x - sol.x, luna.y - sol.y);
    expect(separacionPx).toBeGreaterThan(sol.radio + luna.radio);
  });
});

describe("nombreAcimut", () => {
  test("resuelve los rumbos del oeste donde se pone el sol del eclipse", () => {
    expect(nombreAcimut(270)).toBe("O");
    expect(nombreAcimut(292.5)).toBe("ONO");
    expect(nombreAcimut(247.5)).toBe("OSO");
  });
});
