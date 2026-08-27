# Milestones

## Purpose

This document tracks the milestone-based development plan for Cynth, so that progress happens in discrete, reviewable steps rather than all at once.

## Scope

This document covers the sequencing and status of milestones. It does not define the detailed scope of any single milestone beyond Milestone 0, which is recorded below; future milestones are intentionally left undefined until they are formally scoped and approved.

## Responsibilities

This document should:

- Record each milestone's number, name, and status.
- Record the stopping point of the current milestone.
- Avoid speculating about future milestone content beyond what has been explicitly approved.

## Current Status

| Milestone | Name | Status |
|---|---|---|
| 0 | Project Binder | **Complete** — documentation structure created per this binder. Stopped as instructed; no further milestones started. |
| 0.5 | Decision Lock | **Complete** — Product-Owner-approved decisions applied to [02_VERSION1_SCOPE.md](02_VERSION1_SCOPE.md), [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md), [05_UI_GUIDELINES.md](05_UI_GUIDELINES.md), and [04_DEVELOPMENT_RULES.md](04_DEVELOPMENT_RULES.md), resolving the TODOs that were blocking implementation. Documentation only — no application code, dependencies, or project scaffolding created. Stopped as instructed. |
| 1 | Application Foundation | **Complete** — built the frontend and backend shell only, per the Decision Lock: React + TypeScript client (Vite) and Node.js + Express server, both feature-based, under `app/client/` and `app/server/`. Seven placeholder pages (Dashboard, New Article, Authors, Products, SEO Review, Quality Gate, Settings), permanent left navigation with icons, active-page highlighting, and a responsive drawer below 880px. No database, no AI integrations, no API keys, no WordPress, no authentication, no business logic. Stopped as instructed. |
| 2 | Database Foundation | **Complete** — connected the server to a local SQLite database (Node's built-in `node:sqlite`, no third-party driver). All 7 tables created via idempotent `CREATE TABLE IF NOT EXISTS`; `article_types` seeded with the 10 requested types on first run, skipped on subsequent runs. No AI, no business logic beyond initialization/seeding. Stopped as instructed. |
| 3 | Author Management System | **Complete** — full CRUD for author profiles plus multiple writing samples per author, end to end (SQLite ⇄ REST API ⇄ React UI). Expanded the `authors` table (short bio, tone, target audience, writing notes) via an idempotent migration; added `author_writing_samples`. Authors list with search/category/status filters, detail page, create/edit forms with validation. No AI analysis, no writing-style extraction. Stopped as instructed. |
| 4 | Product Library | **Complete** — full CRUD for products plus local image uploads (multiple images per product, one primary), end to end. Expanded the `products` table (short description, editorial fit, is_active) via migration; added `product_images`. Images stored locally under `database/uploads/products/`, only file paths in SQLite. Products list with search/category/status filters, detail page with image gallery (upload/replace/remove/set-primary), create/edit forms. No AI summaries, no scraping, no Amazon integration. Stopped as instructed. |
| 5A | Foundation Bug Fixes | **Complete** — fixed two bugs only, no new features: (1) the New Article page now fetches and displays the seeded article types via a new read-only `/api/article-types` endpoint; (2) the Dashboard's Authors/Products/Recent Articles cards now show live counts from the database via a new read-only `/api/dashboard/summary` endpoint, instead of static placeholder text. Stopped as instructed. |
| 5B | Article Type Selection | **Complete** — the New Article page's article type cards are now selectable (native radio group, exactly one at a time), each with a name, short description, and a (?) help toggle showing the full description. Added minimal draft persistence to support save/reload: `POST/PUT/GET /api/articles` (create a bare draft, update its article type, fetch by id) — no title/content editing, no list, no delete. Saving navigates to `/new-article/:id`, so reopening that URL re-fetches the draft and re-selects its saved type. Stopped as instructed. |
| 6 | Content Brief Workflow | **Complete** — extended the New Article page into the full eight-step wizard (Article Type, Author, Topic, Title, Keywords, Product, Content Brief, Editorial Review), with draft persistence covering all of it, not just the article type. Expanded the `articles` table (topic, target audience, search intent, reader pain points, questions to answer, important topics, notes) via an idempotent migration. `POST/PUT/GET /api/articles` now save and reload the complete draft, including an optional linked author and product (existence-checked, not required to be active) and a 1:1 `keywords` row per article (primary/secondary keywords). New client components: `AuthorPicker`, `ProductPicker`, `ContentBriefFields`, `StepIndicator`, `EditorialReviewSummary`. Still no title/content generation, no AI, no publishing — the review step's "Generate" actions are placeholder buttons only. Stopped as instructed. |
| 7 | Prompt Builder | **Complete** — added `GET /api/articles/:id/prompt`, which assembles one complete, human-readable prompt from an existing draft: the article's type/topic/title/keywords, the selected author's full voice profile and writing samples, the optional product's editorial notes, the content brief fields, and a fixed set of generation instructions (stay in the author's voice, respect preferred/prohibited expressions, never present the result as publish-ready). Returns clear validation errors instead of building anything if required fields (article type, author, topic, working title) are missing. Pure text assembly — calls no AI model and sends nothing externally. Added a read-only Prompt Preview page at `/new-article/:id/prompt` (character/word counts, copy to clipboard, export as `.txt`). Stopped as instructed. |
| 8 | AI Provider Management | **Complete** — full CRUD for AI provider configuration and their models, plus the Model Router. Added `ai_providers` and `ai_provider_models` tables. Provider API keys are never written to SQLite — only the name of the environment variable that holds one (`api_key_env_var`); the key value itself lives in a local, gitignored `.env.local` file and is loaded into `process.env` once at server startup (`shared/secrets/providerSecrets.ts`). Only one default provider system-wide, and one default model per purpose, enforced in the repository (same unset-others-then-set pattern used for `product_images.is_primary`). `POST /:id/test-connection` returns a fixed placeholder message and calls nothing external — no provider has actually been contacted by the system at any point. Added the Model Router (`model-router/`): given a task purpose, a pure database lookup returns which configured provider/model would handle it, without ever contacting that provider or exposing the key itself. Wired into the Prompt Preview page as a "Prepare For Generation" check, which reports the configured provider/model for Article Generation but sends no request. Client: new Settings → AI Providers screens (list, detail, create, edit). No AI model has been called by Cynth at any point through Milestone 8. Stopped as instructed. |
| 9 | AI Generation Engine | **Complete** — the first working prompt → configured AI model → response → Cynth pipeline. See the detail section below. |
| 10–12 | Content Architecture, Author Persona, Model Pricing | **Complete in code, not recorded here.** Milestone 10 added the project/theme/topic content architecture and article provenance snapshots; Milestone 11 added the author persona and topic guidance fields; Milestone 12 added model pricing metadata, the cost-safety layer, and project editorial guidance. The work is in the codebase and documented in `shared/database/migrations.ts`, but these three milestones were never given rows here or entries in [CHANGELOG.md](CHANGELOG.md). Recorded as a gap rather than reconstructed after the fact. |
| 13 | Content Production System | **Complete** — OpenRouter model discovery and the provider-independent model registry, per-generation model selection with pricing shown, the WordPress CMS connector with draft-only publishing and duplicate protection, the single-process production server, Windows startup/recovery, and the backend health indicator. See the detail section below. |
| 14+ | TODO | Not yet scoped. The next milestone is the SEO Engine. |

