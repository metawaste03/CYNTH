# Quality Gate

## Purpose

This document defines the intent behind Cynth's quality gate — the checkpoint that stands between an AI-assisted draft and anything considered ready for human final review or publication.

## Scope

This document covers the conceptual role of the quality gate within the editorial workflow. It does not define specific pass/fail criteria or prompts (see `prompts/quality_gate/`).

## Responsibilities

The Quality Gate, once implemented, is expected to:

- Check drafts against the Editorial Constitution ([01_EDITORIAL_CONSTITUTION.md](01_EDITORIAL_CONSTITUTION.md)).
- Incorporate findings from the SEO Engine ([10_SEO_ENGINE.md](10_SEO_ENGINE.md)).

As of Milestone 14 the SEO Engine has its own gate, which decides whether an
article may be handed to a CMS. That gate judges **SEO readiness only**, and
Cynth deliberately keeps it separate from content quality: a well-written
article can be poorly optimised, and a well-optimised one can be badly
written. The Quality Gate, when it is built, is the second of the two
judgements — not a replacement for the first, and not something the SEO score
should ever stand in for.
- Surface issues to the human editor clearly, without making the final publish decision itself.
- Serve as the last automated checkpoint before an article is handed off for WordPress publishing ([12_WORDPRESS.md](12_WORDPRESS.md)).

## Current Status

**Built (Milestone 15).** `app/server/src/features/quality-gate/` runs the gate; the
UI is the Quality Gate page and the Readiness panel on each article.

### What it checks

Fifteen deterministic checks in three groups. Every check reports its own
verdict, its own sentence explaining that verdict, and — when it fails — what
would satisfy it. There is deliberately no single score: a number would hide
the only thing a person actually needs, which is *which* check failed.

| Group | Checks |
|---|---|
| The article itself | generated at all, has a title, has content, long enough to be finished, not cut off mid-sentence, not a refusal or disclaimer, no unfilled placeholders |
| Structure | divided by headings, no heading with nothing under it, has readable paragraphs |
| Editorial configuration | article type known, author known, subject known, thematic area assigned, target audience stated, provenance recorded |

### Severity decides the verdict

- **blocking** — the article is not reviewable. These, and only these, produce *Failed*.
- **warning** — reviewable, but worth a look. These produce *Passed with Warnings*, never *Failed*.
- **advisory** — reported and never counted (a missing provenance snapshot is a record-keeping gap, not a reason the article is unfit to review).

Which severity a check carries is the design. A missing thematic area is a
warning because an article can legitimately be written outside the content
architecture; a missing body is blocking because there is nothing to review.

### Status

`Not Evaluated` · `Passed` · `Passed with Warnings` · `Failed`

A stored result that predates an edit is reported as **stale** rather than
silently recomputed — an automatic re-run would hide that the answer changed.

### What it deliberately is not

- **Not the SEO gate.** Quality asks whether this is a finished article; SEO asks whether it will perform in search. `Quality: Passed / SEO: Needs Attention` is an ordinary state, and the workflow shows both side by side rather than blending them.
- **Not a blocker.** The Quality Gate reports. The only place a gate refuses anything is the CMS push path, which the SEO gate governs.
- **Not model-assisted.** Nothing here calls a model, so running it is free and instant. An editorial-judgement pass belongs to the `quality_review` model capability, which is assignable but not yet routed to.
- **Not a writer.** Nothing in the feature writes to the `articles` table. The gate observes an article; it never edits one.

`prompts/quality_gate/` remains empty, and stays empty until there is a
model-assisted pass to write a prompt for.

## Future Expansion

Once the Editorial Constitution and SEO standards are defined, this document should describe what the quality gate actually checks and how failures are communicated (still without embedding prompt text).

## TODO

- TODO: Define concrete pass/fail (or scored) criteria once the Editorial Constitution exists.
- TODO: Define whether the quality gate can block publishing outright or only advise the human editor.
- TODO: Define how quality gate results are recorded/stored (see [06_DATABASE_DESIGN.md](06_DATABASE_DESIGN.md)).
- TODO: Define the review UI/UX for presenting quality gate findings (see [05_UI_GUIDELINES.md](05_UI_GUIDELINES.md)).
