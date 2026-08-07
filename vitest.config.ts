import { defineConfig } from "vitest/config";

// El alias `@/*` lo declara tsconfig.json y lo resuelve Next en build; Vitest
// no lee esos paths, así que hay que repetirlo aquí o cualquier test que
// importe un módulo con `@/` falla al resolverlo.
export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
});
