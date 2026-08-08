/**
 * Tests de la lógica pura de los extras de la Totalidad
 * (`cielo-extras.ts`): visibilidad de cuerpos según brillo y encuadre,
 * ángulo de posición del contacto y ventanas temporales de cada efecto.
 */

import { describe, expect, test } from "vitest";
import { configEscena } from "./cielo-render";
import {
  alfaCuerpo,
  anguloContacto,
  cuerposCielo,
  intensidadAnilloDiamante,
  intensidadPerlas,
  perlasBaily,
  proyectarCuerpos,
  SEMILLA_PERLAS,
  ARCO_PERLAS_RAD,
  sombraLateral,
  type CuerpoCielo,
} from "./cielo-extras";

/** Ferrol: dentro de la Franja de totalidad, C2 ≈ 18:27:12 UT. */
const FERROL = { lat: 43.4832, lon: -8.2369 };
/** Máximo local del eclipse en Ferrol (sol a acimut ≈ 279°, alt ≈ 12°). */
const T_TOTALIDAD = new Date("2026-08-12T18:27:57Z");

/** Cámara como la de la Vista Cielo en Ferrol: mirando al Sol del Máximo. */
const CFG = configEscena(279, 960, 540);

/** Contactos sintéticos para las ventanas temporales (ms epoch). */
const C2 = Date.UTC(2026, 7, 12, 18, 27, 12);
const C3 = Date.UTC(2026, 7, 12, 18, 28, 44);

describe("cuerposCielo (astronomía real del 12-08-2026)", () => {
  const cuerpos = cuerposCielo(FERROL, T_TOTALIDAD);
  const porNombre = (nombre: string) =>
    cuerpos.find((c) => c.nombre === nombre)!;

  test("Venus está bien alto hacia el oeste-suroeste, brillantísimo", () => {
    const venus = porNombre("Venus");
    expect(venus.altitud).toBeGreaterThan(15);
    expect(venus.acimut).toBeGreaterThan(200);
    expect(venus.acimut).toBeLessThan(280);
    expect(venus.magnitud).toBeLessThan(-3.5);
  });

  test("Júpiter está sobre el horizonte oeste, cerca del Sol eclipsado", () => {
    const jupiter = porNombre("Júpiter");
    expect(jupiter.altitud).toBeGreaterThan(2);
    expect(jupiter.acimut).toBeGreaterThan(270);
    expect(jupiter.acimut).toBeLessThan(310);
  });

  test("Régulo (a ~9° del Sol) está sobre el horizonte; Sirio, debajo", () => {
    expect(porNombre("Régulo").altitud).toBeGreaterThan(5);
    expect(porNombre("Sirio").altitud).toBeLessThan(0);
  });
});

describe("alfaCuerpo (fundido según brillo del cielo)", () => {
  test("con cielo diurno todo es invisible; con cielo apagado, opacidad plena", () => {
    expect(alfaCuerpo(1, "planeta")).toBe(0);
    expect(alfaCuerpo(1, "estrella")).toBe(0);
    expect(alfaCuerpo(0, "planeta")).toBe(1);
    expect(alfaCuerpo(0, "estrella")).toBe(1);
  });

  test("los planetas emergen antes que las estrellas al caer el brillo", () => {
    // Parcialidad profunda: brillo bajo pero aún por encima del umbral estelar.
    const brillo = 0.15;
    expect(alfaCuerpo(brillo, "planeta")).toBeGreaterThan(0);
    expect(alfaCuerpo(brillo, "estrella")).toBe(0);
  });
});

describe("proyectarCuerpos (filtro de encuadre)", () => {
  const cuerpo = (
    nombre: string,
    tipo: CuerpoCielo["tipo"],
    magnitud: number,
    altitud: number,
    acimut: number,
  ): CuerpoCielo => ({ nombre, tipo, magnitud, altitud, acimut });

  test("un cuerpo dentro del encuadre se proyecta con dentro=true", () => {
    const [jupiter] = proyectarCuerpos(
      [cuerpo("Júpiter", "planeta", -1.8, 7, 289)],
      CFG,
    );
    expect(jupiter.dentro).toBe(true);
    expect(jupiter.x).toBeGreaterThan(CFG.ancho / 2); // a la derecha del Sol
    expect(jupiter.y).toBeLessThan(CFG.alto * CFG.fraccionHorizonte);
  });

  test("los cuerpos bajo la silueta del horizonte se descartan", () => {
    expect(
      proyectarCuerpos([cuerpo("Sirio", "estrella", -1.46, -38, 285)], CFG),
    ).toHaveLength(0);
  });

  test("una estrella fuera de encuadre lateral se descarta", () => {
    expect(
      proyectarCuerpos([cuerpo("Arturo", "estrella", -0.05, 62, 214)], CFG),
    ).toHaveLength(0);
  });

  test("Venus fuera de encuadre lateral sobrevive como indicador de borde", () => {
    const [venus] = proyectarCuerpos(
      [cuerpo("Venus", "planeta", -4.4, 28, 233)],
      CFG,
    );
    expect(venus.dentro).toBe(false);
    expect(venus.x).toBeGreaterThanOrEqual(0); // clavada al borde izquierdo
    expect(venus.x).toBeLessThan(CFG.ancho * 0.05);
  });
});

