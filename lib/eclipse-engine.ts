/**
 * eclipse-engine — Motor astronómico local para el eclipse solar total
 * del 12 de agosto de 2026, construido sobre `astronomy-engine`.
 *
 * Módulo puro (sin React, sin estado global): todas las funciones son
 * deterministas a partir de un {@link Observador} y un instante de tiempo.
 *
 * Vocabulario (ver CONTEXT.md):
 * - **Observador**: punto lat/lon desde el que se calculan las
 *   circunstancias locales.
 * - **Contactos C1–C4**: instantes que delimitan el eclipse local.
 * - **Máximo**: instante de mayor Oscurecimiento.
 * - **Oscurecimiento** (obscuration): fracción [0, 1] del disco solar
 *   cubierta por la Luna. Siempre se calcula, nunca se tabula.
 * - **Totalidad**: intervalo C2–C3 (solo dentro de la Franja de totalidad).
 */

import {
  AngleBetween,
  Body,
  Equator,
  Horizon,
  KM_PER_AU,
  Observer,
  SearchLocalSolarEclipse,
  type EclipseEvent,
} from "astronomy-engine";

/** Radio del Sol en km (mismo valor que usa astronomy-engine internamente). */
const SUN_RADIUS_KM = 695700.0;
/**
 * Radio ecuatorial de la Luna en km (mismo valor que usa astronomy-engine
 * en sus propios cálculos de eclipses).
 */
const MOON_EQUATORIAL_RADIUS_KM = 1738.1;

const RAD2DEG = 180 / Math.PI;

/**
 * Inicio de la búsqueda del eclipse: un día antes del 12-08-2026.
 * `SearchLocalSolarEclipse` devuelve el primer eclipse visible desde el
 * Observador a partir de esta fecha, que para cualquier punto de España
 * es el eclipse total del 12 de agosto de 2026.
 */
const SEARCH_START = new Date("2026-08-11T00:00:00Z");

/**
 * El punto (lat/lon de un municipio español) desde el que se simula el
 * eclipse. Toda circunstancia local se calcula para un Observador.
 */
export interface Observador {
  /** Latitud geográfica en grados (norte positivo). */
  lat: number;
  /** Longitud geográfica en grados (este positivo, oeste negativo). */
  lon: number;
  /**
   * Elevación sobre el nivel del mar en metros. Si se omite se usa 0 m.
   * Su efecto en las circunstancias locales es de fracciones de segundo;
   * solo es relevante para observadores en alta montaña.
   */
  elevacion?: number;
}

/** Tipo de eclipse local: con Totalidad (`total`) o sin ella (`parcial`). */
export type TipoEclipse = "total" | "parcial";

/**
 * Un Contacto local: instante (UTC) y altitud del centro del Sol sobre el
 * horizonte en ese instante (grados, con refracción atmosférica).
 */
export interface Contacto {
  /** Instante del evento, en UTC. */
  instante: Date;
  /** Altitud del centro del Sol en grados sobre el horizonte. */
  altitudSolar: number;
}

/**
 * Circunstancias locales del eclipse del 12-08-2026 para un Observador:
 * Contactos C1–C4, Máximo, tipo, Oscurecimiento máximo y duración de la
 * Totalidad si la hay.
 */
export interface CircunstanciasLocales {
  /** `total` si el Observador está dentro de la Franja de totalidad. */
  tipo: TipoEclipse;
  /**
   * Oscurecimiento en el Máximo: fracción [0, 1] del disco solar cubierta.
   * Vale exactamente 1 dentro de la Franja de totalidad.
   */
  oscurecimientoMaximo: number;
  /** C1 — inicio de la parcialidad (primer contacto). */
  c1: Contacto;
  /**
   * C2 — inicio de la Totalidad. Solo existe si `tipo === "total"`.
   */
  c2?: Contacto;
  /** Máximo — instante de mayor Oscurecimiento. */
  maximo: Contacto;
  /**
   * C3 — fin de la Totalidad. Solo existe si `tipo === "total"`.
   */
  c3?: Contacto;
  /** C4 — fin de la parcialidad (último contacto). */
  c4: Contacto;
  /**
   * Duración de la Totalidad (C3 − C2) en segundos.
   * Solo existe si `tipo === "total"`.
   */
  duracionTotalidadSegundos?: number;
}

