import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import Info from "./page";

const render = () => renderToStaticMarkup(<Info />);

describe("página /info", () => {
  test("advierte de que nunca se mira al Sol sin protección homologada", () => {
    const html = render();

    expect(html).toContain("Nunca mires al Sol sin protección");
    expect(html).toContain("ISO 12312-2");
  });

  test("sitúa el eclipse en fecha, hora y franja de totalidad", () => {
    const html = render();

    expect(html).toContain("12 de agosto de 2026");
    expect(html).toContain("20:26");
    expect(html).toContain("20:33");
    expect(html).toContain("Franja de totalidad");
    expect(html).toContain("Baleares");
  });

  test("desaconseja los filtros improvisados que la gente suele usar", () => {
    const html = render();

    for (const improvisado of [
      "gafas de sol",
      "radiografías",
      "cristales ahumados",
    ]) {
      expect(html).toContain(improvisado);
    }
  });

  test("acota el único momento en que se puede mirar a simple vista", () => {
    const html = render();

    expect(html).toContain("solo durante la Totalidad");
    expect(html).toContain("vuelve a ponerte las gafas");
    expect(html).toContain("Fuera de la Franja de totalidad");
  });

  test("explica la proyección estenopeica como alternativa sin mirar al Sol", () => {
    const html = render();

    expect(html).toContain("proyección estenopeica");
  });

  test("permite volver al simulador", () => {
    const html = render();

    expect(html).toContain('href="/"');
  });

  test("acredita las fuentes de datos con enlace", () => {
    const html = render();

    expect(html).toContain("Instituto Geográfico Nacional");
    expect(html).toContain("https://www.ign.es/");
    expect(html).toContain("NASA");
    expect(html).toContain("https://eclipse.gsfc.nasa.gov/");
    expect(html).toContain("Open-Meteo");
    expect(html).toContain("https://open-meteo.com/");
  });

  test("cumple la atribución CC BY que exige el Nomenclátor del IGN", () => {
    const html = render();

    expect(html).toContain("Nomenclátor");
    expect(html).toContain("CC BY 4.0");
    expect(html).toContain("https://creativecommons.org/licenses/by/4.0/deed.es");
  });
});
