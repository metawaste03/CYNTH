# Author System

## Purpose

This document defines the intent behind Cynth's author system: the part of the engine responsible for preserving distinct, consistent author identities across articles, as introduced in [00_PROJECT_VISION.md](00_PROJECT_VISION.md).

## Scope

This document covers the concept and responsibilities of author identity management. It does not define the data model used to store author records (see [06_DATABASE_DESIGN.md](06_DATABASE_DESIGN.md)) or the actual authors of EveryFiveDays, which are data rather than architecture.

## Responsibilities

The Author System is expected to:

- Maintain a distinct voice/style profile per author used by the site.
- Ensure the Article Engine ([08_ARTICLE_ENGINE.md](08_ARTICLE_ENGINE.md)) generates drafts consistent with the selected author's identity.
- Provide a reference point the Quality Gate ([11_QUALITY_GATE.md](11_QUALITY_GATE.md)) can use to check voice consistency.
- Correspond to the `data/authors/` directory, which is reserved for author-related data.

## Current Status

**Implemented.** An author's identity can be expressed two ways, and the two are used together.

### 1. Structured persona fields (Milestones 3 and 11)

An author record carries named fields — short biography, philosophy, writing style, tone, target audience, expertise, perspective, editorial principles, boundaries, preferred and prohibited expressions, writing notes — plus any number of approved writing samples. Every one is supplied by the user; Cynth never invents editorial identity.

These suit an author described field by field, and they answer specific questions in a predictable shape.

### 2. Author skills (Milestone 16)

An author's identity may instead, or additionally, be supplied as a **document**: long-form markdown covering identity, philosophy, voice and tone, structural habits, vocabulary, voice samples, and the things the author never does.

The rules that govern a skill:

- **Verbatim in, verbatim out.** A skill is stored exactly as written and sent to the model exactly as written. Nothing parses it, summarises it, extracts fields from it, reflows it or escapes it. The reason is the point of the feature: a document decomposed into columns is a document rewritten, and the parts that do the most work — the voice samples, the prohibitions — are the parts that survive decomposition least well.
- **Beside the fields, not instead of them.** Both reach the model. Where they disagree, the prompt states that the skill is authoritative, and the skill is placed immediately after the summarised fields so that instruction refers to something the model can see.
- **Scoped to one author, or shared across all of them.** A shared editorial philosophy — a belief every author on the publication holds — is one document, not the same paragraphs copied into each persona. Shared guidance is established before the individual voice.
- **Opt-in throughout.** A skill must be active and assigned before it affects anything. An author with no skill generates exactly as they did before skills existed.

### How an author is selected for an article

Thematic areas and authors are linked many-to-many through `author_themes` (Milestone 10). The relationship is deliberately not one-to-one: one author may cover several areas, and one area may have several authors.

Selecting a thematic area in the New Article workflow narrows the offered authors to those assigned to it, and **selects the author automatically when exactly one active author is assigned**. Where an area has several, Cynth offers them and the editor chooses — picking between two qualified authors is an editorial decision, not one the engine makes. The backend independently rejects an author who does not cover the chosen area.

Which author writes for which area is therefore configuration, not code. Adding a sixth area with a sixth author is data entry.

### Where author data lives

The database is the source of truth. `CYNTH/Author/` is an import/export folder: documents written outside Cynth arrive there, and edited ones can be written back to the file they came from. Generation never reads that folder — Cynth runs correctly with it absent.

## Future Expansion

Voice consistency is still unmeasured. The Quality Gate is deterministic and calls no model, so whether a draft actually reads like its author is currently assessed by the human editor alone. A `quality_review` capability exists and is assignable but is not yet routed to; checking a draft against its author's skill is the obvious use for it.

## TODO

- ~~TODO: Obtain the list of actual EveryFiveDays authors/bylines from the editorial owner.~~ **Resolved (Milestone 16):** supplied by the Product Owner as five persona documents and imported.
- ~~TODO: Define what "voice profile" data is captured per author.~~ **Resolved (Milestones 3, 11 and 16):** the structured persona fields, the approved writing samples, and the author skill document.
- ~~TODO: Define how an author is selected for a given article.~~ **Resolved (Milestones 10 and 16):** through the thematic area, via `author_themes`, auto-selected when the area has exactly one active author.
- TODO: Define how author voice consistency is measured or verified. Still open — see Future Expansion above.
- TODO: Define whether a skill document should be versioned, so a draft can record which revision of a persona produced it. Articles currently record `prompt_version` but not the skill revision.
