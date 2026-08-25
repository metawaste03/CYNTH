# System Architecture

## Purpose

This document is intended to describe, at a high level, how Cynth's components fit together — without prescribing implementation details that have not yet been decided.

## Scope

This document covers the conceptual relationship between Cynth's major parts, as implied by the project's folder structure: an application layer, a database layer, a prompts library, and data resources (article types, authors, products). It does not specify frameworks, languages, libraries, or schemas.

## Responsibilities

The architecture, once decided, will need to account for:

- How the `app/` layer coordinates the editorial workflow (draft → review → SEO check → quality gate → publish).
- How the `database/` layer persists articles, authors, and related editorial state.
- How the `prompts/` library is organized and consumed by the article, keyword, quality gate, rewrite, SEO review, and title generation stages.
- How `data/` (article types, authors, products) is structured and referenced by the rest of the system.
- How the system integrates with one or more AI model providers (see [09_MODEL_PROVIDERS.md](09_MODEL_PROVIDERS.md)).
- How the system integrates with WordPress for publishing (see [12_WORDPRESS.md](12_WORDPRESS.md)).

## Current Status

**Decision Lock (2026-08-06) — approved by the Product Owner:**

- **Application type:** Local-first web application. Runs locally on Windows.
- **Frontend:** React + TypeScript. Browser-based interface.
- **Backend:** Node.js + Express.
- **Communication:** REST between frontend and backend.
- **Database:** SQLite. Chosen, but **not yet implemented** — no database code exists yet (see [06_DATABASE_DESIGN.md](06_DATABASE_DESIGN.md)).
- **Structure:** Feature-based architecture across both frontend and backend (`features/` + `shared/`, rather than organizing by page/route).

Milestone 1 ("Application Foundation") implemented the frontend and backend **shell** per this Decision Lock: a React + TypeScript client (Vite) and a Node.js + Express server, both feature-based, under `app/client/` and `app/server/`. No database wiring, no API keys, no model provider integration, no WordPress integration, and no business logic — see [13_MILESTONES.md](13_MILESTONES.md) for exactly what was built versus what remains scaffolding.

## Future Expansion

With the stack decided, remaining architecture work is about how data flows through it once real features are implemented.

## TODO

- TODO: Define data flow between the article engine, SEO engine, and quality gate once those are implemented.
- TODO: Define how prompts are loaded, versioned, and selected at runtime.
- TODO: Define the SQLite schema and where the database file lives on disk (see [06_DATABASE_DESIGN.md](06_DATABASE_DESIGN.md)).
- TODO: Define the concrete REST endpoint contracts once real features exist to expose — the communication style (REST) is locked, but no endpoints are defined yet since there is no business logic.
