/**
 * cielo-limbo — Lógica pura del limbo lunar irregular y de las perlas de
 * Baily físicas (adenda del issue #39): los astros no son círculos planos.
 *
 * El borde de la Luna tiene montañas y valles de ~2–4 segundos de arco
 * (frente a un radio aparente de ~940″): una rugosidad de ~0,3% del radio.
 * Ese relieve es la causa física de las perlas de Baily: en C2/C3 los
 * últimos rayos de fotosfera pasan por los VALLES más profundos del limbo
 * cercanos al punto de contacto. Aquí las perlas se derivan de ese perfil
 * en vez de sortearse sobre un círculo liso.
 *
 * El perfil es una serie de Fourier con semilla fija (la fecha del
 * eclipse): determinista, periódico en 2π y reproducible en el shader
 * (los armónicos viajan como uniformes).
 */

/** Semilla fija del relieve del limbo: la fecha del eclipse. */
export const SEMILLA_LIMBO = 20260812;

/** Número de armónicos del perfil (también en el shader). */
export const NUM_ARMONICOS_LIMBO = 8;

/**
 * Rugosidad física del limbo como fracción del radio lunar (~0,3% real).
 * El render la exagera un poco (ver {@link RUGOSIDAD_RENDER}) para que se
 * intuya a la escala del zoom; las perlas usan el perfil normalizado.
 */
export const RUGOSIDAD_FISICA = 0.003;

/**
 * Rugosidad usada por el render (fracción del radio): ×3 la física para
 * que el limbo deje de ser un círculo perfecto también en pantalla
 * (≈0,5–1 px según resolución) sin caer en la caricatura.
 */
export const RUGOSIDAD_RENDER = 0.009;

/** Un armónico del perfil del limbo: frecuencia entera, amplitud y fase. */
export interface ArmonicoLimbo {
  frecuencia: number;
  amplitud: number;
  fase: number;
}

/**
 * Los armónicos del perfil del limbo para una semilla: frecuencias enteras
 * crecientes (6 … ~45, detalle de escala lunar realista) con amplitudes
 * decrecientes 1/k y fases del LCG de Park–Miller (el mismo generador que
 * el resto del proyecto). Deterministas: mismos armónicos en cada render.
 */
export function armonicosLimbo(semilla: number): ArmonicoLimbo[] {
  let s = semilla % 2147483647;
  if (s <= 0) s += 2147483646;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const armonicos: ArmonicoLimbo[] = [];
  for (let k = 0; k < NUM_ARMONICOS_LIMBO; k++) {
    armonicos.push({
      frecuencia: 6 + k * 5 + Math.floor(rnd() * 3),
      amplitud: (0.55 + 0.45 * rnd()) / (1 + k * 0.6),
      fase: rnd() * Math.PI * 2,
    });
  }
  // Normaliza para que el máximo teórico sea 1 (suma de amplitudes).
  const suma = armonicos.reduce((acc, a) => acc + a.amplitud, 0);
  for (const a of armonicos) a.amplitud /= suma;
  return armonicos;
}

/** Armónicos del eclipse (semilla fija), listos para CPU y shader. */
export const ARMONICOS_ECLIPSE = armonicosLimbo(SEMILLA_LIMBO);

/**
 * Perfil del limbo lunar en [-1, 1]: desviación radial normalizada en el
 * ángulo `ang` (radianes, convención canvas). Positivo = montaña,
 * negativo = valle. Periódico en 2π y determinista.
 */
export function rugosidadLimbo(
  ang: number,
  armonicos: ArmonicoLimbo[] = ARMONICOS_ECLIPSE,
): number {
  let r = 0;
  for (const a of armonicos) {
    r += a.amplitud * Math.cos(a.frecuencia * ang + a.fase);
  }
  return r;
}

/** Una perla de Baily anclada a un valle real del limbo. */
export interface PerlaLimbo {
  /** Ángulo absoluto del valle sobre el limbo (radianes). */
  angulo: number;
  /** Profundidad del valle [0, 1] (1 = el más profundo del perfil). */
  profundidad: number;
}

/** Medio arco (radianes) alrededor del contacto donde pueden lucir perlas. */
export const ARCO_PERLAS_LIMBO = 0.85;

/**
 * Perlas de Baily físicas: los valles locales del perfil del limbo dentro
 * de ±{@link ARCO_PERLAS_LIMBO} del ángulo de contacto. Cada valle con
 * `rugosidad < 0` cuenta; su brillo/tamaño escala con la profundidad
 * (los valles más hondos dejan pasar más fotosfera). Devuelve 1–6 perlas
 * ordenadas por ángulo; deterministas para un ángulo de contacto dado.
 */
export function perlasDesdeLimbo(
  anguloContacto: number,
  armonicos: ArmonicoLimbo[] = ARMONICOS_ECLIPSE,
): PerlaLimbo[] {
  const PASOS = 96;
  const perlas: PerlaLimbo[] = [];
  const paso = (2 * ARCO_PERLAS_LIMBO) / PASOS;
  let previa = rugosidadLimbo(anguloContacto - ARCO_PERLAS_LIMBO - paso, armonicos);
  let actual = rugosidadLimbo(anguloContacto - ARCO_PERLAS_LIMBO, armonicos);
  for (let i = 0; i <= PASOS; i++) {
    const ang = anguloContacto - ARCO_PERLAS_LIMBO + i * paso;
    const siguiente = rugosidadLimbo(ang + paso, armonicos);
    // Mínimo local por debajo de cero: un valle de verdad.
    if (actual < previa && actual <= siguiente && actual < 0) {
      perlas.push({ angulo: ang, profundidad: Math.min(1, -actual * 2) });
    }
    previa = actual;
    actual = siguiente;
  }
  // Las 6 más profundas como mucho, en orden de ángulo.
  return perlas
    .sort((a, b) => b.profundidad - a.profundidad)
    .slice(0, 6)
    .sort((a, b) => a.angulo - b.angulo);
}