Milestone 0's deliverable was strictly limited to: the `docs/`, `prompts/`, `data/`, `app/`, `database/` folder structure, populated documentation files, and this `README.md`. No application code, dependencies, or implementations were created, per instruction.

Milestone 0.5's deliverable was strictly limited to resolving documentation TODOs per an approved Decision Lock. No application code, dependencies, or project scaffolding were created, per instruction.

Milestone 1's deliverable was strictly limited to the application shell described above. No database, AI integrations, API keys, WordPress integration, authentication, or business logic were created, per instruction.

Milestones 2 through 5A were run under instructions not to modify this binder, so their records were added retroactively once that restriction lifted (Milestone 5A) — the summaries above reflect what was actually built, not what was documented at the time.

Milestones 6 through 8 were built on 2026-08-07, in the same working session as Milestone 5B, but were never recorded in this binder at the time — this document and [CHANGELOG.md](CHANGELOG.md) stopped at Milestone 5B while the code kept going. The only place this work had been documented in the meantime was [`app/server/src/features/README.md`](../app/server/src/features/README.md), which names Milestones 6, 7, and 8 directly. The gap was identified during a review of the project on 2026-08-25, and the records for 6 through 8 above were added retroactively at that point, reconstructed from the actual code (`app/server/src/features/articles/`, `app/server/src/features/prompt-builder/`, `app/server/src/features/ai-providers/`, `app/server/src/features/model-router/`, and the corresponding client features) rather than from any contemporaneous notes, since none existed.

