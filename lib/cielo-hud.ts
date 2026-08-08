/**
 * cielo-hud — El «modo simulador» de la Vista Cielo (adenda del issue #39):
 * un overlay claramente NO físico, en lenguaje visual de instrumento (trazo
 * fino discontinuo, color frío tenue, opacidad baja), imposible de
 * confundir con el cielo fotográfico del render WebGL.
 *
 * - **Luna fantasma**: contorno discontinuo del disco lunar en su posición
 *   alt-az real cuando es invisible (antes de C1 / después de C4), con su
 *   etiqueta — se la ve venir y su primer mordisco en C1 no parece un bug.
 * - **Trayectorias**: arcos discontinuos del recorrido de Sol y Luna en la
 *   ventana completa de la Línea de tiempo, con marcas de hora.
 *
 * La lógica de visibilidad y las marcas son puras y testeables; el pintado
 * (canvas 2D superpuesto al canvas WebGL) vive en `dibujarHud`, imperativo
 * e idempotente como `cielo-draw`.
 */

import {
  escenaSolLuna,
  proyectarAltAz,
  type ConfigEscena,
} from "./cielo-render";
import type { PosicionesSolLuna } from "./eclipse-engine";

/** Color frío del instrumento (el "azul HUD" de la adenda). */
export const COLOR_HUD = "#7fd4ff";

/** Opacidad base del overlay. */
export const OPACIDAD_HUD = 0.6;

/** Ventana de fundido de la Luna fantasma alrededor de C1/C4 (ms). */
export const FUNDIDO_FANTASMA_MS = 90_000;

/**
 * Opacidad [0, 1] de la Luna fantasma: plena cuando la Luna real es
 * invisible (mucho antes de C1 o después de C4), fundido en los ~90 s
 * pegados a C1 (ahí el mordisco real toma el relevo) y de vuelta tras C4.
 * 0 durante todo el eclipse C1–C4.
 */
export function alfaLunaFantasma(
  tMs: number,
  c1Ms: number,
  c4Ms: number,
): number {
  if (tMs >= c1Ms && tMs <= c4Ms) return 0;
  const d = tMs < c1Ms ? c1Ms - tMs : tMs - c4Ms;
  return Math.min(1, d / FUNDIDO_FANTASMA_MS);
}

/**
 * ¿Debe arrancar activo el modo simulador? Por defecto sí fuera del
 * eclipse C1–C4 (ahí es cuando la Luna fantasma y las trayectorias
 * orientan); dentro, apagado para no ensuciar la Totalidad. La elección
 * del usuario, cuando exista, manda sobre este valor.
 */
export function hudActivoPorDefecto(
  tMs: number,
  c1Ms: number,
  c4Ms: number,
): boolean {
  return tMs < c1Ms || tMs > c4Ms;
}

/**
 * Instantes (ms de época) alineados a múltiplos de `intervaloMs` dentro
 * de [tMin, tMax]: las marcas de hora de las trayectorias. Con la ventana
 * 19:15–21:30 CEST e intervalo de 1 h salen las 20:00 y las 21:00.
 */
export function marcasHorarias(
  tMinMs: number,
  tMaxMs: number,
  intervaloMs: number,
): number[] {
  const marcas: number[] = [];
  const primera = Math.ceil(tMinMs / intervaloMs) * intervaloMs;
  for (let t = primera; t <= tMaxMs; t += intervaloMs) marcas.push(t);
  return marcas;
}

/** Un punto muestreado de las trayectorias de Sol y Luna. */
export interface PuntoTrayectoria {
  tMs: number;
  solAltitud: number;
  solAcimut: number;
  lunaAltitud: number;
  lunaAcimut: number;
}