describe("anguloContacto (ángulo de posición del contacto en el limbo)", () => {
  test("con la Luna a la izquierda del Sol, el contacto queda a la derecha", () => {
    const ang = anguloContacto({ x: 100, y: 50 }, { x: 90, y: 50 });
    expect(ang).toBeCloseTo(0, 6); // 0 rad = +x (derecha del canvas)
  });

  test("con la Luna debajo del Sol (y mayor), el contacto queda arriba", () => {
    const ang = anguloContacto({ x: 100, y: 50 }, { x: 100, y: 60 });
    expect(ang).toBeCloseTo(-Math.PI / 2, 6); // −π/2 = hacia arriba en canvas
  });
});

describe("ventanas temporales de los efectos de contacto", () => {
  test("el anillo de diamante crece en los ~4 s previos a C2 y calla en la Totalidad", () => {
    expect(intensidadAnilloDiamante(C2 - 10000, C2, C3)).toBe(0);
    const lejos = intensidadAnilloDiamante(C2 - 3000, C2, C3);
    const cerca = intensidadAnilloDiamante(C2 - 500, C2, C3);
    expect(lejos).toBeGreaterThan(0);
    expect(cerca).toBeGreaterThan(lejos);
    expect(intensidadAnilloDiamante(C2 + 1000, C2, C3)).toBe(0); // Totalidad
  });

  test("el anillo reaparece tras C3 y decae hasta apagarse", () => {
    const recien = intensidadAnilloDiamante(C3 + 500, C2, C3);
    const tarde = intensidadAnilloDiamante(C3 + 3500, C2, C3);
    expect(recien).toBeGreaterThan(tarde);
    expect(tarde).toBeGreaterThan(0);
    expect(intensidadAnilloDiamante(C3 + 10000, C2, C3)).toBe(0);
  });

  test("las perlas de Baily solo viven en los ~1,5 s pegados a C2/C3", () => {
    expect(intensidadPerlas(C2 - 3000, C2, C3)).toBe(0);
    expect(intensidadPerlas(C2 - 700, C2, C3)).toBeGreaterThan(0);
    expect(intensidadPerlas(C3 + 700, C2, C3)).toBeGreaterThan(0);
    expect(intensidadPerlas(C3 + 3000, C2, C3)).toBe(0);
  });

  test("sin Totalidad (C2/C3 nulos) ningún efecto de contacto se activa", () => {
    expect(intensidadAnilloDiamante(C2, null, null)).toBe(0);
    expect(intensidadPerlas(C2, null, null)).toBe(0);
    expect(sombraLateral(C2, null, null, 279).intensidad).toBe(0);
  });
});

describe("perlasBaily (reproducibles con semilla fija)", () => {
  test("misma semilla → mismas perlas; el render es reproducible", () => {
    expect(perlasBaily(SEMILLA_PERLAS)).toEqual(perlasBaily(SEMILLA_PERLAS));
  });

  test("hay entre 3 y 5 perlas, dentro del arco de contacto", () => {
    const perlas = perlasBaily(SEMILLA_PERLAS);
    expect(perlas.length).toBeGreaterThanOrEqual(3);
    expect(perlas.length).toBeLessThanOrEqual(5);
    for (const p of perlas) {
      expect(Math.abs(p.desfase)).toBeLessThanOrEqual(ARCO_PERLAS_RAD);
      expect(p.tam).toBeGreaterThan(0);
      expect(p.brillo).toBeGreaterThan(0);
    }
  });
});

describe("sombraLateral (la umbra se siente venir)", () => {
  test("silencio a 60 s de C2; crece dentro de los últimos 30 s", () => {
    expect(sombraLateral(C2 - 60000, C2, C3, 279).intensidad).toBe(0);
    const lejos = sombraLateral(C2 - 20000, C2, C3, 279).intensidad;
    const cerca = sombraLateral(C2 - 5000, C2, C3, 279).intensidad;
    expect(lejos).toBeGreaterThan(0);
    expect(cerca).toBeGreaterThan(lejos);
  });

  test("en la Totalidad no hay gradiente (el cielo entero ya está apagado)", () => {
    expect(sombraLateral(C2 + 1000, C2, C3, 279).intensidad).toBe(0);
  });

  test("con la cámara de Ferrol (279°) la umbra llega por la derecha (ONO) y se retira por el lado contrario", () => {
    const antes = sombraLateral(C2 - 5000, C2, C3, 279);
    const despues = sombraLateral(C3 + 5000, C2, C3, 279);
    expect(antes.desdeIzquierda).toBe(false); // ONO = a la derecha del centro
    expect(despues.intensidad).toBeGreaterThan(0);
    expect(despues.desdeIzquierda).toBe(true);
  });
});
