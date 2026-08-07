/**
 * cielo-draw — Pintado de la escena de la Vista Cielo sobre un canvas 2D.
 *
 * Módulo imperativo (recibe un CanvasRenderingContext2D); toda la geometría
 * y el color vienen de la lógica pura de `cielo-render.ts`. Orden de capas:
 *
 *   1. Gradiente del cielo (altitud solar × brillo)
 *   2. Estrellas (solo visibles en Totalidad)
 *   3. Resplandor de 360° en el horizonte (Totalidad y umbral cercano)
 *   4. Sol (o corona + disco negro en Totalidad) y Luna
 *   5. Silueta de colinas y suelo
 *   6. Marcas y rumbos de acimut
 */

import type { PosicionesSolLuna } from "./eclipse-engine";
import {
  alturaColinas,
  brilloEscena,
  coloresCielo,
  configEscena,
  css,
  escenaSolLuna,
  nombreAcimut,
  proyectarAltAz,
  pxPorGrado,
  yHorizonte,
  type ConfigEscena,
  type DiscoEscena,
} from "./cielo-render";

export { configEscena, type ConfigEscena };

/** Parámetros de un fotograma de la escena. */
export interface FotogramaEscena {
  cfg: ConfigEscena;
  posiciones: PosicionesSolLuna;
  /** Oscurecimiento [0, 1] en el instante dibujado. */
  obscuracion: number;
  /** `true` si el instante está dentro de la Totalidad (C2–C3). */
  enTotalidad: boolean;
}

/** Streamers de la corona: ángulo (rad), longitud (× radio) y anchura (rad). */
const STREAMERS: Array<{ ang: number; largo: number; ancho: number; alfa: number }> = [
  { ang: 0.15, largo: 3.4, ancho: 0.5, alfa: 0.34 },
  { ang: 0.95, largo: 2.5, ancho: 0.38, alfa: 0.26 },
  { ang: 1.85, largo: 3.0, ancho: 0.42, alfa: 0.3 },
  { ang: 2.7, largo: 2.2, ancho: 0.34, alfa: 0.22 },
  { ang: 3.35, largo: 3.6, ancho: 0.52, alfa: 0.34 },
  { ang: 4.2, largo: 2.4, ancho: 0.36, alfa: 0.24 },
  { ang: 4.95, largo: 3.1, ancho: 0.46, alfa: 0.3 },
  { ang: 5.7, largo: 2.6, ancho: 0.4, alfa: 0.26 },
];

/** Estrellas fijas deterministas (fracciones del canvas), visibles en Totalidad. */
const ESTRELLAS: Array<{ x: number; y: number; r: number; a: number }> = (() => {
  const puntos: Array<{ x: number; y: number; r: number; a: number }> = [];
  let s = 42;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 60; i++) {
    puntos.push({ x: rnd(), y: rnd() * 0.8, r: 0.5 + rnd() * 1.1, a: 0.35 + rnd() * 0.55 });
  }
  return puntos;
})();

function discoOscuroLuna(ctx: CanvasRenderingContext2D, luna: DiscoEscena): void {
  ctx.beginPath();
  ctx.arc(luna.x, luna.y, luna.radio, 0, Math.PI * 2);
  ctx.fillStyle = "#0a0b12";
  ctx.fill();
}

