import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { crearRelojLineaDeTiempo } from "@/lib/reloj-tiempo";
import type { ContactosMs } from "@/lib/linea-tiempo-velocidad";

// ---------------------------------------------------------------------------
// requestAnimationFrame de mentira (frontera del sistema): una cola de
// callbacks pendientes que los tests drenan a mano, frame a frame, con el
// timestamp que quieran. Permite observar desde fuera si el bucle sigue
// programando frames.
// ---------------------------------------------------------------------------

let pendientes: Map<number, FrameRequestCallback>;
let siguienteId: number;
let ahora: number;

beforeEach(() => {
  pendientes = new Map();
  siguienteId = 1;
  ahora = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    const id = siguienteId++;
    pendientes.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    pendientes.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Avanza el reloj de pared `dtMs` y dispara los frames pendientes. */
function avanzarFrame(dtMs: number): void {
  ahora += dtMs;
  const callbacks = [...pendientes.values()];
  pendientes.clear();
  for (const cb of callbacks) cb(ahora);
}

/** Rango corto y redondo para leer los tiempos de los tests de un vistazo. */
const T_MIN = 0;
const T_MAX = 600_000; // 10 min simulados

describe("crearRelojLineaDeTiempo", () => {
  test("dos suscriptores reciben el mismo tiempo en cada frame", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    const cielo: number[] = [];
    const mapa: number[] = [];
    reloj.suscribirFrame((t) => cielo.push(t));
    reloj.suscribirFrame((t) => mapa.push(t));

    reloj.alternarReproduccion();
    avanzarFrame(16); // primer frame del bucle: dt 0
    avanzarFrame(16);
    avanzarFrame(16);

    // Cada vista recibe su pintado inicial síncrono y después los mismos
    // frames del bucle común: historiales idénticos.
    expect(mapa).toEqual(cielo);
    expect(mapa.at(-1)).toBeGreaterThan(T_MIN);
  });

  test("play/pausa desde cualquier barra actúa sobre el reloj común", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    const cielo: number[] = [];
    const mapa: number[] = [];
    reloj.suscribirFrame((t) => cielo.push(t));
    reloj.suscribirFrame((t) => mapa.push(t));

    // "Play" pulsado en la barra de una vista: avanzan las dos.
    reloj.alternarReproduccion();
    expect(reloj.leerReproduciendo()).toBe(true);
    avanzarFrame(16);
    avanzarFrame(16);
    const trasPlay = mapa.at(-1)!;
    expect(trasPlay).toBeGreaterThan(T_MIN);
    expect(cielo.at(-1)).toBe(trasPlay);

    // "Pausa" pulsada en la barra de la otra: se detienen las dos.
    reloj.alternarReproduccion();
    expect(reloj.leerReproduciendo()).toBe(false);
    avanzarFrame(16);
    avanzarFrame(16);
    expect(mapa.at(-1)).toBe(trasPlay);
    expect(cielo.at(-1)).toBe(trasPlay);
  });

  test("saltarA desde cualquier barra repinta ambas vistas de inmediato", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    const cielo: number[] = [];
    const mapa: number[] = [];
    reloj.suscribirFrame((t) => cielo.push(t));
    reloj.suscribirFrame((t) => mapa.push(t));

    reloj.saltarA(120_000);
    expect(cielo.at(-1)).toBe(120_000);
    expect(mapa.at(-1)).toBe(120_000);
    expect(reloj.leerTUi()).toBe(120_000);

    // El salto se recorta al rango de la Línea de tiempo.
    reloj.saltarA(T_MAX + 99_999);
    expect(cielo.at(-1)).toBe(T_MAX);
    expect(mapa.at(-1)).toBe(T_MAX);
  });

  test("el bucle arranca con el primer suscriptor y se detiene con el último", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    expect(pendientes.size).toBe(0); // sin suscriptores no hay bucle

    const bajaCielo = reloj.suscribirFrame(() => {});
    expect(pendientes.size).toBe(1);
    const bajaMapa = reloj.suscribirFrame(() => {});
    expect(pendientes.size).toBe(1); // un único bucle para todas las vistas

    bajaCielo();
    avanzarFrame(16);
    expect(pendientes.size).toBe(1); // queda un suscriptor: sigue

    bajaMapa();
    bajaMapa(); // la baja es idempotente (StrictMode limpia dos veces)
    expect(pendientes.size).toBe(0); // sin suscriptores: bucle parado
  });

  test("resuscribirse tras un montaje doble (StrictMode) rearranca el bucle", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    const tiempos: number[] = [];
    const pintor = (t: number): void => {
      tiempos.push(t);
    };

    // Montar → limpiar → volver a montar, como hace StrictMode en dev.
    const baja1 = reloj.suscribirFrame(pintor);
    baja1();
    expect(pendientes.size).toBe(0);
    reloj.suscribirFrame(pintor);
    expect(pendientes.size).toBe(1);

    reloj.alternarReproduccion();
    avanzarFrame(16);
    avanzarFrame(16);
    expect(tiempos.at(-1)).toBeGreaterThan(T_MIN);
  });

  test("al llegar al final se pausa, y play vuelve a empezar", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    const tiempos: number[] = [];
    reloj.suscribirFrame((t) => tiempos.push(t));
    reloj.fijarModo(300);
    reloj.saltarA(T_MAX - 1000);

    reloj.alternarReproduccion();
    avanzarFrame(16);
    avanzarFrame(16); // 16 ms × 300 = 4,8 s simulados: rebasa el final
    expect(tiempos.at(-1)).toBe(T_MAX);
    expect(reloj.leerReproduciendo()).toBe(false);

    reloj.alternarReproduccion();
    expect(reloj.leerReproduciendo()).toBe(true);
    avanzarFrame(16);
    expect(tiempos.at(-1)!).toBeLessThan(T_MAX); // reempieza desde tMin
  });

  test("la UI solo se notifica al cambiar el segundo mostrado", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    reloj.suscribirFrame(() => {});
    reloj.fijarModo(30);
    let avisos = 0;
    reloj.suscribirUi(() => avisos++);

    reloj.alternarReproduccion(); // avisa (cambia play)
    avisos = 0;
    // 10 frames de 2 ms a ×30 = 60 ms simulados por frame: mismo segundo.
    for (let i = 0; i < 10; i++) avanzarFrame(2);
    expect(reloj.leerTUi()).toBe(0);
    expect(avisos).toBe(0);

    // Hasta cruzar el segundo: un único aviso con tUi cuantizado.
    for (let i = 0; i < 8; i++) avanzarFrame(2);
    expect(reloj.leerTUi()).toBe(1000);
    expect(avisos).toBe(1);
  });

  test("los Contactos deduplican por valor: mismas cifras, misma curva", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    const tiempos: number[] = [];
    reloj.suscribirFrame((t) => tiempos.push(t));

    // Contactos de un eclipse parcial lejano: en t=0 la curva del resumen
    // va a velocidad de crucero (×600), no a la ×60 por defecto.
    const contactos: ContactosMs = {
      c1: 400_000,
      c2: null,
      maximo: 500_000,
      c3: null,
      c4: 590_000,
    };
    reloj.fijarContactos(contactos);
    // La otra vista aporta los mismos Contactos con otra identidad: no pasa
    // nada (misma curva, sin reconstrucción).
    reloj.fijarContactos({ ...contactos });

    reloj.alternarReproduccion();
    avanzarFrame(16); // dt 0
    avanzarFrame(16); // 16 ms × 600 = 9,6 s simulados
    expect(tiempos.at(-1)).toBe(9_600);
  });
});
