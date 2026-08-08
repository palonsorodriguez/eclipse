/**
 * cielo-draw — Pintado de la escena de la Vista Cielo sobre un canvas 2D.
 *
 * Módulo imperativo (recibe un CanvasRenderingContext2D); toda la geometría
 * y el color vienen de la lógica pura de `cielo-render.ts` y
 * `cielo-extras.ts`. Orden de capas:
 *
 *   1. Gradiente del cielo (altitud solar × brillo)
 *      1b. Sombra lateral de la umbra que llega (~30 s antes de C2)
 *   2. Estrellas de fondo (solo visibles en Totalidad)
 *      2b. Planetas y estrellas brillantes reales (fundido según brillo)
 *   3. Resplandor de 360° en el horizonte (Totalidad y umbral cercano)
 *   4. Sol (o corona + disco negro en Totalidad) y Luna
 *      4b. Anillo de diamante y perlas de Baily (±4 s / ±1,5 s de C2/C3)
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
import {
  alfaCuerpo,
  anguloContacto,
  intensidadAnilloDiamante,
  intensidadPerlas,
  perlasBaily,
  proyectarCuerpos,
  SEMILLA_PERLAS,
  sombraLateral,
  type CuerpoCielo,
  type SombraLateral,
} from "./cielo-extras";

export { configEscena, type ConfigEscena };

/** Parámetros de un fotograma de la escena. */
export interface FotogramaEscena {
  cfg: ConfigEscena;
  posiciones: PosicionesSolLuna;
  /** Oscurecimiento [0, 1] en el instante dibujado. */
  obscuracion: number;
  /** `true` si el instante está dentro de la Totalidad (C2–C3). */
  enTotalidad: boolean;
  /** Instante dibujado en ms epoch (ventanas de los efectos de contacto). */
  tMs: number;
  /** C2 local en ms epoch, o `null` si el Observador no tiene Totalidad. */
  c2Ms: number | null;
  /** C3 local en ms epoch, o `null` si el Observador no tiene Totalidad. */
  c3Ms: number | null;
  /**
   * Planetas y estrellas reales a considerar (de `cuerposCielo`). Puede ir
   * vacío cuando el cielo es demasiado brillante para que se vean.
   */
  cuerpos: CuerpoCielo[];
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

/** Perlas de Baily fijas (semilla de la fecha del eclipse): reproducibles. */
const PERLAS = perlasBaily(SEMILLA_PERLAS);

/**
 * Capa 1b — sombra lateral: la umbra oscurece el cielo por el lado del
 * canvas por donde llega (ONO) en los ~30 s previos a C2, y se retira por
 * el contrario tras C3.
 */
function dibujarSombraLateral(
  ctx: CanvasRenderingContext2D,
  cfg: ConfigEscena,
  sombra: SombraLateral,
): void {
  if (sombra.intensidad <= 0.01) return;
  const alfa = 0.5 * sombra.intensidad;
  const grad = sombra.desdeIzquierda
    ? ctx.createLinearGradient(0, 0, cfg.ancho * 0.65, 0)
    : ctx.createLinearGradient(cfg.ancho, 0, cfg.ancho * 0.35, 0);
  grad.addColorStop(0, `rgba(8,10,24,${alfa.toFixed(3)})`);
  grad.addColorStop(1, "rgba(8,10,24,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cfg.ancho, yHorizonte(cfg));
}

/**
 * Capa 2b — planetas y estrellas brillantes reales, fundidos según el
 * brillo del cielo. Los planetas llevan halo y etiqueta; las estrellas,
 * punto y etiqueta más tenues. Venus fuera de encuadre se insinúa como
 * indicador en el borde.
 */
function dibujarCuerpos(
  ctx: CanvasRenderingContext2D,
  cfg: ConfigEscena,
  cuerpos: CuerpoCielo[],
  brillo: number,
): void {
  if (cuerpos.length === 0) return;
  for (const c of proyectarCuerpos(cuerpos, cfg)) {
    const alfa = alfaCuerpo(brillo, c.cuerpo.tipo);
    if (alfa <= 0.02) continue;

    if (!c.dentro) {
      // Indicador de borde (Venus, fuera del encuadre lateral).
      const enIzquierda = c.x < cfg.ancho / 2;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = enIzquierda ? "left" : "right";
      ctx.fillStyle = `rgba(255,255,255,${(0.55 * alfa).toFixed(3)})`;
      ctx.fillText(
        enIzquierda ? `◂ ${c.cuerpo.nombre}` : `${c.cuerpo.nombre} ▸`,
        enIzquierda ? 8 : cfg.ancho - 8,
        c.y,
      );
      continue;
    }

    const esPlaneta = c.cuerpo.tipo === "planeta";
    if (esPlaneta) {
      const halo = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.radio * 3.5);
      halo.addColorStop(0, `rgba(255,253,244,${(0.5 * alfa).toFixed(3)})`);
      halo.addColorStop(1, "rgba(255,253,244,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radio * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(255,255,255,${alfa.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.radio, 0, Math.PI * 2);
    ctx.fill();

    const alfaEtiqueta = alfa * (esPlaneta ? 0.7 : 0.45);
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = `rgba(255,255,255,${alfaEtiqueta.toFixed(3)})`;
    ctx.fillText(c.cuerpo.nombre, c.x, c.y - c.radio - 4);
  }
}

/**
 * Capa 4b — anillo de diamante: anillo fino de fotosfera alrededor del
 * limbo con un destello brillante asimétrico en el punto de contacto
 * (dirección Luna → Sol prolongada hasta el limbo).
 */
function dibujarAnilloDiamante(
  ctx: CanvasRenderingContext2D,
  sol: DiscoEscena,
  luna: DiscoEscena,
  intensidad: number,
): void {
  // Anillo fino de fotosfera sobre el limbo solar.
  ctx.strokeStyle = `rgba(255,250,238,${(0.3 + 0.55 * intensidad).toFixed(3)})`;
  ctx.lineWidth = Math.max(1.2, sol.radio * 0.025);
  ctx.beginPath();
  ctx.arc(sol.x, sol.y, sol.radio, 0, Math.PI * 2);
  ctx.stroke();

  // Destello en el punto de contacto.
  const ang = anguloContacto(sol, luna);
  const px = sol.x + Math.cos(ang) * sol.radio;
  const py = sol.y + Math.sin(ang) * sol.radio;
  const rNucleo = sol.radio * (0.18 + 0.45 * intensidad);
  const destello = ctx.createRadialGradient(px, py, 0, px, py, rNucleo * 3);
  destello.addColorStop(0, `rgba(255,255,252,${(0.95 * intensidad).toFixed(3)})`);
  destello.addColorStop(0.25, `rgba(255,244,214,${(0.55 * intensidad).toFixed(3)})`);
  destello.addColorStop(1, "rgba(255,236,190,0)");
  ctx.fillStyle = destello;
  ctx.beginPath();
  ctx.arc(px, py, rNucleo * 3, 0, Math.PI * 2);
  ctx.fill();

  // Aspas del diamante: cuatro puntas finas giradas 45° sobre el contacto.
  ctx.strokeStyle = `rgba(255,255,250,${(0.6 * intensidad).toFixed(3)})`;
  ctx.lineWidth = 1.2;
  const largo = rNucleo * 3.4;
  for (let k = 0; k < 2; k++) {
    const a = ang + Math.PI / 4 + (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(px - Math.cos(a) * largo, py - Math.sin(a) * largo);
    ctx.lineTo(px + Math.cos(a) * largo, py + Math.sin(a) * largo);
    ctx.stroke();
  }
}

/**
 * Capa 4b — perlas de Baily: cuentas irregulares de luz sobre el limbo
 * alrededor del punto de contacto, en los ~1,5 s pegados a C2/C3.
 */
function dibujarPerlas(
  ctx: CanvasRenderingContext2D,
  sol: DiscoEscena,
  luna: DiscoEscena,
  intensidad: number,
): void {
  const ang = anguloContacto(sol, luna);
  for (const p of PERLAS) {
    const a = ang + p.desfase;
    const px = sol.x + Math.cos(a) * sol.radio;
    const py = sol.y + Math.sin(a) * sol.radio;
    const r = sol.radio * 0.05 * (0.6 + p.tam);
    const alfa = intensidad * p.brillo;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
    grad.addColorStop(0, `rgba(255,255,250,${alfa.toFixed(3)})`);
    grad.addColorStop(0.4, `rgba(255,246,220,${(alfa * 0.5).toFixed(3)})`);
    grad.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r * 3, 0, Math.PI * 2);
    ctx.fill();
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

  // 1b. Sombra lateral: la umbra se siente venir (~30 s antes de C2).
  dibujarSombraLateral(
    ctx,
    cfg,
    sombraLateral(f.tMs, f.c2Ms, f.c3Ms, cfg.acimutCentro),
  );

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

  // 2b. Planetas y estrellas brillantes reales, con etiqueta sutil.
  dibujarCuerpos(ctx, cfg, f.cuerpos, brillo);

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

    // 4b. Anillo de diamante (±4 s) y perlas de Baily (±1,5 s) de C2/C3.
    const iAnillo = intensidadAnilloDiamante(f.tMs, f.c2Ms, f.c3Ms);
    if (iAnillo > 0) dibujarAnilloDiamante(ctx, esc.sol, esc.luna, iAnillo);
    const iPerlas = intensidadPerlas(f.tMs, f.c2Ms, f.c3Ms);
    if (iPerlas > 0) dibujarPerlas(ctx, esc.sol, esc.luna, iPerlas);
  }

  // 5–6. Horizonte y rótulos.
  dibujarHorizonte(ctx, cfg);
  dibujarMarcasAcimut(ctx, cfg);
}
