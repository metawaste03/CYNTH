# Cynth

## Project Overview

Cynth is a local-first, AI-assisted editorial engine for the EveryFiveDays website. It exists to help produce high-quality articles while maintaining editorial consistency, author identity, SEO readiness, and human oversight. Cynth assists; the human editor decides.

## Goals

- Help produce high-quality, consistent articles for EveryFiveDays.
- Preserve distinct author voices and editorial identity across content.
- Build SEO readiness into the editorial process rather than treating it as an afterthought.
- Keep a human editor as the final authority over anything published.
- Operate on local-first principles.

See [docs/00_PROJECT_VISION.md](docs/00_PROJECT_VISION.md) for the full vision.

## Development Philosophy

Cynth is built documentation-first. Requirements are never invented — where information is missing, it is marked `TODO` rather than guessed at. Development proceeds in discrete, bounded milestones; each milestone has an explicit stopping point and requires review before the next begins. See [docs/04_DEVELOPMENT_RULES.md](docs/04_DEVELOPMENT_RULES.md) for the full rule set.

## Current Milestone

**Milestone 0: Project Binder.**

This milestone's sole deliverable is this documentation structure: the folder layout and the populated markdown files under `docs/`, plus the placeholder directories under `prompts/`, `data/`, `app/`, and `database/`. No application code, dependencies, database, or AI implementation exists yet. See [docs/13_MILESTONES.md](docs/13_MILESTONES.md) for milestone tracking.

## Folder Structure

```
CYNTH/
├── docs/                      Project documentation (this binder)
├── prompts/                   Reserved for future prompt libraries, organized by task
│   ├── article_generation/
│   ├── keyword_generation/
│   ├── quality_gate/
│   ├── rewrite/
│   ├── seo_review/
│   └── title_generation/
├── data/                      Reserved for editorial reference data
│   ├── article_types/
│   ├── authors/
│   └── products/
├── app/                       Reserved for the application layer (not yet implemented)
├── database/                  Reserved for persistence layer (not yet implemented)
└── README.md                  This file
```

All `prompts/`, `data/`, `app/`, and `database/` subdirectories are currently empty by design — populating them with real content is out of scope for Milestone 0.

## How Future Milestones Will Work

Each future milestone will:

1. Be scoped and approved explicitly before work begins, and checked against [docs/02_VERSION1_SCOPE.md](docs/02_VERSION1_SCOPE.md) and [docs/00_PROJECT_VISION.md](docs/00_PROJECT_VISION.md).
2. Have a clear, bounded deliverable and an explicit stopping point, recorded in [docs/13_MILESTONES.md](docs/13_MILESTONES.md).
3. Follow the development rules in [docs/04_DEVELOPMENT_RULES.md](docs/04_DEVELOPMENT_RULES.md) — no invented requirements, no skipped documentation.
4. End with a review before the next milestone is proposed or started.
5. Be recorded in [docs/CHANGELOG.md](docs/CHANGELOG.md).
