import { describe, expect, it } from "vitest";
import {
  ALTITUD_MAX_CILINDRICA,
  arrastrarCamara,
  camaraQuieta,
  configVistaInmersiva,
  crearCamara,
  FOV_HORIZONTAL,
  normalizarAcimut,
  pasoInercia,
  soltarCamara,
  VELOCIDAD_MAXIMA,
  ZOOM_DISCOS,
} from "./cielo-camara";
import { factorZoom, pxPorGrado } from "./cielo-render";

const RADIO_SOL = 0.2665; // radio aparente típico del Sol en agosto (grados)

describe("configVistaInmersiva", () => {
  it("en apaisado el FOV horizontal es el objetivo (~100°)", () => {
    const cfg = configVistaInmersiva(960, 540, 260, RADIO_SOL);
    expect(cfg.ancho / pxPorGrado(cfg)).toBeCloseTo(FOV_HORIZONTAL, 5);
    expect(cfg.altitudMax).toBeLessThanOrEqual(ALTITUD_MAX_CILINDRICA);
  });

  it("en vertical extremo recorta el FOV antes que pasar de 60° de altitud", () => {
    const cfg = configVistaInmersiva(390, 844, 260, RADIO_SOL);
    expect(cfg.altitudMax).toBeCloseTo(ALTITUD_MAX_CILINDRICA, 5);
    expect(cfg.ancho / pxPorGrado(cfg)).toBeLessThan(FOV_HORIZONTAL);
  });

  it("el zoom de los discos es exactamente ZOOM_DISCOS", () => {
    for (const [w, h] of [[960, 540], [390, 844], [2560, 1080]]) {
      const cfg = configVistaInmersiva(w, h, 0, RADIO_SOL);
      expect(factorZoom(RADIO_SOL, cfg)).toBeCloseTo(ZOOM_DISCOS, 6);
    }
  });
});

describe("normalizarAcimut", () => {
  it("deja [0, 360) intacto y pliega el resto", () => {
    expect(normalizarAcimut(0)).toBe(0);
    expect(normalizarAcimut(359.5)).toBe(359.5);
    expect(normalizarAcimut(360)).toBe(0);
    expect(normalizarAcimut(-10)).toBe(350);
    expect(normalizarAcimut(725)).toBe(5);
  });
});

describe("arrastrarCamara", () => {
  it("arrastrar a la derecha disminuye el acimut (agarrar el cielo)", () => {
    const cam = crearCamara(270);
    const tras = arrastrarCamara(cam, 100, 10); // 100 px a 10 px/grado
    expect(tras.acimutCentro).toBeCloseTo(260);
  });

  it("cruza el norte sin costura", () => {
    const cam = crearCamara(2);
    const tras = arrastrarCamara(cam, 50, 10); // −5°
    expect(tras.acimutCentro).toBeCloseTo(357);
  });

  it("anula la inercia previa: el dedo manda", () => {
    const cam = soltarCamara(crearCamara(180), 500, 10);
    expect(camaraQuieta(cam)).toBe(false);
    expect(camaraQuieta(arrastrarCamara(cam, 5, 10))).toBe(true);
  });
});

describe("soltarCamara e inercia", () => {
  it("hereda la velocidad angular del puntero, recortada al máximo", () => {
    const cam = soltarCamara(crearCamara(180), -200, 10);
    expect(cam.velocidad).toBeCloseTo(20); // 200 px/s ÷ 10 px/° hacia +az
    const bruto = soltarCamara(crearCamara(180), -1e6, 10);
    expect(bruto.velocidad).toBe(VELOCIDAD_MAXIMA);
  });

  it("la inercia avanza la cámara y decae hasta pararse", () => {
    let cam = soltarCamara(crearCamara(180), -300, 10); // +30°/s
    const az0 = cam.acimutCentro;
    cam = pasoInercia(cam, 0.1);
    expect(cam.acimutCentro).toBeGreaterThan(az0);
    expect(cam.velocidad).toBeGreaterThan(0);
    expect(cam.velocidad).toBeLessThan(30);
    // Tras varios segundos la cámara está quieta del todo.
    for (let i = 0; i < 100; i++) cam = pasoInercia(cam, 0.1);
    expect(camaraQuieta(cam)).toBe(true);
  });

  it("el desplazamiento total de la inercia converge a v·τ", () => {
    // Integral exacta de v0·e^(−t/τ): desplazamiento total = v0·τ.
    let cam = soltarCamara(crearCamara(0), -100, 10); // v0 = 10°/s
    for (let i = 0; i < 300; i++) cam = pasoInercia(cam, 1 / 60);
    expect(cam.acimutCentro).toBeCloseTo(10 * 0.55, 1);
  });

  it("con la cámara quieta es idempotente", () => {
    const cam = crearCamara(123.4);
    expect(pasoInercia(cam, 0.5)).toBe(cam);
  });
});
