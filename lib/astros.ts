/**
 * astros — lógica pura de la Vista Astros (issue #37): la geometría
 * Sol–Luna–Tierra vista desde el espacio, con los conos de umbra y
 * penumbra proyectándose desde la Luna hacia la Tierra.
 *
 * Dos mitades, ambas puras (sin React, sin estado):
 *
 * 1. **Astronomía real** — {@link geometriaAstros}: para un instante `t`,
 *    la elongación de la Luna (su ángulo respecto al Sol en longitud
 *    eclíptica: 0° = Luna nueva), su latitud eclíptica y el punto donde el
 *    eje de la sombra (la recta Sol→Luna prolongada) cruza el plano de la
 *    Tierra, medido en radios terrestres desde el centro. La componente
 *    norte de ese desplazamiento es en esencia la γ (gamma) del eclipse:
 *    para el 12-08-2026 vale ≈ +0.90 en el máximo (17:46 UT), por eso la
 *    umbra roza el norte del globo (Ártico → Islandia → España).
 *
 * 2. **Proyección al diagrama didáctico** — el lienzo comprime las
 *    distancias (a escala real no se vería nada: el Sol quedaría a ~150 m
 *    de una Tierra de 1 cm) pero conserva lo que importa del cálculo real:
 *    la posición de la Luna sobre su órbita sigue la elongación real
 *    (amplificada por un factor documentado para que el avance se vea), la
 *    Luna queda colineal con el Sol y con el punto real del eje, y el
 *    contacto del cono con el disco terrestre está en las coordenadas
 *    reales (este/norte en radios terrestres). El disco de la Tierra se
 *    lee como el globo visto desde la sombra: arriba el norte, a la
 *    derecha el este del barrido — así el punto de contacto recorre la
 *    misma trayectoria que la umbra sobre el mapa (a las 18:27 UT, el
 *    norte de la Península).
 */

import { Body, Ecliptic, GeoVector, KM_PER_AU } from "astronomy-engine";

/** Radio ecuatorial de la Tierra en km (WGS84). */
export const RADIO_TIERRA_KM = 6378.137;

/**
 * Geometría real Sol–Luna–Tierra en un instante: lo que el diagrama
 * necesita del cálculo astronómico, en unidades físicas.
 */
export interface GeometriaAstros {
  /**
   * Elongación de la Luna: diferencia de longitud eclíptica Luna − Sol en
   * grados, normalizada a (−180, 180]. Vale 0 en la Luna nueva; durante el
   * eclipse pasa de negativa a positiva (la Luna adelanta al Sol).
   */
  elongacion: number;
  /** Latitud eclíptica geocéntrica de la Luna en grados (norte positivo). */
  latitudEclipticaLuna: number;
  /** Distancia Tierra–Luna en km (entre centros). */
  distanciaLunaKm: number;
  /**
   * Dónde cruza el eje de la sombra (recta Sol→Luna prolongada) el plano
   * de la Tierra, en radios terrestres desde el centro. `ejeNorte` es la
   * componente hacia el norte de la eclíptica (≈ la γ del eclipse);
   * `ejeEste` la componente en el plano de la eclíptica en el sentido del
   * avance de la sombra (crece con el tiempo: la umbra barre oeste→este).
   */
  ejeEste: number;
  ejeNorte: number;
  /** Módulo del desplazamiento del eje, en radios terrestres. */
  ejeDistancia: number;
  /**
   * ¿El eje de la umbra atraviesa la superficie terrestre? (criterio:
   * `ejeDistancia` < 1; el radio de la propia umbra añadiría apenas unas
   * centésimas). Mientras es `true` hay eclipse total en algún punto del
   * globo: para el 12-08-2026, de ~17:00 a ~18:33 UT.
   */
  umbraTocaTierra: boolean;
}

/**
 * Calcula la geometría real Sol–Luna–Tierra en `t` con astronomy-engine:
 * vectores geocéntricos de Sol y Luna en coordenadas eclípticas
 * (`Ecliptic(GeoVector(...))`), y el punto de la recta Sol→Luna más
 * cercano al centro de la Tierra descompuesto en la base {hacia el Sol,
 * este del barrido, norte eclíptico}.
 */
