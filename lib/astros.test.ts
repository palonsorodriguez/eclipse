/**
 * Tests de lib/astros: la lógica pura de la Vista Astros — geometría real
 * Sol–Luna–Tierra por instante, mapeo al diagrama didáctico (posición de
 * la Luna, desplazamiento del eje de la sombra, punto de contacto) y la
 * ventana en que el cono de la umbra toca la Tierra.
 *
 * Las cifras de referencia son las del eclipse del 12-08-2026: máximo
 * global a las 17:46 UT con γ ≈ +0.90 (el eje pasa muy al norte del centro
 * de la Tierra), umbra sobre la superficie de ~17:00 a ~18:33 UT y llegada
 * al norte de la Península a las 18:27 UT (20:27 CEST).
 */

import { describe, expect, test } from "vitest";
import {
  conoPenumbra,
  conoUmbra,
  contactoUmbra,
  estelaLuna,
  geometriaAstros,
  LIENZO_ASTROS,
  posicionLunaDiagrama,
  posicionLunaEn,
  puntoEjeEnTierra,
  trayectoriaContacto,
} from "./astros";

const MAXIMO_GLOBAL = new Date("2026-08-12T17:46:00Z");
const LLEGADA_PENINSULA = new Date("2026-08-12T18:27:00Z");
const FIN_LINEA_TIEMPO = new Date("2026-08-12T19:30:00Z");

describe("geometriaAstros", () => {
  test("en el máximo global la Luna está en conjunción y el eje pasa al norte (γ ≈ +0.9)", () => {
    const geo = geometriaAstros(MAXIMO_GLOBAL);

    // Luna nueva: elongación casi nula.
    expect(Math.abs(geo.elongacion)).toBeLessThan(0.2);
    // El eje de la sombra cruza muy al norte del centro: la γ del eclipse.
    expect(geo.ejeNorte).toBeGreaterThan(0.85);
    expect(geo.ejeNorte).toBeLessThan(0.95);
    expect(geo.umbraTocaTierra).toBe(true);
    // Luna cerca del perigeo (por eso el eclipse es total y no anular).
    expect(geo.distanciaLunaKm).toBeGreaterThan(360_000);
    expect(geo.distanciaLunaKm).toBeLessThan(375_000);
    // Al norte de la eclíptica, cerca del nodo descendente.
    expect(geo.latitudEclipticaLuna).toBeGreaterThan(0.7);
    expect(geo.latitudEclipticaLuna).toBeLessThan(1.1);
  });

  test("la elongación crece con el tiempo y cambia de signo en el máximo (la Luna adelanta al Sol)", () => {
    const antes = geometriaAstros(new Date("2026-08-12T17:15:00Z"));
    const despues = geometriaAstros(LLEGADA_PENINSULA);

    expect(antes.elongacion).toBeLessThan(0);
    expect(despues.elongacion).toBeGreaterThan(0);
    expect(despues.elongacion).toBeGreaterThan(antes.elongacion);
  });

  test("a las 18:27 UT el eje toca la Tierra cerca del limbo, al norte y al este (la Península)", () => {
    const geo = geometriaAstros(LLEGADA_PENINSULA);

    expect(geo.umbraTocaTierra).toBe(true);
    // Cerca del final del recorrido: casi rozando el borde del disco.
    expect(geo.ejeDistancia).toBeGreaterThan(0.9);
    expect(geo.ejeDistancia).toBeLessThan(1);
    expect(geo.ejeNorte).toBeGreaterThan(0); // norte
    expect(geo.ejeEste).toBeGreaterThan(0); // tramo final del barrido
  });

  test("la ventana en que la umbra toca la Tierra es contigua, ~17:00–18:33 UT", () => {
    const minuto = 60_000;
    const desde = Date.UTC(2026, 7, 12, 16, 0);
    const hasta = Date.UTC(2026, 7, 12, 20, 0);

    const tocando: number[] = [];
    for (let t = desde; t <= hasta; t += minuto) {
      if (geometriaAstros(new Date(t)).umbraTocaTierra) tocando.push(t);
    }

    expect(tocando.length).toBeGreaterThan(0);
    const inicio = tocando[0];
    const fin = tocando[tocando.length - 1];
    // Contigua: sin huecos entre el primer y el último minuto.
    expect(tocando.length).toBe((fin - inicio) / minuto + 1);
    // Bordes de la ventana, con un minuto de margen.
    expect(inicio).toBeGreaterThanOrEqual(Date.UTC(2026, 7, 12, 16, 55));
    expect(inicio).toBeLessThanOrEqual(Date.UTC(2026, 7, 12, 17, 5));
    expect(fin).toBeGreaterThanOrEqual(Date.UTC(2026, 7, 12, 18, 28));
    expect(fin).toBeLessThanOrEqual(Date.UTC(2026, 7, 12, 18, 38));
    // El máximo global y la llegada a la Península caen dentro.
    expect(tocando).toContain(MAXIMO_GLOBAL.getTime());
    expect(tocando).toContain(LLEGADA_PENINSULA.getTime());
    // Al final de la Línea de tiempo la umbra ya dejó la superficie.
    expect(geometriaAstros(FIN_LINEA_TIEMPO).umbraTocaTierra).toBe(false);
  });
});

