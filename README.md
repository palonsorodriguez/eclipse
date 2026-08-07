# Eclipse

Repositorio inicial del proyecto Eclipse.

## Estado

Proyecto recién iniciado — todavía sin código.

## Puesta en marcha

```bash
git clone https://github.com/palonsorodriguez/eclipse.git
cd eclipse
npm install
```

## Agentes

El repo ejecuta agentes de código desde GitHub Actions con
[Sandcastle](https://github.com/mattpocock/sandcastle): etiquetas un issue con
`agent:implement` y el agente abre un PR en draft. La guía de instalación paso a
paso está en [`SETUP.html`](./SETUP.html) — ábrela en el navegador.

Antes de la primera ejecución, rellena [`CONTEXT.md`](./CONTEXT.md) y
[`.sandcastle/CODING_STANDARDS.md`](./.sandcastle/CODING_STANDARDS.md): los
agentes los leen antes de tocar código.

Comprobaciones:

```bash
npm run typecheck
npm test
```

## Licencia

Pendiente de definir.
