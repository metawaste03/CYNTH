# Author System

## Purpose

This document defines the intent behind Cynth's author system: the part of the engine responsible for preserving distinct, consistent author identities across articles, as introduced in [00_PROJECT_VISION.md](00_PROJECT_VISION.md).

## Scope

This document covers the concept and responsibilities of author identity management. It does not define the data model used to store author records (see [06_DATABASE_DESIGN.md](06_DATABASE_DESIGN.md)) or the actual authors of EveryFiveDays.

## Responsibilities

The Author System, once implemented, is expected to:

- Maintain a distinct voice/style profile per author used by the site.
- Ensure the Article Engine ([08_ARTICLE_ENGINE.md](08_ARTICLE_ENGINE.md)) generates drafts consistent with the selected author's identity.
- Provide a reference point the Quality Gate ([11_QUALITY_GATE.md](11_QUALITY_GATE.md)) can use to check voice consistency.
- Correspond to the `data/authors/` directory, which is reserved for author-related data but currently empty.

## Current Status

**Conceptual only.** No authors, voice profiles, or identity data have been defined or provided. The `data/authors/` directory exists but is intentionally empty at this milestone — no author data is to be invented.

## Future Expansion

Once real author information is provided by the editorial owner, this document should describe how that information is structured and used (still without prescribing implementation) and `data/authors/` should be populated accordingly.

## TODO

- TODO: Obtain the list of actual EveryFiveDays authors/bylines from the editorial owner.
- TODO: Define what "voice profile" data is captured per author (e.g. tone, vocabulary, structure preferences) — pending real input, not invented here.
- TODO: Define how an author is selected for a given article.
- TODO: Define how author voice consistency is measured or verified.