export function geometriaAstros(t: Date): GeometriaAstros {
  const sol = Ecliptic(GeoVector(Body.Sun, t, true));
  const luna = Ecliptic(GeoVector(Body.Moon, t, true));

  // Vectores geocéntricos eclípticos en km.
  const S = [
    sol.vec.x * KM_PER_AU,
    sol.vec.y * KM_PER_AU,
    sol.vec.z * KM_PER_AU,
  ] as const;
  const M = [
    luna.vec.x * KM_PER_AU,
    luna.vec.y * KM_PER_AU,
    luna.vec.z * KM_PER_AU,
  ] as const;

  // Eje de la sombra: recta que pasa por el Sol y la Luna. Punto de la
  // recta más cercano al origen (el centro de la Tierra): P = S − (S·u)u.
  const d = [M[0] - S[0], M[1] - S[1], M[2] - S[2]];
  const dMod = Math.hypot(d[0], d[1], d[2]);
  const u = [d[0] / dMod, d[1] / dMod, d[2] / dMod];
  const su = S[0] * u[0] + S[1] * u[1] + S[2] * u[2];
  const P = [S[0] - su * u[0], S[1] - su * u[1], S[2] - su * u[2]];

  // Base ortonormal: x̂ hacia el Sol, ẑ norte eclíptico, ŷ = ẑ×x̂ (el
  // sentido en que avanza la sombra sobre el globo: oeste→este).
  const sMod = Math.hypot(S[0], S[1], S[2]);
  const X = [S[0] / sMod, S[1] / sMod, S[2] / sMod];
  const Y = [-X[1], X[0], 0];
  const yMod = Math.hypot(Y[0], Y[1]);
  Y[0] /= yMod;
  Y[1] /= yMod;

  const ejeEste = (P[0] * Y[0] + P[1] * Y[1]) / RADIO_TIERRA_KM;
  const ejeNorte = P[2] / RADIO_TIERRA_KM;
  const ejeDistancia = Math.hypot(ejeEste, ejeNorte);

  let elongacion = luna.elon - sol.elon;
  if (elongacion > 180) elongacion -= 360;
  if (elongacion <= -180) elongacion += 360;

  return {
    elongacion,
    latitudEclipticaLuna: luna.elat,
    distanciaLunaKm: Math.hypot(M[0], M[1], M[2]),
    ejeEste,
    ejeNorte,
    ejeDistancia,
    umbraTocaTierra: ejeDistancia < 1,
  };
}

// ---------------------------------------------------------------------------
// Proyección al lienzo didáctico
// ---------------------------------------------------------------------------

/** Un punto del lienzo (coordenadas SVG: x a la derecha, y hacia abajo). */
export interface Punto {
  x: number;
  y: number;
}

/**
 * El lienzo del diagrama: dónde están el Sol y la Tierra, sus radios
 * dibujados y los factores didácticos. Las distancias están comprimidas y
 * los tamaños exagerados a propósito; los ángulos y desplazamientos que se
 * proyectan sobre él salen de {@link geometriaAstros}.
 */
export interface LienzoAstros {
  /** Centro del Sol (x); el Sol descansa sobre la línea de la eclíptica. */
  xSol: number;
  /** Centro de la Tierra (x), también sobre la eclíptica. */
  xTierra: number;
  /** Altura (y) de la línea de la eclíptica. */
  yEcliptica: number;
  radioSol: number;
  radioTierra: number;
  radioLuna: number;
  /** Radio (semieje mayor) de la órbita lunar dibujada. */
  radioOrbita: number;
  /**
   * Factor de amplificación de la elongación para situar la Luna sobre la
   * órbita dibujada. La elongación real durante la ventana es de apenas
   * ±1°: sin amplificar, la Luna no se movería ni 2 px. Con ×30 el avance
   * real de ~0.55°/h se convierte en un arco visible, conservando el
   * sentido y la proporción del movimiento.
   */
  ampliacionElongacion: number;
  /**
   * Desfase (grados) del arco visible de la órbita: el punto de
   * conjunción no se dibuja en el vértice de la elipse sino un poco más
   * adelante, como si viéramos la órbita algo girada. Sin este desfase el
   * coseno es plano en la conjunción y la Luna parecería clavada media
   * hora; con él, su avance en pantalla es monótono durante toda la
   * ventana (el sentido y la proporción siguen siendo los reales).
   */
  desfaseOrbital: number;
}

