# Changelog

All notable changes to the Cynth project binder will be recorded in this file.

## [0.10.0] - 2026-08-25

### Summary

Milestone 9 (AI Generation Engine). The first milestone in which Cynth actually calls an AI model — prompt → configured model → response → saved draft:

- **`app/server/src/features/generation/`** (new) — the full pipeline: article draft → Prompt Builder → Model Router → provider adapter → configured AI model → normalized response → saved back to the draft, with one `generation_history` row per attempt. The task type is a parameter throughout, so future AI tasks (title generation, keyword expansion, SEO review, quality review) route through the same path.
- **Provider-agnostic generation interface** — one `ProviderAdapter` contract (`generation.types.ts`). Adapters are the only code that knows a vendor's API shape and the only code that ever sees an API key. Adding a provider means one adapter file plus one registry entry; the engine, routes, and UI are untouched.
- **Three adapters** — **OpenRouter** (`/chat/completions`, Bearer auth, plus OpenRouter's optional `X-Title` header carrying the product name only), **Anthropic** (`/v1/messages`, `x-api-key` + `anthropic-version`, required `max_tokens`, text content blocks concatenated), and **OpenAI** (`/chat/completions`, Bearer auth). OpenAI and OpenRouter share one Chat Completions implementation.
- **Model Router integration** — Article Generation routes through the existing Model Router via the `article_generation` purpose. The frontend cannot pick a provider: the generation endpoint accepts no provider or model parameter.
- **Prompt Builder integration** — the prompt comes only from Milestone 7's Prompt Builder, whose output text was not changed. Verified by diffing the request body actually sent to a provider against `GET /api/articles/:id/prompt` — byte-identical. No second prompt-building system exists.
- **Generated article persistence** — the generated body reuses the existing `articles.content` column; the model's own title is stored separately in `generated_title`, so the editor's working title is never overwritten. Provider, model, and timestamp stored alongside. Re-saving the draft from the wizard leaves the generated article intact.
- **Generation history** — every attempt, successful or failed, recorded with draft id, provider, provider type, model, task type, timestamp, outcome, error code and message, duration, and any token usage the provider actually reported. Token counts are never estimated — where a provider reports nothing, the value stays NULL.
- **Error handling** — thirteen error codes (missing provider configuration, missing API key, missing model, unsupported provider type, invalid configuration, authentication failure, unknown model, rate limit, provider API error, timeout, network failure, empty/malformed response, duplicate in-flight request), each mapped to an HTTP status and a plain-language message. Useful provider wording is kept but redacted and truncated; no headers, credentials, or raw provider payloads are ever returned or stored.
- **Retry handling** — Cynth never retries automatically. One attempt per request; the UI offers a Retry button, and the decision is always the user's.
- **Human approval remains required before publication** — generation never changes an article's status. Generated articles stay drafts, are labelled as AI-generated, and nothing here can publish anything.
- **Database** (additive, idempotent migrations, no data destroyed): `articles` gained `generated_title`, `generated_at`, `generated_provider`, `generated_model`; `generation_history` gained `provider_type`, `model`, `status`, `error_code`, `error_message`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `duration_ms` (its Milestone 2 `action` column now holds the task type).
- **API** — `GET /api/articles/:id/generation` (preflight; reads local configuration only, contacts nothing), `POST /api/articles/:id/generate`, `GET /api/articles/:id/generation-history`.
- **UI** — a Generate Article panel on the wizard's Editorial Review step showing selected provider, selected model, article type, author, product, and prompt size before generation; a disabled button and live status during it; and the generated title, body, timestamp, provider, and model afterwards, with configuration problems linking to Settings → AI Providers.
- **No new dependencies** — the adapters use the runtime's built-in `fetch`; no vendor SDK was installed.
- **Security** — API keys remain outside SQLite, on Milestone 8's unchanged `.env.local` mechanism. One server-side-only function returns a key value, solely so an adapter can authenticate; it is never reachable from a route response, a log line, or the database. A sweep of every table and every generation API response found no key material. One issue was found and fixed during the milestone: OpenAI echoes a partially-masked key in its 401 message, which would have been persisted in the history record, so redaction now also covers anything beginning with a known key's prefix.

### Known limitations

1. **No live successful generation was performed** — the key configured for "OpenRouter Main" is an 18-character placeholder from Milestone 8 testing, so live calls fail authentication. All three adapters were verified against the real vendor endpoints and end to end against a local stand-in provider, but no real article has yet been generated by a real model.
2. **The configured OpenRouter model ID may need updating** (`anthropic/claude-3.5-sonnet`); if unavailable, generation fails with a clear `model_not_found` message.
3. **Title extraction is heuristic** — a leading `#` heading, a "Title:" line, or a short unpunctuated first line followed by a blank line is taken as the title; otherwise the whole response is the body and the working title is displayed instead. Nothing is discarded.
4. **Anthropic generation is capped at 4000 output tokens** (the Messages API requires an explicit `max_tokens`); long articles may be truncated, with `finish_reason` recorded in history. OpenAI and OpenRouter are sent no output cap.
5. **No streaming** — one blocking request; the UI shows activity, not real progress.
6. **180-second request timeout**, after which the attempt is abandoned and nothing is saved.
7. **The duplicate-generation guard is in-memory** — sufficient for a single-user, single-process local application, but it does not survive a server restart mid-generation.
8. **Generation uses the saved draft state** — unsaved wizard edits are deliberately not sent.
9. **Regeneration replaces the current article body**; history retains the metadata of prior attempts, not superseded text.
10. **The provider connection-test endpoint remains the Milestone 8 placeholder** — `POST /api/ai-providers/:id/test-connection` still contacts nothing.

### Also

- **[04_DEVELOPMENT_RULES.md](04_DEVELOPMENT_RULES.md):** Appended Rule 8 — when a milestone is agreed complete, [13_MILESTONES.md](13_MILESTONES.md) and this changelog must be updated to reflect the actual implementation and its known limitations before the next milestone begins, without waiting to be asked. This resolves the standing TODO in [13_MILESTONES.md](13_MILESTONES.md) about the documentation gap that opened during Milestones 6–8.

## [0.9.0] - 2026-08-07

*Recorded retroactively on 2026-08-25 — this shipped on 2026-08-07 but wasn't logged here at the time. See the note on Milestones 6–8 in [13_MILESTONES.md](13_MILESTONES.md).*

### Summary

Milestone 8 (AI Provider Management). Full CRUD for AI provider configuration and their models, plus the Model Router:

- Added `ai_providers` and `ai_provider_models` tables. Provider API keys are never written to SQLite — only the name of the environment variable holding one (`api_key_env_var`). The key value itself lives in a local, gitignored `.env.local` file (`app/server/.env.local`) and is loaded into `process.env` once at server startup — see `app/server/src/shared/secrets/providerSecrets.ts`.
- **`app/server/src/features/ai-providers/`** — full CRUD for providers (create, edit, activate/deactivate, set default, delete) and their models (add, edit, enable/disable, set default-for-purpose, delete). Only one default provider system-wide, and one default model per purpose, enforced in the repository (same unset-others-then-set pattern used for `product_images.is_primary`). `POST /:id/test-connection` returns a fixed placeholder message and calls nothing external.
- **`app/server/src/features/model-router/`** — given a task purpose (e.g. "article_generation"), a pure database lookup returns which configured provider/model would handle it and whether an API key is set for it, without ever contacting that provider or exposing the key value itself.
- **`app/client/src/features/ai-providers/`** — Settings → AI Providers list, detail page, create/edit forms.
- The Prompt Preview page gained a "Prepare For Generation" section that calls the Model Router to show which provider/model is configured for Article Generation — still read-only, still no request sent anywhere.
- No AI model has been called by Cynth at any point through this milestone. No AI provider SDK is installed as a dependency.

## [0.8.0] - 2026-08-07

*Recorded retroactively on 2026-08-25 — this shipped on 2026-08-07 but wasn't logged here at the time. See the note on Milestones 6–8 in [13_MILESTONES.md](13_MILESTONES.md).*

### Summary

Milestone 7 (Prompt Builder). Assembles a complete, human-readable prompt from an existing article draft:

- **`app/server/src/features/prompt-builder/`** (new) — `GET /api/articles/:id/prompt` collects the draft, its author, and its optional product from the database and stitches together one prompt: article details (type, topic, working title, keywords), the author's full voice profile and writing samples, the product's editorial notes (if any), the content brief fields, and a fixed block of generation instructions (match the author's philosophy/tone/style, use preferred expressions, never use prohibited ones, and never present the result as publish-ready). Returns clear validation errors instead of building anything if required fields (article type, author, topic, working title) are missing on the draft.
- Pure text assembly — calls no AI model, sends nothing externally.
- **`app/client/src/features/new-article/PromptPreview.tsx`** (new) — read-only page at `/new-article/:id/prompt` showing the assembled prompt with character/word counts, a "Copy Prompt" button, and an "Export Prompt (.txt)" download.

## [0.7.0] - 2026-08-07

*Recorded retroactively on 2026-08-25 — this shipped on 2026-08-07 but wasn't logged here at the time. See the note on Milestones 6–8 in [13_MILESTONES.md](13_MILESTONES.md).*

### Summary

Milestone 6 (Content Brief Workflow). Extended the New Article page from a single article-type selector into the full eight-step wizard: Article Type, Author, Topic, Title, Keywords, Product, Content Brief, Editorial Review — with draft persistence covering all of it, not just the article type:

- Expanded `articles` (topic, target audience, search intent, reader pain points, questions to answer, important topics, notes) via an idempotent migration.
- **`app/server/src/features/articles/`** — `POST/PUT/GET /api/articles` now save and reload the full draft: an optional linked author and product (existence-checked so a draft stays valid even if that author/product is later deactivated, but not required to be active), plus a 1:1 `keywords` row per article (primary/secondary keywords).
- **`app/client/src/features/new-article/`** — new `AuthorPicker`, `ProductPicker`, `ContentBriefFields`, `StepIndicator`, and `EditorialReviewSummary` components. The wizard still saves progress at any step and reopening a draft's URL restores it exactly where it was left.
- The Editorial Review step's "Generate Title" / "Generate Long-tail Keywords" actions are placeholder buttons (`ComingSoonButton`) that show "Available in a future milestone." — no AI, no actual generation, no publishing.

## [0.6.0] - 2026-08-07

### Summary

Milestone 5B (Article Type Selection). The New Article page's article type cards are now selectable:

- Native radio-group cards (exactly one selectable at a time), each showing the type's name, a short (line-clamped) description, and a (?) help button that toggles the full description. Selected card gets a clear visual state (accent border/background + a "Selected" badge) — all via native radio semantics, so screen readers and keyboard navigation get this for free.
- **`app/server/src/features/articles/`** (new, minimal) — `POST /api/articles` (create a bare draft with just an article type + 'draft' status), `PUT /api/articles/:id` (update the draft's article type), `GET /api/articles/:id` (fetch a draft). Validates the article type actually exists. No title/content editing, no author/product linking, no list or delete endpoints — only what save/reload of the type selection needs.
- Saving navigates to `/new-article/:id`; reopening that URL re-fetches the draft from SQLite and re-selects its saved article type — verified via a genuine hard navigation, not just client-side state.
- No AI, no actual drafting/content editing — the "Drafting isn't available yet" notice remains, now clarified that saving only stores the selected type.

## [0.5.0] - 2026-08-07

### Summary

Milestone 5A (Foundation Bug Fixes). Fixed two bugs only, per instruction — no new features:

- **New Article page wasn't loading Article Types.** Root cause: the page never called an API — it was Milestone 1's static placeholder, and no endpoint existed to expose `article_types`. Fixed by adding a read-only `GET /api/article-types` endpoint and wiring the page to fetch and display all 10 seeded types on load.
- **Dashboard didn't reflect existing data.** Root cause: the Authors/Products/Recent Articles cards were a hardcoded constant, never wired to any data source. Fixed by adding a read-only `GET /api/dashboard/summary` endpoint (COUNT queries only, no other logic) and wiring the Dashboard to display live totals — including a genuine `0` for Recent Articles rather than placeholder text.

New backend modules: `features/article-types/` and `features/dashboard/` (both read-only). No CRUD, no business logic, no new tables. Existing Authors and Products functionality re-verified working (no regressions).

## [0.4.0] - 2026-08-06

### Summary

Milestone 4 (Product Library). Full CRUD for products plus local image management, end to end (SQLite ⇄ REST API ⇄ React UI):

- Expanded `products` (short description, editorial fit, is_active) via an idempotent migration; old `image_path`/`status` columns left in place, unused. Added `product_images` (multiple images per product, one flagged primary).
- **`app/server/src/features/products/`** — full CRUD routes, `multer`-based multipart upload (JPEG/PNG/WEBP/GIF only, 8MB limit, server-generated filenames), local storage under `database/uploads/products/`, static file serving at `/uploads/...`. Deleting a product or an image cleans up its file(s) from disk.
- **`app/client/src/features/products/`** — Products list (search, category filter, status filter, thumbnail), detail page with a full image gallery (upload, replace, remove, set-as-primary), create/edit forms with validation.
- No AI product summaries, no scraping, no Amazon integration, no article generation.

## [0.3.0] - 2026-08-06

### Summary

Milestone 3 (Author Management System). Full CRUD for author profiles plus multiple writing samples per author, end to end (SQLite ⇄ REST API ⇄ React UI):

- Expanded `authors` (short biography, tone, target audience, writing notes) via an idempotent migration; old `approved_writing_samples` column left in place, unused. Added `author_writing_samples` (title, notes, full text per sample).
- **`app/server/src/features/authors/`** — full CRUD routes including nested writing-sample endpoints and an activate/deactivate endpoint.
- **`app/client/src/features/authors/`** — Authors list (search, category filter, status filter), detail page with writing-sample management, create/edit forms with validation.
- No AI analysis, no writing-style extraction, no article generation.

## [0.2.0] - 2026-08-06

### Summary

Milestone 2 (Database Foundation). Connected the server to a local SQLite database:

- Used Node's built-in `node:sqlite` (`DatabaseSync`) — no third-party driver, zero new dependencies.
- All 7 tables (`authors`, `products`, `article_types`, `articles`, `keywords`, `settings`, `generation_history`) created via idempotent `CREATE TABLE IF NOT EXISTS`, safe to run on every startup.
- `article_types` seeded with the 10 requested types on first run only (`INSERT OR IGNORE` + empty-table check — no duplicate seeding on restart).
- No AI, no database schema for future engine components beyond the agreed table shapes, no business logic beyond initialization and seeding.

## [0.1.0] - 2026-08-06

### Summary

Milestone 1 (Application Foundation). Built the application shell only, per the Decision Lock in [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md):

- **`app/client/`** — React + TypeScript, scaffolded with Vite. Feature-based structure (`src/features/*`, `src/shared/{components,config,services,types,styles}`). Seven placeholder pages (Dashboard, New Article, Authors, Products, SEO Review, Quality Gate, Settings), each with a page title, short description, and placeholder content. Permanent left sidebar with a hand-drawn icon set, active-page highlighting, and a responsive collapse to a toggleable drawer below 880px. Dashboard shows five static summary cards (Recent Articles, Authors, Products, SEO Status, System Status); Settings shows four static, non-functional sections (AI Providers, WordPress, Editorial, General). Plain CSS with a small design-token set — no UI framework dependency. Only new runtime dependency: `react-router-dom`.
- **`app/server/`** — Node.js + Express, TypeScript, run via `tsx`. Feature-based structure (`src/features/` reserved and empty, `src/shared/{config,middleware}`). A single `/api/health` route plus a 404 handler and a generic error handler — no other routes, no database, no business logic. Ships unwired from the client (no REST endpoints beyond health check exist yet to consume).
- No database, AI integrations, API keys, WordPress integration, or authentication were implemented, per Milestone 1's constraints.
- Corrected two now-stale "not yet implemented" statements in [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md) and [05_UI_GUIDELINES.md](05_UI_GUIDELINES.md) to reflect what Milestone 1 actually built.

## [0.0.2] - 2026-08-06

### Summary

Milestone 0.5 (Decision Lock). Applied Product-Owner-approved decisions to resolve the TODO placeholders blocking implementation:

- **[02_VERSION1_SCOPE.md](02_VERSION1_SCOPE.md):** Version 1 is a single-user, local-first editorial engine running on Windows, requiring human approval before publication, with no authentication and no collaboration. Supports multiple AI providers, article drafting, editorial review, and manual publishing to WordPress. Everything else marked Future Version.
- **[03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md):** React + TypeScript frontend, Node.js + Express backend, SQLite database (chosen, not yet implemented), REST communication between frontend and backend, feature-based architecture throughout.
- **[05_UI_GUIDELINES.md](05_UI_GUIDELINES.md):** Local web application with a permanent left navigation and responsive main content area; primary workflow Dashboard → New Article → Editorial Review → Manual Publish; design goals of fast, simple, minimal, readable, human-first.
- **[04_DEVELOPMENT_RULES.md](04_DEVELOPMENT_RULES.md):** Appended Rule 7 — non-product engineering decisions (build tooling, folder naming, linting, routing, etc.) may be made by the Lead Software Engineer without Product Owner approval; product decisions always require it.

Documentation only — no application code, dependencies, or project scaffolding were created.

## [0.0.1] - 2026-08-06

### Summary

Initial creation of the Cynth Project Binder (Milestone 0). Established the full documentation folder structure (`docs/`, `prompts/`, `data/`, `app/`, `database/`) and populated every planned markdown document with purpose, scope, responsibilities, current status, future expansion, and TODO sections. No application code, dependencies, database, or AI implementation was created, per Milestone 0's constraints.
