import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { VENTANA_TOTALIDAD } from "@/lib/eclipse-2026";
import Info from "./page";

const render = () => renderToStaticMarkup(<Info />);

describe("página /info", () => {
  test("advierte de que nunca se mira al Sol sin protección homologada", () => {
    expect(render()).toContain("Nunca mires al Sol sin protección");
  });

  test("exige la certificación que distingue unas gafas de eclipse", () => {
    expect(render()).toContain("ISO 12312-2");
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

  test("ofrece la proyección estenopeica como alternativa sin mirar al Sol", () => {
    expect(render()).toContain("proyección estenopeica");
  });

  test("sitúa la Totalidad en la ventana publicada por el IGN", () => {
    const html = render();

    expect(html).toContain(VENTANA_TOTALIDAD.inicio);
    expect(html).toContain(VENTANA_TOTALIDAD.fin);
  });

  test("acredita las fuentes de datos con enlace", () => {
    const html = render();

    expect(html).toContain('href="https://www.ign.es/"');
    expect(html).toContain('href="https://eclipse.gsfc.nasa.gov/"');
    expect(html).toContain('href="https://open-meteo.com/"');
  });

  test("cumple la atribución CC BY que exige el Nomenclátor del IGN", () => {
    const html = render();

    expect(html).toContain("Nomenclátor");
    expect(html).toContain("CC BY 4.0");
    expect(html).toContain(
      'href="https://creativecommons.org/licenses/by/4.0/deed.es"',
    );
  });
});