/** Lienzo por defecto de la Vista Astros (viewBox 0 0 960 440). */
export const LIENZO_ASTROS: LienzoAstros = {
  xSol: 110,
  xTierra: 810,
  yEcliptica: 230,
  radioSol: 72,
  radioTierra: 62,
  radioLuna: 14,
  radioOrbita: 170,
  ampliacionElongacion: 30,
  desfaseOrbital: 25,
};

/**
 * Recorte de la elongación amplificada (grados, antes del desfase): con el
 * desfase por defecto el ángulo total queda en (0°, 80°), donde el coseno
 * es monótono y la Luna nunca se dibuja tras la Tierra.
 */
const ELONGACION_AMPLIFICADA_MIN = -20;
const ELONGACION_AMPLIFICADA_MAX = 55;

/**
 * Punto del lienzo donde el eje de la sombra cruza el plano de la Tierra.
 * Es el mapeo directo de (`ejeEste`, `ejeNorte`) sobre el disco terrestre
 * (norte arriba, este del barrido a la derecha); si `ejeDistancia` > 1
 * cae fuera del disco — el cono pasa de largo, sin eclipse total.
 */
export function puntoEjeEnTierra(
  geo: GeometriaAstros,
  lienzo: LienzoAstros = LIENZO_ASTROS,
): Punto {
  return {
    x: lienzo.xTierra + geo.ejeEste * lienzo.radioTierra,
    y: lienzo.yEcliptica - geo.ejeNorte * lienzo.radioTierra,
  };
}

/**
 * Punto de contacto de la umbra con la superficie: el punto del eje si el
 * cono realmente toca la Tierra, `null` si pasa de largo.
 */
export function contactoUmbra(
  geo: GeometriaAstros,
  lienzo: LienzoAstros = LIENZO_ASTROS,
): Punto | null {
  return geo.umbraTocaTierra ? puntoEjeEnTierra(geo, lienzo) : null;
}

/**
 * Posición de la Luna en el diagrama. La abscisa sigue la órbita dibujada
 * con la elongación real amplificada (0° = exactamente entre el Sol y la
 * Tierra); la ordenada se elige para que Sol, Luna y punto del eje queden
 * colineales — así el eje de la sombra dibujado pasa por el centro del Sol
 * y cruza el plano de la Tierra exactamente donde lo hace el eje real.
 */
export function posicionLunaDiagrama(
  geo: GeometriaAstros,
  lienzo: LienzoAstros = LIENZO_ASTROS,
): Punto {
  const amplificada = Math.max(
    ELONGACION_AMPLIFICADA_MIN,
    Math.min(ELONGACION_AMPLIFICADA_MAX, geo.elongacion * lienzo.ampliacionElongacion),
  );
  const anguloGrados = amplificada + lienzo.desfaseOrbital;
  const x =
    lienzo.xTierra -
    lienzo.radioOrbita * Math.cos((anguloGrados * Math.PI) / 180);

  const eje = puntoEjeEnTierra(geo, lienzo);
  const fraccion = (x - lienzo.xSol) / (eje.x - lienzo.xSol);
  const y = lienzo.yEcliptica + (eje.y - lienzo.yEcliptica) * fraccion;

  return { x, y };
}

/**
 * Posición de la Luna en el diagrama en un instante dado (ms de época):
 * atajo puro sobre {@link geometriaAstros} + {@link posicionLunaDiagrama}
 * para muestrear la órbita dibujada — la estela de la Luna y las marcas
 * temporales (C1/Máx/C4) sobre su recorrido.
 */
export function posicionLunaEn(
  tMs: number,
  lienzo: LienzoAstros = LIENZO_ASTROS,
): Punto {
  return posicionLunaDiagrama(geometriaAstros(new Date(tMs)), lienzo);
}

/**
 * Estela de la Luna: sus posiciones en el diagrama en instantes pasados
 * cuantizados a la rejilla de `pasoMs` (múltiplos desde la época), de la
 * más reciente a la más antigua, sin retroceder más allá de `tMinMs` ni
 * devolver más de `maxPuntos`.
 *
 * La cuantización estabiliza la estela entre frames: solo cambia cuando
 * el reloj cruza un múltiplo de `pasoMs`, así el pintor puede saltarse el
 * recálculo en todos los demás frames.
 */
