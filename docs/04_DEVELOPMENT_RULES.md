# Development Rules

## Purpose

This document records the ground rules under which Cynth is built, so that every future milestone — regardless of who or what implements it — follows the same discipline established at project inception.

## Scope

This document covers process and discipline rules for how Cynth is developed. It does not cover editorial rules (see [01_EDITORIAL_CONSTITUTION.md](01_EDITORIAL_CONSTITUTION.md)) or architectural decisions (see [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md)).

## Responsibilities

These rules govern all current and future work on Cynth:

1. **Documentation before implementation.** No milestone should introduce a capability that isn't first documented in this binder.
2. **Never invent requirements.** If a requirement, schema, prompt, or UI detail has not been explicitly provided, it must not be assumed or fabricated.
3. **Use TODO instead of guessing.** Any gap in information should be marked `TODO` rather than filled in with a plausible-sounding placeholder.
4. **Milestones are sequential and bounded.** Each milestone has an explicit scope and an explicit stopping point. Work does not continue past that point without review.
5. **The human editor decides.** No development decision should reduce human oversight of published content, regardless of technical convenience.
6. **No unauthorized dependencies.** Milestones that are documentation-only must not install packages, initialize application scaffolding (e.g. `package.json`, a React app), or set up a database.
7. **Engineering decisions do not require Product Owner approval.** Engineering decisions that do not affect product vision may be made by the Lead Software Engineer without requiring Product Owner approval. Examples include build tooling, folder naming, linting, routing, and similar implementation details. Product decisions always require Product Owner approval.
8. **Milestone documentation is part of finishing a milestone.** Whenever the Product Owner and Technical Supervisor agree that a milestone is complete, the milestone documentation must be updated before any work begins on the next milestone. At minimum that means [13_MILESTONES.md](13_MILESTONES.md) and [CHANGELOG.md](CHANGELOG.md). The record must reflect what was actually implemented and the known limitations reported at completion — not what was planned. This is not to be waited on: it happens as part of closing the milestone, without the Product Owner separately requesting it. Existing documents are to be updated rather than new ones created, unless a new document is genuinely necessary.

## Current Status

These rules are in effect starting with Milestone 0 and apply retroactively to nothing (there is no prior work). Milestone 0 itself is compliant: documentation only, no application code, no dependencies. Rule 7 was appended under Milestone 0.5 (2026-08-06), approved by the Product Owner. Rule 8 was appended at the close of Milestone 9 (2026-08-25), approved by the Product Owner, after the documentation gap recorded against Milestones 6–8 in [13_MILESTONES.md](13_MILESTONES.md); Milestone 9's own closeout was the first application of it.

## Future Expansion

As the team (human or AI-assisted) grows, this document may expand to include contribution guidelines, review process, and definition-of-done criteria per milestone type.

## TODO

- TODO: Define a formal review/approval process for each milestone before the next one begins.
- TODO: Define coding standards for when implementation milestones begin.
- TODO: Define how deviations from these rules should be flagged and resolved.
