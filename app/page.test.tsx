import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import Home from "./page";

describe("home", () => {
  test("enlaza a la página de información y seguridad", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain('href="/info"');
  });

  // La barra de tiempo única (#36): un solo slider global en la home y
  // ninguna vista con controles propios.
  test("monta una única barra de tiempo para todas las vistas", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html.match(/Línea de tiempo del eclipse/g)).toHaveLength(1);
    expect(html.match(/Barra de tiempo del eclipse/g)).toHaveLength(1);
  });
});
