# CONTEXT

Orientation for anyone — human or agent — starting work in this repo. Agents
read this file first, before touching code. Keep it short and true; a stale
CONTEXT.md is worse than none.

## What Eclipse is

Simulador web (en el navegador, desplegado en Vercel) del eclipse solar total
del 12 de agosto de 2026 visto desde cualquier municipio de España. El usuario
elige un municipio y una hora, y la app muestra la vista simulada del cielo y
la trayectoria del eclipse sobre el mapa de España. UI en español.

## Domain vocabulary

- **Observador**: el punto (lat/lon de un municipio español) desde el que se
  simula el eclipse. Toda circunstancia local se calcula para un Observador.
- **Municipio**: entrada del Nomenclátor del IGN (~8.100, con coordenadas);
  la unidad que el usuario busca y selecciona.
- **Oscurecimiento** (obscuration): fracción del disco solar cubierta por la
  Luna en un instante dado, para un Observador. Se **calcula**, nunca se
  tabula de fuentes de prensa. "Cobertura" es sinónimo coloquial; en código,
  `obscuration`.
- **Contactos C1–C4**: instantes locales que delimitan el eclipse — C1 inicio
  de parcialidad, C2 inicio de totalidad, C3 fin de totalidad, C4 fin de
  parcialidad. C2/C3 solo existen dentro de la Franja de totalidad.
- **Máximo**: instante de mayor Oscurecimiento para un Observador.
- **Totalidad**: intervalo C2–C3 (Oscurecimiento = 100%).
- **Franja de totalidad**: banda geográfica (~300 km de ancho, Galicia →
  Baleares) donde hay Totalidad.
- **Isolínea de cobertura**: curva sobre el mapa que une puntos con el mismo
  Oscurecimiento máximo (p. ej. 95%, 99%).
- **Vista Cielo**: la vista principal — render simulado del cielo (sol, luna,
  horizonte) desde el Observador, orientada con altitud/acimut reales.
- **Vista Mapa**: la vista de planta — mapa de España con la Franja de
  totalidad, las Isolíneas y la trayectoria de la sombra.
- **Línea de tiempo**: el instante simulado, compartido por todas las vistas
  y controlado por el slider de hora.

## Architecture

_(Fill this in: the main modules, how they talk to each other, and where the
seams are. Link to ADRs under `docs/adr/` for decisions that are settled.)_

## Conventions

- Coding standards live in `.sandcastle/CODING_STANDARDS.md`.
- Settled architectural decisions live in `docs/adr/`.
- Agent workflows are documented in `SETUP.html`.

## Checks

- `npm run typecheck`
- `npm test`

Both must pass before any commit.