/** Posición aparente de un cuerpo (Sol o Luna) para un Observador. */
export interface PosicionCuerpo {
  /** Altitud sobre el horizonte en grados (con refracción atmosférica). */
  altitud: number;
  /** Acimut en grados (0 = norte, 90 = este). */
  acimut: number;
  /** Radio aparente del disco en grados. */
  radioAparente: number;
}

/**
 * Posiciones alt-az de Sol y Luna, radios aparentes y separación angular
 * entre sus centros en un instante dado — la geometría que necesita la
 * Vista Cielo para dibujar los dos discos.
 */
export interface PosicionesSolLuna {
  sol: PosicionCuerpo;
  luna: PosicionCuerpo;
  /**
   * Separación angular entre los centros de Sol y Luna en grados
   * (geometría topocéntrica sin refracción: la refracción desplaza a ambos
   * cuerpos casi por igual, por lo que apenas afecta a la separación).
   */
  separacionAngular: number;
}

/**
 * Motor de eclipse ligado a un Observador. Se crea con
 * {@link createEclipseEngine}; expone las circunstancias locales ya
 * calculadas y funciones puras dependientes del tiempo.
 */
export interface EclipseEngine {
  /** El Observador para el que se calculó este motor. */
  observador: Observador;
  /** Circunstancias locales del eclipse del 12-08-2026. */
  circunstancias: CircunstanciasLocales;
  /**
   * Oscurecimiento en el instante `t`: fracción [0, 1] del disco solar
   * cubierta por la Luna, calculada por geometría de discos (posiciones
   * topocéntricas, radios aparentes y separación angular).
   *
   * Devuelve 0 fuera del intervalo C1–C4 y 1 durante la Totalidad.
   */
  obscurationAt(t: Date): number;
  /**
   * Posiciones alt-az de Sol y Luna, radios aparentes y separación
   * angular en el instante `t`. Ver {@link PosicionesSolLuna}.
   */
  sunMoonPositions(t: Date): PosicionesSolLuna;
}

/** Geometría topocéntrica instantánea Sol–Luna (interna). */
interface GeometriaSolLuna {
  sol: PosicionCuerpo;
  luna: PosicionCuerpo;
  separacionAngular: number;
}

function toObserver(observador: Observador): Observer {
  return new Observer(observador.lat, observador.lon, observador.elevacion ?? 0);
}

/**
 * Calcula la geometría topocéntrica Sol–Luna en `t`: alt-az con refracción
 * para el render, radios aparentes a partir de las distancias topocéntricas
 * y separación angular entre centros a partir de los vectores topocéntricos
 * (sin refracción).
 */
function geometriaSolLuna(observer: Observer, t: Date): GeometriaSolLuna {
  const equSol = Equator(Body.Sun, t, observer, true, true);
  const equLuna = Equator(Body.Moon, t, observer, true, true);

  const horSol = Horizon(t, observer, equSol.ra, equSol.dec, "normal");
  const horLuna = Horizon(t, observer, equLuna.ra, equLuna.dec, "normal");

  // Radios aparentes: asin(radio físico / distancia topocéntrica).
  const radioSol =
    RAD2DEG * Math.asin(SUN_RADIUS_KM / (equSol.dist * KM_PER_AU));
  const radioLuna =
    RAD2DEG * Math.asin(MOON_EQUATORIAL_RADIUS_KM / (equLuna.dist * KM_PER_AU));

  return {
    sol: {
      altitud: horSol.altitude,
      acimut: horSol.azimuth,
      radioAparente: radioSol,
    },
    luna: {
      altitud: horLuna.altitude,
      acimut: horLuna.azimuth,
      radioAparente: radioLuna,
    },
    separacionAngular: AngleBetween(equSol.vec, equLuna.vec),
  };
}

