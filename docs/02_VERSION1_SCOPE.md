# Version 1 Scope

## Purpose

This document is intended to define what is — and is not — included in the first shippable version of Cynth. Its role is to prevent scope creep by giving every future milestone a boundary to check itself against.

## Scope

This document governs feature-level scope decisions for "Version 1" of Cynth. It does not define the order of milestones (see [13_MILESTONES.md](13_MILESTONES.md)) — only what those milestones are collectively allowed to build toward.

## Responsibilities

Once populated, this document should:

- List the capabilities Version 1 must include to be considered complete.
- Explicitly list capabilities that are out of scope for Version 1, to avoid ambiguity later.
- Provide the reference point milestone plans are validated against before work begins.

## Current Status

**Decision Lock (2026-08-06) — approved by the Product Owner, locked in for Version 1:**

Version 1 is a local-first editorial engine that:

- Is single-user.
- Runs on Windows.
- Requires human approval before publication (human-in-the-loop).
- Has no authentication.
- Has no collaboration (a single operator; no shared or multi-user workflows).
- Supports multiple AI providers.
- Supports article drafting.
- Supports editorial review.
- Supports manual publishing to WordPress.

**Future Version (explicitly out of scope for V1):**

- Multi-user accounts, roles, or collaboration.
- Authentication/login.
- Automatic or unsupervised publishing.
- Non-Windows platform support.

Anything not listed under the Decision Lock above is out of scope for Version 1 and belongs under Future Version rather than being built.

## Future Expansion

Feature-level depth (exactly which AI providers, article types, SEO rules, and quality gate criteria) should still be filled in collaboratively with the project owner before those specific engine milestones begin.

## TODO

- TODO: Confirm which specific AI providers are supported at launch (see [09_MODEL_PROVIDERS.md](09_MODEL_PROVIDERS.md)). *Milestone 9 implemented adapters for OpenRouter, Anthropic, and OpenAI, and the design takes further providers without engine changes — but whether those three are the intended launch set is still a Product Owner decision.*
- TODO: Define the article types supported in V1 (see [08_ARTICLE_ENGINE.md](08_ARTICLE_ENGINE.md) and `data/article_types/`).
- TODO: Define what "editorial review" and "quality gate" concretely check for in V1 (see [01_EDITORIAL_CONSTITUTION.md](01_EDITORIAL_CONSTITUTION.md) and [11_QUALITY_GATE.md](11_QUALITY_GATE.md)).
