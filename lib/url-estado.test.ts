import { describe, expect, it } from "vitest";
import { municipios } from "./municipios";
import { crearRelojLineaDeTiempo, T_MAX, T_MIN } from "./reloj-tiempo";
import {
  construirQuery,
  formatearT,
  leerEstado,
  municipioPorSlug,
  parsearT,
  slugMunicipio,
} from "./url-estado";

describe("slugMunicipio", () => {
  it("quita acentos, minúsculas y guiones", () => {
    expect(slugMunicipio("Ferrol")).toBe("ferrol");
    expect(slugMunicipio("A Coruña")).toBe("a-coruna");
    expect(slugMunicipio("Alcalá de Henares")).toBe("alcala-de-henares");
    expect(slugMunicipio("O Pino")).toBe("o-pino");
  });

  it("colapsa tramos no alfanuméricos sin dejar guiones en los extremos", () => {
    expect(slugMunicipio("Castrillo de Murcia (agregado)")).toBe(
      "castrillo-de-murcia-agregado",
    );
    expect(slugMunicipio("Vilanova i la Geltrú")).toBe("vilanova-i-la-geltru");
  });
});

describe("slug ida y vuelta contra el Nomenclátor", () => {
  it("todo municipio se recupera desde su propio slug (nombres con acentos incluidos)", () => {
    for (const nombre of ["Ferrol", "A Coruña", "Cádiz", "València", "Logroño"]) {
      const original = municipios.find((m) => m.nombre === nombre);
      expect(original).toBeDefined();
      const recuperado = municipioPorSlug(slugMunicipio(nombre), municipios);
      expect(recuperado?.nombre).toBe(nombre);
    }
  });

  it("un slug desconocido devuelve null", () => {
    expect(municipioPorSlug("atlantis", municipios)).toBeNull();
  });
});

describe("parámetro t (HHMMSS, hora peninsular CEST)", () => {
  it('"202757" son las 20:27:57 CEST del 12-08-2026 (18:27:57 UT)', () => {
    expect(parsearT("202757")).toBe(Date.UTC(2026, 7, 12, 18, 27, 57));
  });

  it("formatear y parsear son inversas dentro de la Línea de tiempo", () => {
    for (const t of [T_MIN, Date.UTC(2026, 7, 12, 18, 27, 57), T_MAX]) {
      expect(parsearT(formatearT(t))).toBe(t);
    }
  });

  it("rechaza valores mal formados u horas imposibles", () => {
    for (const malo of ["", "2027", "20:27:57", "abcdef", "246060", "206099"]) {
      expect(parsearT(malo)).toBeNull();
    }
  });
});

describe("leerEstado", () => {
  it("lee ?m=ferrol&t=202757", () => {
    expect(leerEstado("?m=ferrol&t=202757")).toEqual({
      slug: "ferrol",
      t: Date.UTC(2026, 7, 12, 18, 27, 57),
    });
  });

  it("parámetros ausentes o inválidos degradan a null sin lanzar", () => {
    expect(leerEstado("")).toEqual({ slug: null, t: null });
    expect(leerEstado("?t=basura")).toEqual({ slug: null, t: null });
    expect(leerEstado("?m=ferrol")).toEqual({
      slug: "ferrol",
      t: null,
    });
  });
});

describe("construirQuery", () => {
  it("construye ?m=…&t=… y omite lo que falte", () => {
    const t = Date.UTC(2026, 7, 12, 18, 27, 57);
    expect(construirQuery({ municipio: { nombre: "Ferrol" }, t })).toBe(
      "?m=ferrol&t=202757",
    );
    expect(construirQuery({ municipio: null, t })).toBe("?t=202757");
    expect(construirQuery({ municipio: null, t: null })).toBe("");
  });

  it("lo que construye se vuelve a leer igual (ida y vuelta)", () => {
    const t = Date.UTC(2026, 7, 12, 18, 27, 57);
    const query = construirQuery({ municipio: { nombre: "A Coruña" }, t });
    expect(leerEstado(query)).toEqual({ slug: "a-coruna", t });
  });
});

describe("restauración del estado", () => {
  it("abrir ?m=ferrol&t=202757 sitúa al Observador en Ferrol y el reloj a las 20:27:57", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    const { slug, t } = leerEstado("?m=ferrol&t=202757");
    const observador = slug ? municipioPorSlug(slug, municipios) : null;
    if (t !== null) reloj.saltarA(t);

    expect(observador).toMatchObject({ nombre: "Ferrol", provincia: "A Coruña" });
    expect(reloj.leerTUi()).toBe(Date.UTC(2026, 7, 12, 18, 27, 57));
  });

  it("una t fuera de la Línea de tiempo queda recortada al rango del reloj", () => {
    const reloj = crearRelojLineaDeTiempo({ tMin: T_MIN, tMax: T_MAX });
    const { t } = leerEstado("?t=235959");
    if (t !== null) reloj.saltarA(t);
    expect(reloj.leerTUi()).toBe(T_MAX);
  });
});
