# CONTEXT

Orientation for anyone — human or agent — starting work in this repo. Agents
read this file first, before touching code. Keep it short and true; a stale
CONTEXT.md is worse than none.

## What Eclipse is

_(Fill this in: one paragraph on what the project does and who it is for.)_

## Domain vocabulary

_(Fill this in: the nouns this codebase uses, and what each one means. Use
these words in issue titles, commit messages, and code.)_

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
