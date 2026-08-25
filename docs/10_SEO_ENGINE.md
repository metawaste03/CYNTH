# SEO Engine

## Purpose

This document defines the intent behind Cynth's SEO engine — the component responsible for helping articles meet baseline search-engine-optimization expectations, as introduced in [00_PROJECT_VISION.md](00_PROJECT_VISION.md).

## Scope

This document covers the conceptual responsibilities of SEO assistance within Cynth. It does not define specific SEO rules, scoring criteria, or prompts (see `prompts/seo_review/` and `prompts/keyword_generation/`).

## Responsibilities

The SEO Engine, once implemented, is expected to:

- Review article drafts produced by the Article Engine ([08_ARTICLE_ENGINE.md](08_ARTICLE_ENGINE.md)) for SEO readiness.
- Assist with keyword identification, corresponding to `prompts/keyword_generation/`.
- Assist with title optimization, corresponding to `prompts/title_generation/`.
- Surface SEO findings to the human editor rather than silently altering content, consistent with the human-oversight principle.
- Feed into the Quality Gate ([11_QUALITY_GATE.md](11_QUALITY_GATE.md)) as one of the checks an article must pass.

## Current Status

**Conceptual only.** No SEO criteria, scoring model, or review logic has been defined or implemented. `prompts/seo_review/`, `prompts/keyword_generation/`, and `prompts/title_generation/` are reserved but currently empty.

## Future Expansion

Once EveryFiveDays' actual SEO standards/targets are provided, this document should describe what the engine checks for (still without embedding prompt text).

## TODO

- TODO: Obtain EveryFiveDays' actual SEO standards/targets from the site owner (currently none provided).
- TODO: Define what SEO signals matter for this site (e.g. target keyword density, meta description, headings) — pending real input.
- TODO: Define how SEO findings are surfaced to the editor (severity levels, blocking vs. advisory).
- TODO: Define relationship between SEO Engine and Quality Gate (advisory input vs. hard gate).