/** Parámetros de un fotograma del HUD. */
export interface FotogramaHud {
  cfg: ConfigEscena;
  /** Trayectorias muestreadas de la ventana completa (memo del llamante). */
  trayectoria: PuntoTrayectoria[];
  /** Marcas horarias (ms de época) y su etiqueta ya formateada. */
  marcas: Array<{ tMs: number; etiqueta: string }>;
  /** Posiciones actuales (para el disco de la Luna fantasma). */
  posiciones: PosicionesSolLuna;
  /** Opacidad de la Luna fantasma (de {@link alfaLunaFantasma}). */
  alfaFantasma: number;
}

function trazarCamino(
  ctx: CanvasRenderingContext2D,
  cfg: ConfigEscena,
  puntos: Array<{ altitud: number; acimut: number }>,
): void {
  ctx.beginPath();
  let dibujando = false;
  for (const p of puntos) {
    if (p.altitud < -3) {
      dibujando = false;
      continue;
    }
    const { x, y } = proyectarAltAz(p.altitud, p.acimut, cfg);
    if (dibujando) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    dibujando = true;
  }
  ctx.stroke();
}

/** Interpola la posición del Sol en `tMs` sobre la trayectoria muestreada. */
function solEn(
  trayectoria: PuntoTrayectoria[],
  tMs: number,
): { altitud: number; acimut: number } | null {
  for (let i = 0; i < trayectoria.length - 1; i++) {
    const a = trayectoria[i];
    const b = trayectoria[i + 1];
    if (tMs >= a.tMs && tMs <= b.tMs) {
      const t = (tMs - a.tMs) / (b.tMs - a.tMs);
      return {
        altitud: a.solAltitud + (b.solAltitud - a.solAltitud) * t,
        acimut: a.solAcimut + (b.solAcimut - a.solAcimut) * t,
      };
    }
  }
  return null;
}

/**
 * Pinta el overlay del modo simulador sobre un canvas 2D transparente ya
 * dimensionado a la misma caja que el canvas WebGL. Idempotente: limpia y
 * repinta entero (pensado para llamarse una vez por frame).
 */
export function dibujarHud(
  ctx: CanvasRenderingContext2D,
  f: FotogramaHud,
): void {
  const { cfg } = f;
  ctx.clearRect(0, 0, cfg.ancho, cfg.alto);
  ctx.globalAlpha = OPACIDAD_HUD;
  ctx.strokeStyle = COLOR_HUD;
  ctx.fillStyle = COLOR_HUD;
  ctx.lineWidth = 1;

  // Trayectorias discontinuas de Sol y Luna (la de la Luna, más corta de
  // trazo, para distinguirlas de un vistazo).
  ctx.setLineDash([6, 6]);
  trazarCamino(
    ctx,
    cfg,
    f.trayectoria.map((p) => ({ altitud: p.solAltitud, acimut: p.solAcimut })),
  );
  ctx.setLineDash([2, 5]);
  trazarCamino(
    ctx,
    cfg,
    f.trayectoria.map((p) => ({ altitud: p.lunaAltitud, acimut: p.lunaAcimut })),
  );
  ctx.setLineDash([]);

  // Marcas de hora sobre la trayectoria solar.
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const marca of f.marcas) {
    const pos = solEn(f.trayectoria, marca.tMs);
    if (!pos || pos.altitud < -3) continue;
    const { x, y } = proyectarAltAz(pos.altitud, pos.acimut, cfg);
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    ctx.fillText(marca.etiqueta, x, y - 7);
  }

  // Luna fantasma: contorno discontinuo del disco lunar real (con el zoom
  // de la escena) cuando la Luna de verdad es invisible.
  if (f.alfaFantasma > 0.01) {
    const esc = escenaSolLuna(f.posiciones, cfg);
    if (esc.luna.y < cfg.alto + esc.luna.radio && esc.luna.y > -esc.luna.radio) {
      ctx.globalAlpha = OPACIDAD_HUD * f.alfaFantasma;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(esc.luna.x, esc.luna.y, esc.luna.radio, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textBaseline = "top";
      ctx.fillText("Luna", esc.luna.x, esc.luna.y + esc.luna.radio + 5);
    }
  }

  ctx.globalAlpha = 1;
}