function dibujarCorona(ctx: CanvasRenderingContext2D, luna: DiscoEscena): void {
  const { x, y, radio } = luna;

  // Halo interno perlado con irregularidades suaves.
  const halo = ctx.createRadialGradient(x, y, radio * 0.95, x, y, radio * 3.2);
  halo.addColorStop(0, "rgba(255,253,246,0.95)");
  halo.addColorStop(0.18, "rgba(240,240,248,0.5)");
  halo.addColorStop(0.5, "rgba(214,220,238,0.16)");
  halo.addColorStop(1, "rgba(200,210,235,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, radio * 3.2, 0, Math.PI * 2);
  ctx.fill();

  // Streamers: cuñas radiales suaves con gradiente propio.
  for (const s of STREAMERS) {
    const grad = ctx.createRadialGradient(x, y, radio, x, y, radio * s.largo);
    grad.addColorStop(0, `rgba(248,248,252,${s.alfa})`);
    grad.addColorStop(0.55, `rgba(226,230,246,${s.alfa * 0.4})`);
    grad.addColorStop(1, "rgba(210,218,242,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, radio * s.largo, s.ang - s.ancho / 2, s.ang + s.ancho / 2);
    ctx.closePath();
    ctx.fill();
  }

  // Disco negro de la Luna sobre la corona.
  discoOscuroLuna(ctx, luna);
}

function dibujarSolParcial(
  ctx: CanvasRenderingContext2D,
  sol: DiscoEscena,
  luna: DiscoEscena,
  brillo: number,
): void {
  // Resplandor alrededor del Sol, atenuado con el brillo de la escena.
  const alfaGlow = 0.25 + 0.55 * brillo;
  const glow = ctx.createRadialGradient(
    sol.x, sol.y, sol.radio * 0.8,
    sol.x, sol.y, sol.radio * 2.6,
  );
  glow.addColorStop(0, `rgba(255,236,190,${alfaGlow})`);
  glow.addColorStop(1, "rgba(255,220,160,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sol.x, sol.y, sol.radio * 2.6, 0, Math.PI * 2);
  ctx.fill();

  // Disco solar: núcleo blanco, borde cálido.
  const disco = ctx.createRadialGradient(
    sol.x, sol.y, sol.radio * 0.2,
    sol.x, sol.y, sol.radio,
  );
  disco.addColorStop(0, "#fffdf4");
  disco.addColorStop(0.75, "#ffefc0");
  disco.addColorStop(1, "#ffd98a");
  ctx.fillStyle = disco;
  ctx.beginPath();
  ctx.arc(sol.x, sol.y, sol.radio, 0, Math.PI * 2);
  ctx.fill();

  // La Luna muerde al Sol: disco oscuro por encima, solo cuando hay
  // solape (la Luna nueva es invisible contra el cielo).
  const dist = Math.hypot(luna.x - sol.x, luna.y - sol.y);
  if (dist < sol.radio + luna.radio) {
    discoOscuroLuna(ctx, luna);
  }
}

function dibujarHorizonte(ctx: CanvasRenderingContext2D, cfg: ConfigEscena): void {
  const yHor = yHorizonte(cfg);

  // Silueta de colinas (perfil determinista) + suelo.
  ctx.beginPath();
  ctx.moveTo(0, cfg.alto);
  ctx.lineTo(0, yHor - alturaColinas(0, cfg));
  const pasos = 96;
  for (let i = 1; i <= pasos; i++) {
    const x01 = i / pasos;
    ctx.lineTo(x01 * cfg.ancho, yHor - alturaColinas(x01, cfg));
  }
  ctx.lineTo(cfg.ancho, cfg.alto);
  ctx.closePath();
  ctx.fillStyle = "#05060a";
  ctx.fill();
}

function dibujarMarcasAcimut(ctx: CanvasRenderingContext2D, cfg: ConfigEscena): void {
  const yHor = yHorizonte(cfg);
  const medioAncho = cfg.ancho / 2 / pxPorGrado(cfg);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Ticks cada 5° de acimut.
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  const azInicio = Math.ceil((cfg.acimutCentro - medioAncho) / 5) * 5;
  for (let az = azInicio; az <= cfg.acimutCentro + medioAncho; az += 5) {
    const { x } = proyectarAltAz(0, az, cfg);
    const alto = az % 45 === 0 ? 10 : 5;
    ctx.beginPath();
    ctx.moveTo(x, yHor + 2);
    ctx.lineTo(x, yHor + 2 + alto);
    ctx.stroke();
  }

  // Rumbos cada 22,5° (O, ONO, NO…).
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "12px system-ui, sans-serif";
  const rumboInicio = Math.ceil((cfg.acimutCentro - medioAncho) / 22.5) * 22.5;
  for (let az = rumboInicio; az <= cfg.acimutCentro + medioAncho; az += 22.5) {
    const { x } = proyectarAltAz(0, az, cfg);
    if (x < 14 || x > cfg.ancho - 14) continue;
    ctx.fillText(nombreAcimut(az), x, yHor + 16);
  }
}

/**
 * Dibuja un fotograma completo de la Vista Cielo. Idempotente: pinta la
 * escena entera en cada llamada (pensado para requestAnimationFrame).
 */
export function dibujarEscena(
  ctx: CanvasRenderingContext2D,
  f: FotogramaEscena,
): void {
  const { cfg } = f;
  const brillo = brilloEscena(f.obscuracion, f.enTotalidad);
  const yHor = yHorizonte(cfg);

  // 1. Cielo.
  const colores = coloresCielo(f.posiciones.sol.altitud, brillo);
  const cielo = ctx.createLinearGradient(0, 0, 0, yHor);
  cielo.addColorStop(0, css(colores.cenit));
  cielo.addColorStop(1, css(colores.horizonte));
  ctx.fillStyle = cielo;
  ctx.fillRect(0, 0, cfg.ancho, cfg.alto);

  // 2. Estrellas: emergen solo cuando el cielo se apaga del todo.
  const alfaEstrellas = f.enTotalidad ? 1 : Math.max(0, 1 - brillo / 0.06) * 0.5;
  if (alfaEstrellas > 0.01) {
    for (const e of ESTRELLAS) {
      ctx.fillStyle = `rgba(255,255,255,${(e.a * alfaEstrellas).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(e.x * cfg.ancho, e.y * yHor, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Resplandor crepuscular de 360° pegado al horizonte (Totalidad y
  //    umbral inmediato): la luz del día fuera de la sombra lunar.
  const alfaResplandor = f.enTotalidad
    ? 0.55
    : Math.max(0, 1 - brillo / 0.12) * 0.35;
  if (alfaResplandor > 0.01) {
    const banda = ctx.createLinearGradient(0, yHor - cfg.alto * 0.16, 0, yHor);
    banda.addColorStop(0, "rgba(255,150,80,0)");
    banda.addColorStop(0.7, `rgba(255,150,80,${(alfaResplandor * 0.55).toFixed(3)})`);
    banda.addColorStop(1, `rgba(255,190,120,${alfaResplandor.toFixed(3)})`);
    ctx.fillStyle = banda;
    ctx.fillRect(0, yHor - cfg.alto * 0.16, cfg.ancho, cfg.alto * 0.16);
  }

  // 4. Sol y Luna (con zoom; ver cielo-render.ts).
  const esc = escenaSolLuna(f.posiciones, cfg);
  if (f.enTotalidad) {
    dibujarCorona(ctx, esc.luna);
  } else if (f.posiciones.sol.altitud > -1) {
    dibujarSolParcial(ctx, esc.sol, esc.luna, brillo);
  }

  // 5–6. Horizonte y rótulos.
  dibujarHorizonte(ctx, cfg);
  dibujarMarcasAcimut(ctx, cfg);
}
