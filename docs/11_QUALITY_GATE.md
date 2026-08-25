# Quality Gate

## Purpose

This document defines the intent behind Cynth's quality gate — the checkpoint that stands between an AI-assisted draft and anything considered ready for human final review or publication.

## Scope

This document covers the conceptual role of the quality gate within the editorial workflow. It does not define specific pass/fail criteria or prompts (see `prompts/quality_gate/`).

## Responsibilities

The Quality Gate, once implemented, is expected to:

- Check drafts against the Editorial Constitution ([01_EDITORIAL_CONSTITUTION.md](01_EDITORIAL_CONSTITUTION.md)).
- Incorporate findings from the SEO Engine ([10_SEO_ENGINE.md](10_SEO_ENGINE.md)).
- Surface issues to the human editor clearly, without making the final publish decision itself.
- Serve as the last automated checkpoint before an article is handed off for WordPress publishing ([12_WORDPRESS.md](12_WORDPRESS.md)).

## Current Status

**Conceptual only.** No quality criteria, scoring rubric, or gating logic has been defined or implemented. `prompts/quality_gate/` is reserved but currently empty.

## Future Expansion

Once the Editorial Constitution and SEO standards are defined, this document should describe what the quality gate actually checks and how failures are communicated (still without embedding prompt text).

## TODO

- TODO: Define concrete pass/fail (or scored) criteria once the Editorial Constitution exists.
- TODO: Define whether the quality gate can block publishing outright or only advise the human editor.
- TODO: Define how quality gate results are recorded/stored (see [06_DATABASE_DESIGN.md](06_DATABASE_DESIGN.md)).
- TODO: Define the review UI/UX for presenting quality gate findings (see [05_UI_GUIDELINES.md](05_UI_GUIDELINES.md)).