/**
 * Fracción del disco solar cubierta por la Luna dada la separación angular
 * `d` entre centros y los radios aparentes `rs` (Sol) y `rm` (Luna), todos
 * en grados. Área de intersección de dos discos (fórmula de la lente)
 * normalizada por el área del disco solar.
 */
function oscurecimientoDiscos(d: number, rs: number, rm: number): number {
  if (d >= rs + rm) {
    return 0; // discos disjuntos: sin eclipse
  }
  if (d <= Math.abs(rm - rs)) {
    // Un disco contenido en el otro: Totalidad (o Luna dentro del Sol,
    // el caso anular, que no se da en el eclipse de 2026 desde España).
    return rm >= rs ? 1 : (rm * rm) / (rs * rs);
  }
  const a1 =
    rs * rs * Math.acos((d * d + rs * rs - rm * rm) / (2 * d * rs));
  const a2 =
    rm * rm * Math.acos((d * d + rm * rm - rs * rs) / (2 * d * rm));
  const a3 =
    0.5 *
    Math.sqrt(
      (-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm),
    );
  return (a1 + a2 - a3) / (Math.PI * rs * rs);
}

function toContacto(evento: EclipseEvent): Contacto {
  return { instante: evento.time.date, altitudSolar: evento.altitude };
}

/**
 * Calcula las Circunstancias locales del eclipse del 12-08-2026 para un
 * Observador usando `SearchLocalSolarEclipse` de astronomy-engine.
 *
 * @param observador - Punto de observación (lat/lon, elevación opcional).
 * @returns Contactos C1–C4, Máximo, tipo, Oscurecimiento máximo y
 *   duración de la Totalidad si la hay.
 */
export function circunstanciasLocales(
  observador: Observador,
): CircunstanciasLocales {
  const eclipse = SearchLocalSolarEclipse(SEARCH_START, toObserver(observador));

  const total =
    eclipse.total_begin !== undefined && eclipse.total_end !== undefined;

  const base: CircunstanciasLocales = {
    tipo: total ? "total" : "parcial",
    oscurecimientoMaximo: eclipse.obscuration,
    c1: toContacto(eclipse.partial_begin),
    maximo: toContacto(eclipse.peak),
    c4: toContacto(eclipse.partial_end),
  };

  if (total) {
    const c2 = toContacto(eclipse.total_begin!);
    const c3 = toContacto(eclipse.total_end!);
    base.c2 = c2;
    base.c3 = c3;
    base.duracionTotalidadSegundos =
      (c3.instante.getTime() - c2.instante.getTime()) / 1000;
  }

  return base;
}

/**
 * Crea el motor de eclipse para un Observador: calcula una sola vez las
 * Circunstancias locales y devuelve funciones puras para consultar el
 * Oscurecimiento y las posiciones de Sol y Luna en cualquier instante.
 *
 * @example
 * const engine = createEclipseEngine({ lat: 43.3614, lon: -5.8593 });
 * engine.circunstancias.tipo;                          // "total"
 * engine.obscurationAt(engine.circunstancias.maximo.instante); // 1
 * engine.sunMoonPositions(new Date("2026-08-12T18:27:00Z"));
 */
export function createEclipseEngine(observador: Observador): EclipseEngine {
  const observer = toObserver(observador);
  const circunstancias = circunstanciasLocales(observador);

  return {
    observador,
    circunstancias,

    obscurationAt(t: Date): number {
      const { sol, luna, separacionAngular } = geometriaSolLuna(observer, t);
      return oscurecimientoDiscos(
        separacionAngular,
        sol.radioAparente,
        luna.radioAparente,
      );
    },

    sunMoonPositions(t: Date): PosicionesSolLuna {
      return geometriaSolLuna(observer, t);
    },
  };
}
