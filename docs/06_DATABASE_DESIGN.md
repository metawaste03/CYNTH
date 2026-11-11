# Database Design

## Purpose

This document is intended to define how Cynth persists data — articles, authors, drafts, review state, and related editorial records — once a database design has actually been decided.

## Scope

This document covers data persistence design only. It does not cover the in-memory or file-based structures used by `data/` (article types, authors, products) at the documentation stage, nor application architecture broadly (see [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md)).

## Responsibilities

Once defined, the database design should account for:

- Storage of article drafts and their revision history.
- Storage of author identity/profile data (see [07_AUTHOR_SYSTEM.md](07_AUTHOR_SYSTEM.md)).
- Storage of quality gate and SEO review results per article.
- Support for the local-first principle established in [00_PROJECT_VISION.md](00_PROJECT_VISION.md).

## Current Status

**This section is stale and predates the implementation.** The authoritative schema is `app/server/src/shared/database/schema.ts` (SQLite, via Node's built-in `node:sqlite`), with `migrations.ts` recording every column added after a table was first created. Reconstructing this document from the live schema is outstanding work and was out of scope for Milestone 14, which added its eleven SEO and web-intelligence tables to that file rather than expanding this one, for Milestone 15, which added two more, for Milestone 16, which added one, for Milestone 17, which added two, and for Milestone 18, which added columns only. The original Milestone 0 text follows.

Milestone 18's additions, for the record:

- **`products.theme_id`** — the thematic area a product belongs to. A single nullable reference rather than a join table, because a product belongs to one content area or to none; `ON DELETE SET NULL`, so retiring an area removes the association and never the product. Unlike `author_themes`, this is deliberately not many-to-many — a product that must span areas would be the reason to change it.
- **Six review columns on `article_products`** — `review_verdict`, `review_assessment`, `review_suggested_section`, `review_confidence`, `review_model`, `reviewed_at`. They hold an OPINION about a placement, and are kept strictly apart from the columns holding the decision: `placement_section` stays whatever the author chose, and `review_suggested_section` records what the reviewer would have done instead. Two columns rather than one, so a suggestion can never be mistaken for a change that happened. Cleared whenever an article is regenerated, since a verdict describes a placement that no longer exists.

Milestone 17's additions, for the record:

- **`article_products`** — one product's place in one article, replacing `articles.product_id`, which allowed exactly one. The old column is deprecated-but-preserved and still READ, so a draft created before this table keeps its product; nothing writes to it any more. `status` records an outcome the author is explicitly permitted to reach: `'omitted'` means the product was offered and judged not to belong, which is a success stored as one rather than an absence. `placement_section` and `placement_rationale` are written *after* generation, from the markers the author emitted, so they describe a draft rather than instruct one.
- **`product_research`** — one research pass over one product, with its provenance. `retrieval_id` points at the `web_retrievals` row that proves which fetch a claim came from, and is nullable only because a product may be described entirely by hand with no page read at all. `extraction_method` distinguishes `'structured_metadata'` (published by the page) from `'ai'` (written by a model), so the two are never mistaken for each other. Rows accumulate; nothing is overwritten.
- **Nine columns on `products`** holding the current research answer that generation reads: `source_url`, `vendor`, `source_image_url`, `use_case`, `problem_solved`, `best_for`, `key_features`, `research_status`, `researched_at`. **`affiliate_link` is deliberately not among them** — it already existed, it holds the link the user supplied, and `source_url` is a separate column precisely so that reading a page can never edit a link.

Milestone 16's addition, for the record:

- **`author_skills`** — a long-form authoring document, stored as markdown and sent to the model unchanged. `author_id` is nullable (`ON DELETE CASCADE`) so a document can exist before it is assigned, and there may be several rows per author, so a second document for one author is an INSERT rather than a schema change. `scope` is `'author'` or `'shared'`; a shared row applies to every author and always carries a null `author_id`, which is why a shared editorial philosophy is one row rather than the same paragraphs copied into each persona. `source_filename` records which file in the `Author/` folder a row came from, and is what makes re-import update rather than duplicate and export round-trip to the same file. `body` is never edited by Cynth on the way in or on the way to the model. No migration was needed — the table is new.

Milestone 15's additions, for the record:

- **`ai_model_capabilities`** — the set of jobs a registered model may do, one row per (model, purpose), with the default-for-purpose flag held per capability. This replaces the single `ai_provider_models.purpose` column, which forced one registry row per job and so produced duplicate rows for a model used for two. An idempotent migration backfilled every stored purpose into this table and merged those duplicates, losing no capability; `purpose` and `is_default_for_purpose` are left in place, deprecated and unread.
- **`article_quality_gate`** — the latest Quality Gate evaluation for an article: status, the per-severity counts, the full per-check detail as JSON, and a content fingerprint so a result that predates an edit can be reported as stale rather than trusted. One row per article, and no history: unlike a generation attempt, an evaluation is free and reproducible, so re-running it is cheaper than storing every result that ever was.
- **Eight columns on `ai_provider_models`** recording validation and test state separately — `validation_status`/`code`/`message`/`validated_at`, and `last_test_status`/`message`/`mode`/`last_tested_at` — so a stale passing test is never mistaken for a fresh one. None of them ever holds a credential.

**No schema exists.** No tables, fields, relationships, or storage engine have been chosen. The `database/` directory exists as a placeholder in the folder structure only. Per this milestone's constraints, no schema is to be invented, and no database (e.g. SQLite) is to be installed or initialized.

## Future Expansion

A concrete schema should be proposed here once Version 1 scope defines what data the system actually needs to track, and once the system architecture defines how that data will be accessed.

## TODO

- TODO: Choose a storage engine consistent with the local-first principle.
- TODO: Define the article data model (fields, states, revision history).
- ~~TODO: Define the author data model.~~ **Resolved (Milestones 2, 3, 11 and 16):** `authors` holds the structured persona fields, `author_writing_samples` the approved samples, `author_themes` the many-to-many link to thematic areas, and `author_skills` the long-form authoring documents.
- ~~TODO: Define how quality gate and SEO results are stored and linked to articles.~~ **Resolved (Milestones 14 and 15):** SEO results are stored in `article_seo` (configuration and metadata, 1:1 with the article), `seo_analysis_runs` (one row per analysis attempt), `seo_findings`, `seo_recommendations`, `seo_internal_links`, `seo_external_sources` and `seo_image_requirements`. Quality Gate results are stored in `article_quality_gate` (Milestone 15), 1:1 with the article and holding the latest evaluation only. Both sit **beside** the article rather than on it, so either can be run, discarded and re-run without the article ever changing — and they stay separate from each other, because quality and SEO are different judgements that an article can pass and fail independently.
- TODO: Define backup/versioning strategy for local data.