## Milestone 9 — AI Generation Engine (Complete, 2026-08-25)

The first milestone in which Cynth actually calls an AI model. Everything below was verified against the running application before this record was written.

### What was built

- **AI Generation Engine** (`app/server/src/features/generation/`) — the complete pipeline: article draft → Prompt Builder → Model Router → provider adapter → configured AI model → normalized response → saved back to the draft, with one `generation_history` row per attempt.
- **Provider-agnostic generation interface** — a single `ProviderAdapter` contract (`generate(GenerationRequest, ProviderCallContext) → NormalizedGeneration`) defined in `generation.types.ts`. Adapters are the only code that knows a vendor's API shape, and the only code that ever sees an API key. Adding a further provider means adding one adapter file and one entry in the registry (`providers/index.ts`); the engine, routes, and UI are untouched.
- **OpenRouter adapter** — `POST {base}/chat/completions`, `Authorization: Bearer`, plus OpenRouter's optional `X-Title` app-identification header (product name only — no key, no user data, no URL). Default base URL `https://openrouter.ai/api/v1`.
- **Anthropic adapter** — `POST {base}/v1/messages`, `x-api-key` plus the required `anthropic-version: 2023-06-01` header, and the required `max_tokens`. Concatenates the response's text content blocks and ignores any other block type. Default base URL `https://api.anthropic.com`.
- **OpenAI adapter** — `POST {base}/chat/completions`, `Authorization: Bearer`. Default base URL `https://api.openai.com/v1`. OpenAI and OpenRouter share one Chat Completions implementation (`providers/openAiCompatible.ts`) and differ only where they genuinely differ.
- **Model Router integration** — the Article Generation task is routed by the existing Model Router (Milestone 8) via the `article_generation` purpose. The provider and model are never chosen by the frontend; the generation endpoint accepts no provider or model parameter. The task type is a parameter throughout the engine, so future tasks (title generation, keyword expansion, SEO review, quality review) route through the same path without rework.
- **Prompt Builder integration** — the prompt comes only from the existing Prompt Builder (Milestone 7). No second prompt-building system was created, and the Prompt Builder's output text was not changed. Verified by diffing the request body actually sent to a provider against `GET /api/articles/:id/prompt` — byte-identical.
- **Generated article persistence** — a successful generation is saved against the existing draft. The generated body reuses the existing `articles.content` column; the model's own title is stored separately in `generated_title` so the editor's working title (`articles.title`) is never overwritten. Provider, model, and timestamp are stored alongside it. Re-saving the draft from the New Article wizard does not disturb the generated article.
- **Generation history** — every attempt, successful or failed, is recorded in the `generation_history` table created back in Milestone 2: draft id, provider name, provider type, model, task type, timestamp, success/failure, error code and message, duration, and any token usage the provider actually reported. Token counts are never estimated: where a provider reports nothing (Anthropic reports input/output but no total), the value stays NULL rather than being inferred.
- **Error handling** — thirteen error codes covering missing provider configuration, missing API key, missing model, unsupported provider type, invalid configuration, authentication failure, unknown model, rate limiting, provider API error, timeout, network failure, malformed/empty response, and a duplicate in-flight request. Each maps to an HTTP status and a plain-language message. Provider wording is kept where it is useful (an unknown model id, an exhausted quota) but is redacted and truncated first; no headers, credentials, or raw provider payloads are ever returned or stored.
- **Retry handling** — Cynth never retries automatically. One attempt per request. Failures report whether repeating the identical request could plausibly succeed, and the UI offers a Retry button on that basis only; the decision is always the user's.
- **Human approval remains required before publication** — generation never changes an article's status. A generated article stays a draft, is labelled as AI-generated in the UI, and nothing in this milestone can publish anything anywhere.

### Supporting changes

