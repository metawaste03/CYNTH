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

## Current State

**Updated 2026-10-07 — Milestone 43 complete, changelog at 0.54.0.** Cynth is a working editorial engine: it researches, drafts, illustrates and SEO-checks articles in five author voices, keeps a product catalogue, and pushes **drafts** to EveryFiveDays — the local install or the live site at https://everyfivedays.com — along with Rank Math metadata and featured images. It also writes EveryFiveDays' product registry (`npm --prefix app/server run export:registry`). Nothing it does can publish; a human publishes in WordPress.

Server: 542 tests pass, `tsc` clean. Client: `tsc` clean.

The milestone-by-milestone record is [docs/13_MILESTONES.md](docs/13_MILESTONES.md); what changed and when is [docs/CHANGELOG.md](docs/CHANGELOG.md). How to run it is [app/README.md](app/README.md). The EveryFiveDays site it writes for is a separate repository at `C:\Users\MetaWaste\OneDrive\Desktop\CLAUDE\Everyfivedays`.

## Folder Structure

```
CYNTH/
├── docs/        Project binder — vision, rules, architecture, milestones, changelog
├── app/
│   ├── client/  React + TypeScript (Vite) — the editorial workspace
│   └── server/  Node + Express (TypeScript) — API, SQLite, AI generation, CMS push
├── database/    cynth.db, dated backups, and uploads/ (product and article images)
├── Author/      Source text for the five author personas
├── Products/    Product photography, by area
├── prompts/     Reserved; prompts are assembled in code from the database
├── data/        Reserved; authors, products and article types live in the database
└── scripts/     Project-level helper scripts
```

`database/` is not versioned (`*.db` and `uploads/` are gitignored) — back it up separately.

## How Future Milestones Will Work

Each future milestone will:

1. Be scoped and approved explicitly before work begins, and checked against [docs/02_VERSION1_SCOPE.md](docs/02_VERSION1_SCOPE.md) and [docs/00_PROJECT_VISION.md](docs/00_PROJECT_VISION.md).
2. Have a clear, bounded deliverable and an explicit stopping point, recorded in [docs/13_MILESTONES.md](docs/13_MILESTONES.md).
3. Follow the development rules in [docs/04_DEVELOPMENT_RULES.md](docs/04_DEVELOPMENT_RULES.md) — no invented requirements, no skipped documentation.
4. End with a review before the next milestone is proposed or started.
5. Be recorded in [docs/CHANGELOG.md](docs/CHANGELOG.md).
