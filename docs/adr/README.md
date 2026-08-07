# Architecture Decision Records

One file per settled decision, named `NNNN-kebab-case-title.md`. Agents read
the ADRs relevant to the area they are changing before starting work, so keep
each one to the decision and its consequences — not a design essay.

Suggested shape:

```markdown
# NNNN. Title

## Status

Accepted — 2026-08-07

## Context

What forced the decision. The constraints in play.

## Decision

What we chose, stated plainly.

## Consequences

What this makes easy, and what it makes hard.
```

The scheduled `architecture-review` workflow reads this directory before
proposing new PRDs, so it will not re-litigate anything recorded here.