export function estelaLuna(
  tMs: number,
  tMinMs: number,
  pasoMs: number,
  maxPuntos: number,
  lienzo: LienzoAstros = LIENZO_ASTROS,
): Punto[] {
  const base = Math.floor(tMs / pasoMs) * pasoMs;
  const puntos: Punto[] = [];
  for (let k = 0; k < maxPuntos; k++) {
    const t = base - k * pasoMs;
    if (t < tMinMs) break;
    puntos.push(posicionLunaEn(t, lienzo));
  }
  return puntos;
}

/** Puntos de tangencia desde un punto exterior `p` al círculo (c, r). */
function tangentes(p: Punto, c: Punto, r: number): [Punto, Punto] {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const d = Math.hypot(dx, dy);
  const base = Math.atan2(dy, dx);
  // Ángulo en el centro entre la dirección a `p` y cada punto de tangencia.
  const apertura = Math.acos(Math.min(1, r / d));
  return [
    { x: c.x + r * Math.cos(base + apertura), y: c.y + r * Math.sin(base + apertura) },
    { x: c.x + r * Math.cos(base - apertura), y: c.y + r * Math.sin(base - apertura) },
  ];
}

/**
 * Cono de umbra dibujado: triángulo que sale tangente al disco lunar y
 * converge en el punto del eje sobre el plano de la Tierra (el vértice del
 * cono). Cuando el eje cae dentro del disco terrestre, ese vértice es el
 * punto de contacto: eclipse total ahí.
 */
export function conoUmbra(
  luna: Punto,
  eje: Punto,
  lienzo: LienzoAstros = LIENZO_ASTROS,
): [Punto, Punto, Punto] {
  const [t1, t2] = tangentes(eje, luna, lienzo.radioLuna);
  return [t1, eje, t2];
}

/**
 * Cono de penumbra dibujado: las dos rectas tangentes al disco lunar que
 * se cruzan en el punto interior del eje entre el Sol y la Luna (el
 * vértice interno real de la penumbra, calculado con los radios dibujados)
 * y divergen tras la Luna. Devuelve el cuadrilátero [tangencia 1, extremo
 * lejano 1, extremo lejano 2, tangencia 2] cortado en `xFin`.
 */
export function conoPenumbra(
  luna: Punto,
  eje: Punto,
  xFin: number,
  lienzo: LienzoAstros = LIENZO_ASTROS,
): [Punto, Punto, Punto, Punto] {
  // Dirección del eje de la sombra (de la Tierra hacia el Sol) para situar
  // el vértice interno: a D·r_luna/(r_sol + r_luna) de la Luna, siendo D
  // la distancia dibujada Luna–Sol.
  const sol: Punto = { x: lienzo.xSol, y: lienzo.yEcliptica };
  const dSol = Math.hypot(sol.x - luna.x, sol.y - luna.y);
  const dVertice = (dSol * lienzo.radioLuna) / (lienzo.radioSol + lienzo.radioLuna);
  const vertice: Punto = {
    x: luna.x + ((sol.x - luna.x) / dSol) * dVertice,
    y: luna.y + ((sol.y - luna.y) / dSol) * dVertice,
  };

  const [t1, t2] = tangentes(vertice, luna, lienzo.radioLuna);
  const extender = (t: Punto): Punto => {
    const dx = t.x - vertice.x;
    const dy = t.y - vertice.y;
    const k = (xFin - t.x) / dx;
    return { x: xFin, y: t.y + dy * k };
  };
  return [t1, extender(t1), extender(t2), t2];
}

/**
 * Trayectoria del punto del eje sobre el disco terrestre entre dos
 * instantes (solo los pasos en que la umbra toca la Tierra): la estela que
 * el cono barre sobre el globo, muestreada cada `pasoMs`.
 */
export function trayectoriaContacto(
  tInicio: number,
  tFin: number,
  pasoMs: number,
  lienzo: LienzoAstros = LIENZO_ASTROS,
): Punto[] {
  const puntos: Punto[] = [];
  for (let t = tInicio; t <= tFin; t += pasoMs) {
    const geo = geometriaAstros(new Date(t));
    if (geo.umbraTocaTierra) puntos.push(puntoEjeEnTierra(geo, lienzo));
  }
  return puntos;
}