describe("proyección al diagrama", () => {
  test("la Luna queda entre el Sol y la Tierra, colineal con el Sol y el punto del eje", () => {
    for (const hhmm of ["17:15", "17:46", "18:27", "19:15"]) {
      const geo = geometriaAstros(new Date(`2026-08-12T${hhmm}:00Z`));
      const luna = posicionLunaDiagrama(geo);
      const eje = puntoEjeEnTierra(geo);

      expect(luna.x).toBeGreaterThan(LIENZO_ASTROS.xSol + LIENZO_ASTROS.radioSol);
      expect(luna.x).toBeLessThan(LIENZO_ASTROS.xTierra - LIENZO_ASTROS.radioTierra);

      // Colinealidad Sol–Luna–eje: el eje dibujado pasa por el centro del Sol.
      const cruz =
        (luna.x - LIENZO_ASTROS.xSol) * (eje.y - LIENZO_ASTROS.yEcliptica) -
        (luna.y - LIENZO_ASTROS.yEcliptica) * (eje.x - LIENZO_ASTROS.xSol);
      expect(Math.abs(cruz)).toBeLessThan(1e-9);
    }
  });

  test("la Luna avanza por su órbita a lo largo de la Línea de tiempo (x monótona creciente)", () => {
    const horas = ["17:15", "17:45", "18:15", "18:45", "19:15"];
    const xs = horas.map(
      (hhmm) =>
        posicionLunaDiagrama(geometriaAstros(new Date(`2026-08-12T${hhmm}:00Z`))).x,
    );
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  test("a las 18:27 UT el contacto cae dentro del disco, en el cuadrante norte-este", () => {
    const geo = geometriaAstros(LLEGADA_PENINSULA);
    const contacto = contactoUmbra(geo);

    expect(contacto).not.toBeNull();
    const dx = contacto!.x - LIENZO_ASTROS.xTierra;
    const dy = contacto!.y - LIENZO_ASTROS.yEcliptica;
    expect(Math.hypot(dx, dy)).toBeLessThan(LIENZO_ASTROS.radioTierra);
    expect(dy).toBeLessThan(0); // norte: por encima del centro
    expect(dx).toBeGreaterThan(0); // este del barrido: a la derecha
  });

  test("cuando el eje pasa de largo no hay contacto", () => {
    const geo = geometriaAstros(FIN_LINEA_TIEMPO);
    expect(contactoUmbra(geo)).toBeNull();
    // Pero el punto del eje sigue definido, fuera del disco.
    const eje = puntoEjeEnTierra(geo);
    const distancia = Math.hypot(
      eje.x - LIENZO_ASTROS.xTierra,
      eje.y - LIENZO_ASTROS.yEcliptica,
    );
    expect(distancia).toBeGreaterThan(LIENZO_ASTROS.radioTierra);
  });

  test("el contacto barre el disco de oeste a este al avanzar el reloj", () => {
    const temprano = contactoUmbra(geometriaAstros(new Date("2026-08-12T17:15:00Z")));
    const tarde = contactoUmbra(geometriaAstros(LLEGADA_PENINSULA));
    expect(temprano).not.toBeNull();
    expect(tarde).not.toBeNull();
    expect(tarde!.x).toBeGreaterThan(temprano!.x);
  });
});

describe("conos de sombra", () => {
  const geo = geometriaAstros(MAXIMO_GLOBAL);
  const luna = posicionLunaDiagrama(geo);
  const eje = puntoEjeEnTierra(geo);

  test("la umbra converge: triángulo tangente al disco lunar con vértice en el punto del eje", () => {
    const [t1, vertice, t2] = conoUmbra(luna, eje);

    expect(vertice).toEqual(eje);
    // Las bases del triángulo son tangentes al disco lunar.
    expect(Math.hypot(t1.x - luna.x, t1.y - luna.y)).toBeCloseTo(
      LIENZO_ASTROS.radioLuna,
      6,
    );
    expect(Math.hypot(t2.x - luna.x, t2.y - luna.y)).toBeCloseTo(
      LIENZO_ASTROS.radioLuna,
      6,
    );
    // El cono se estrecha: la boca en la Luna es más ancha que el vértice.
    expect(Math.hypot(t1.x - t2.x, t1.y - t2.y)).toBeGreaterThan(0);
  });

  test("la penumbra diverge: tras la Luna es más ancha que en la Luna", () => {
    const xFin = 812;
    const [t1, f1, f2, t2] = conoPenumbra(luna, eje, xFin);

    expect(f1.x).toBe(xFin);
    expect(f2.x).toBe(xFin);
    const anchoLuna = Math.hypot(t1.x - t2.x, t1.y - t2.y);
    const anchoFinal = Math.hypot(f1.x - f2.x, f1.y - f2.y);
    expect(anchoFinal).toBeGreaterThan(anchoLuna);
    // Y envuelve al disco terrestre casi entero: más ancha que la Tierra no
    // hace falta, pero sí claramente más que la umbra.
    expect(anchoFinal).toBeGreaterThan(LIENZO_ASTROS.radioTierra);
  });
});

describe("posicionLunaEn — marcas temporales sobre la órbita", () => {
  test("las marcas C1/Máx/C4 caen en el hueco Sol–Tierra, al norte y en orden oeste→este", () => {
    // Contactos de referencia del 12-08-2026 para Madrid (~17:37, 18:32
    // y 19:24 UT): la regla temporal que la Vista Astros pinta sobre la
    // órbita dibujada.
    const c1 = posicionLunaEn(Date.UTC(2026, 7, 12, 17, 37));
    const max = posicionLunaEn(Date.UTC(2026, 7, 12, 18, 32));
    const c4 = posicionLunaEn(Date.UTC(2026, 7, 12, 19, 24));

    expect(c1.x).toBeLessThan(max.x);
    expect(max.x).toBeLessThan(c4.x);
    for (const p of [c1, max, c4]) {
      expect(p.x).toBeGreaterThan(LIENZO_ASTROS.xSol + LIENZO_ASTROS.radioSol);
      expect(p.x).toBeLessThan(LIENZO_ASTROS.xTierra - LIENZO_ASTROS.radioTierra);
      // El recorrido va al norte de la eclíptica (la Luna pasa por encima).
      expect(p.y).toBeLessThan(LIENZO_ASTROS.yEcliptica);
    }
  });
});

describe("estelaLuna", () => {
  const PASO = 10 * 60_000;
  const T_INICIO_VENTANA = Date.UTC(2026, 7, 12, 17, 15);

  test("sigue a la Luna: posiciones pasadas, la más reciente primero, hacia el oeste", () => {
    const t = Date.UTC(2026, 7, 12, 18, 27);
    const puntos = estelaLuna(t, T_INICIO_VENTANA, PASO, 6);

    expect(puntos.length).toBe(6);
    // Hacia atrás en el tiempo, la Luna estaba cada vez más al oeste.
    for (let i = 1; i < puntos.length; i++) {
      expect(puntos[i].x).toBeLessThan(puntos[i - 1].x);
    }
    // Ningún punto de la estela se adelanta a la Luna actual.
    const luna = posicionLunaEn(t);
    for (const p of puntos) {
      expect(p.x).toBeLessThanOrEqual(luna.x);
    }
  });

  test("se corta en tMin y es estable dentro de cada paso de la rejilla", () => {
    // Rejilla de 10 min: desde las 17:41 solo existen 17:40, 17:30 y
    // 17:20 (las 17:10 quedan antes de la ventana).
    const t = Date.UTC(2026, 7, 12, 17, 41);
    expect(estelaLuna(t, T_INICIO_VENTANA, PASO, 8).length).toBe(3);

    // Dentro del mismo paso la estela no cambia: el pintor solo recalcula
    // al cruzar un múltiplo del paso.
    expect(estelaLuna(t + 4 * 60_000, T_INICIO_VENTANA, PASO, 8)).toEqual(
      estelaLuna(Date.UTC(2026, 7, 12, 17, 40), T_INICIO_VENTANA, PASO, 8),
    );
  });
});

describe("trayectoriaContacto", () => {
  test("muestrea solo los instantes en que la umbra toca, dentro del disco", () => {
    const puntos = trayectoriaContacto(
      Date.UTC(2026, 7, 12, 17, 15),
      Date.UTC(2026, 7, 12, 19, 30),
      5 * 60_000,
    );

    // De 17:15 a ~18:33 hay ~16 muestras de 5 min; después ya no toca.
    expect(puntos.length).toBeGreaterThan(10);
    expect(puntos.length).toBeLessThan(20);
    for (const p of puntos) {
      const distancia = Math.hypot(
        p.x - LIENZO_ASTROS.xTierra,
        p.y - LIENZO_ASTROS.yEcliptica,
      );
      expect(distancia).toBeLessThanOrEqual(LIENZO_ASTROS.radioTierra);
    }
  });
});
