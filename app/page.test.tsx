import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import Home from "./page";

describe("home", () => {
  test("enlaza a la página de información y seguridad", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain('href="/info"');
  });
});