- **Database** (additive only, via the existing idempotent migration pattern; no existing data destroyed): `articles` gained `generated_title`, `generated_at`, `generated_provider`, `generated_model`. `generation_history` gained `provider_type`, `model`, `status`, `error_code`, `error_message`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `duration_ms`; its Milestone 2 `action` column now holds the task type, and `payload` holds a small fixed JSON metadata summary.
- **API** — `GET /api/articles/:id/generation` (preflight: routed provider and model, article type, author, product, prompt size, and anything blocking — reads local configuration only, contacts nothing), `POST /api/articles/:id/generate`, `GET /api/articles/:id/generation-history`.
- **UI** — a Generate Article panel on the New Article wizard's Editorial Review step (step 8) showing the selected provider, selected model, article type, author, product, and prompt size before generation; a disabled button plus live status naming the provider and model during generation; and the generated title, body, timestamp, provider, and model afterwards. Configuration problems link through to Settings → AI Providers.
- **No new dependencies.** The adapters use the runtime's built-in `fetch`; no vendor SDK was installed. The server still depends only on `express` and `multer`.
- **Security** — API keys remain outside SQLite (Milestone 8's `.env.local` mechanism, unchanged). One new server-side-only function returns a key value, solely so an adapter can authenticate its own request; it is never reachable from a route response, a log line, or the database. A verification pass over every table and every generation API response found no key material. One finding was fixed during the milestone: OpenAI echoes a partially-masked key back in its 401 message, which would otherwise have been persisted in the history record, so redaction now also covers anything beginning with a known key's prefix.

### Known limitations at completion

1. **No live successful generation was performed.** The API key configured for the "OpenRouter Main" provider is an 18-character placeholder left over from Milestone 8 testing, so live calls return an authentication failure. All three adapters were verified against the real vendor endpoints (correct URL, correct headers, correct error mapping) and end to end against a local stand-in provider, but no real article has yet been generated by a real model. Adding a genuine key in Settings → AI Providers is all that remains.
2. **The configured OpenRouter model ID may need updating.** The stored model is `anthropic/claude-3.5-sonnet`; if OpenRouter no longer serves that id, generation fails with a clear `model_not_found` message pointing at AI Provider settings.
3. **Title extraction is heuristic.** The Prompt Builder does not dictate an output format and was deliberately not changed, so the engine reads whatever the model produced: a leading level-1 Markdown heading, an explicit "Title:" line, or a short unpunctuated first line followed by a blank line is taken as the title. Otherwise the whole response is kept as the body and the draft's working title is shown in its place. Nothing is ever discarded.
4. **Anthropic generation is capped at 4000 output tokens.** The Messages API requires an explicit `max_tokens`, and this value sits below every current Anthropic model's output cap so a correctly configured model is never rejected. Long articles may be truncated; the provider's `finish_reason` is recorded in the history metadata. OpenAI and OpenRouter are sent no output cap.
5. **No streaming.** One blocking request per generation; the UI shows an activity indicator, not real progress.
6. **180-second request timeout.** A provider that has not responded within that window is abandoned and reported as a timeout; nothing is saved.
7. **The duplicate-generation guard is in-memory.** It prevents a double-click or a second browser tab from starting a second billable call for the same draft, which is sufficient for a single-user, single-process local application, but it does not survive a server restart mid-generation.
8. **Generation uses the saved draft state.** Unsaved edits in the wizard are deliberately not sent — the draft must be saved first.
9. **Regeneration replaces the current article body.** Generation history retains the metadata of every prior attempt, but not the text of superseded drafts.
10. **The provider connection-test endpoint remains the Milestone 8 placeholder.** `POST /api/ai-providers/:id/test-connection` still returns a fixed message and contacts nothing; a real implementation was out of this milestone's scope, though the adapters now make one straightforward.

Not built, per this milestone's constraints: SEO readiness scoring, SEO review, AI-slop or rabbling detection, the Quality Gate, affiliate-link placement, automatic long-tail keyword or title generation, Amazon integration, product or review scraping, WordPress publishing, and Novamira integration. Stopped as instructed.

## Future Expansion

Each future milestone should be scoped and approved before work begins, and recorded in this table once defined. Per Rule 8 in [04_DEVELOPMENT_RULES.md](04_DEVELOPMENT_RULES.md), this document and [CHANGELOG.md](CHANGELOG.md) must be updated at the close of every milestone, before the next one begins, without waiting for the Product Owner to ask.

## TODO

- TODO: Define Milestone 1 scope (this must come from project review, not be assumed).
- TODO: Define the overall milestone roadmap toward Version 1 ([02_VERSION1_SCOPE.md](02_VERSION1_SCOPE.md)).
- TODO: Define what "review" means between milestones (who approves, what criteria).
- ~~TODO: Going forward, update this file and [CHANGELOG.md](CHANGELOG.md) at the close of each milestone as originally intended, rather than after the fact — see the note above on Milestones 6–8.~~ **Resolved (2026-08-25):** made binding as Rule 8 in [04_DEVELOPMENT_RULES.md](04_DEVELOPMENT_RULES.md) and first applied at the close of Milestone 9.


## Milestone 13 — Content Production System

The milestone that moved Cynth from a working content-generation engine to a content-production system: it can now be told which models exist, which one to use and what that costs, and it can hand finished work to WordPress.

### OpenRouter model management

- **No hardcoded model list.** `GET /api/ai-providers/:id/catalog` reads the provider's live catalogue — 417 models at the time of writing — and reports id, display name, vendor, context length, input/output pricing, per-request pricing, capability metadata (modalities, tokenizer, output cap, supported parameters, moderation) and availability. Cached for 15 minutes; any refresh bypasses the cache.
- **Free/paid by price, never by name.** A model is free only when its input and output prices are both known and both zero, and any flat per-request charge is zero. Nothing reads the model id, which matters because OpenRouter ships ids ending in `:free`, paid models with "free" in their names, and genuinely-free models with no marker at all.
- **Unknown is not free.** Missing prices classify as `unknown` and are treated as paid. Negative prices — OpenRouter's sentinel for models whose cost depends on where they route, used by five live models — are normalised to unknown rather than taken literally, which would otherwise have produced a negative estimated cost.
- **Discover → inspect → add.** Models are added to the registry from the UI, with the pricing read server-side from the provider's catalogue; the request names a model and nothing more, so a browser cannot assert what a model costs.
- **Provider-independent registry.** `Provider → Model Registry → Generation`. The Anthropic and OpenAI adapters are untouched.
- **Refresh preserves user configuration.** Re-reading a catalogue updates provider-owned metadata only; display name, purpose, enabled state and default-for-purpose are never rewritten. A model missing from a catalogue keeps its last known pricing and is flagged as no longer listed.

### Cost safety

- The New Article workflow offers a model picker grouped by cost class, showing provider and per-million-token pricing on every option and a summary of the selection beneath it.
- A selected model is the model that runs. No path substitutes another — not the purpose default, not a cheaper one, not a working one. A selection that cannot run is an error.
- Selecting a paid model does not bypass Milestone 12's spend gate: Test mode refuses it outright, Production mode requires an explicit per-request confirmation, and the confirmation resets whenever the model changes.

### WordPress

- **A connector, not a WordPress engine.** `CYNTH → CMS Connector → WordPress`. The word "WordPress" appears only inside the connector and in UI labels.
- **The contract has no publish operation.** Draft-only is structural, not procedural — see [12_WORDPRESS.md](12_WORDPRESS.md).
- **Test Connection distinguishes four failures** — unreachable site, unavailable REST API, rejected credentials, and an account that cannot post — and creates nothing.
- **Duplicate protection.** `article_cms_links` records the remote post; a second push is an explicit **Update WordPress Draft**, `mode` is verified against reality rather than trusted, and an update to a post a human has published is refused.
- **Credentials** use the same store as AI provider keys: only the env var name reaches SQLite, only `hasCredential` reaches the browser.

### Server architecture

- Express serves the built client from the same process as the API. `npm run build` then `npm start` at the project root; development still uses Vite.
- `scripts/install-startup-task.ps1` registers a Windows scheduled task with crash recovery; `status.ps1` reports both the task state and `/api/health`.
- A persistent backend health indicator in the app shell, reversing this binder's earlier deferral — see [14_LOCAL_SERVICE_MANAGEMENT.md](14_LOCAL_SERVICE_MANAGEMENT.md).

### Deliberately not built

The SEO Engine, the web-intelligence crawler, the backlink engine, and an article editor. `CmsSeoMetadata` is declared and threaded through the push path but always `null`, so the SEO milestone changes one function rather than reopening the connector.
