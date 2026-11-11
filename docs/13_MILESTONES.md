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
| 14 | SEO Engine | **Complete** — the SEO intelligence layer between article generation and CMS submission: per-article SEO configuration, deterministic and AI-assisted analysis, structured passage-level findings, an explainable 0-100 readiness score, the pre-WordPress SEO gate, internal/external link and image opportunities, structured-data eligibility, CMS-independent SEO metadata, and the architecture (only) for web sources, provenance and backlinks. See the detail section below. |
| 15 | Model Management, EFD Verification, Quality Gate & SEO Status | **Complete** — AI model capabilities and validation, the verified EveryFiveDays WordPress connection and first real draft push, the Quality Gate, the visible SEO Status, and Web Crawl formally deferred to Phase 2. See the detail section below. |
| 16 | Author Skills | **Complete** — an author's identity can be supplied as a long-form document, stored and sent to the model verbatim, beside the structured persona fields. Thematic area → author selection, and an import/export folder. See the detail section below. |
| 17 | Product Research & Contextual Insertion | **Complete** — the first registered web retriever (one authorised page, robots-obeying), structured-metadata extraction, the `research` capability routed for the first time, several products per article, author-decided placement, and the product card carrying the user's affiliate URL verbatim. See the detail section below. |
| 18 | Product Placement Review, Durable Images & Product Themes | **Complete** — placement reviewed by the SEO Review stage (advice, never an edit), durable local copies of retrieved product images, a thematic area per product, and four retrieval defects found by testing Milestone 17 — including a redirect authorisation hole. See the detail section below. |
| 16+ | TODO | Not yet scoped. |

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


## Milestone 14 — SEO Engine (Complete, 2026-08-27)

The milestone that put an SEO intelligence layer between article generation and WordPress. Everything below was verified against the running application before this record was written.

### What was built

- **The SEO engine** (`app/server/src/features/seo/`) — the complete path: Article + editorial context + SEO configuration → deterministic analysis → optional AI-assisted analysis → merged structured findings → score → gate decision, persisted beside the article.
- **SEO understands the editorial context.** The engine reads the article's Project, Theme, Topic, Author persona, Article Type and content brief through the existing `generationContext.service.ts`. The reviewing model sees what the writing model saw; nothing is analysed as a generic block of text.
- **SEO configuration** (`article_seo`) — target query, search intent (including `hybrid` with named secondary intents), supporting queries, concepts to cover, target audience, geographic target, objectives and notes. Every field is optional, including the target query: a topic-oriented article with no exact-match keyword analyses semantically rather than being refused.
- **Deterministic analysis** (`seoDeterministic.service.ts`) — free, always first, contacts nothing. Titles (presence, approximate SERP length, duplicates), meta description (presence, length, stuffing, duplicates), slug (format, length, stopwords, and a **blocking** finding when a published URL would move), headings (multiple H1, skipped levels, generic headings, empty sections), content (missing, unparseable, missing introduction, unscannable stretches), keyword usage (absence, overuse, placement), readability (long sentences, long paragraphs, repetitive openers), links (absent internal/external, uninformative anchors) and images (missing alt, generic filenames).
- **AI-assisted analysis** (`seoAi.service.ts`, `seoPrompt.service.ts`, `seoAi.parse.ts`) — search intent alignment, topical completeness, missing concepts/questions/entities, content usefulness, title/description/slug proposals, external source opportunities and image suggestions. It routes through the existing Model Router under the `seo_review` purpose and the existing provider adapters; no provider, endpoint or key is named in the SEO feature.
- **The document model** (`seoDocument.ts`) — the article body parsed into headings with ancestry, sections, addressable paragraphs, links and images, with character offsets, which is what makes passage-level findings possible.
- **Structured findings** — code, category, dimension, severity (`blocking` / `warning` / `recommendation` / `info`), origin (`deterministic` / `ai`), summary, explanation, recommendation, element, a **locator** (heading path, paragraph index, offsets, verbatim excerpt) and a confidence. A model's quoted passage is verified against the article before it is displayed; an excerpt that does not occur in the text is dropped and the finding says so.
- **The score** (`seoScore.service.ts`) — 0-100 across nine weighted dimensions, each scored and explained separately. A dimension that could not be assessed is reported as *not evaluated* and excluded from the average rather than credited or punished, and `coverage` states what fraction of the weighting was actually assessed. `info` findings cost nothing; AI penalties are weighted by the model's stated confidence; a dismissed finding stops costing points. The explanation states in words that the score measures SEO readiness and not article quality.
- **Recommendation → Proposed Change → Approved Change** — three distinct records. Approving a metadata proposal writes the field; approving advice about the article body records the decision and changes no prose, enforced by the repository, where only metadata fields have a column to write to.
- **The SEO gate** (`seoGate.service.ts`) — configurable criteria evaluated on the single path out of Cynth (`cmsPublish.service.ts`), before any network call, with a refusal recorded in the push history like any other. Defaults: enforcement on, an analysis required, an AI pass **not** required, blocking findings block, **no minimum score**, no warning limit, and a stale analysis refused. Every criterion reports its own verdict and reason.
- **Internal link opportunities** (`seoLinks.service.ts`) — deterministic, ranked against articles that actually exist in Cynth, with a stated reason and an anchor suggestion that says whether the phrase already appears in the source article. A model may only reference ids from a supplied list; any other id is discarded on parse, and the repository refuses a target that is not a real article.
- **External sources** — the distinction between a *recommended* source and a *verified* one is structural. Rows are created `unverified`, approval does not verify, and `markExternalSourceVerified()` requires a real retrieval id — which nothing in this milestone can produce.
- **Image SEO** — requirement records for alt text, filename, caption, purpose and descriptive context, including for images already in the body. No image is created and no image URL is invented.
- **Structured data** (`seoStructuredData.service.ts`) — eligibility decided by the data Cynth holds. Article qualifies; FAQ requires real question-and-answer pairs (an explicit question mark); HowTo requires genuinely *ordered* steps, so a bullet listicle does not qualify; Product is **not eligible** because Cynth holds no price, currency, availability or rating, and inventing them would put false markup on a real page; Breadcrumbs are deferred to the CMS.
- **CMS SEO adapter** (`cms/seoAdapter.ts`) — `CYNTH SEO Metadata → CMS SEO Adapter → WordPress SEO Plugin`. Milestone 13's always-null `buildSeoMetadata()` now returns real metadata, from human-owned values only. The `SeoFieldMapping` registry is deliberately **empty**: no SEO plugin is named anywhere, so nothing is written to post meta for a plugin that may not be installed.
- **Web intelligence foundation** — `web_sources`, `web_retrievals`, `web_findings`, and the `WebRetriever` / `WebResearchService` contracts. The retriever registry is **empty**, so Cynth cannot fetch any web page; `/api/web-intelligence/capabilities` reports that plainly. Provenance is enforced rather than encouraged: a finding requires a retrieval, a retrieval requires a user-created source, and a finding's source and URL are read from its retrieval rather than accepted from the caller.
- **Backlink foundation** — `backlink_opportunities` with the `discovered → recommended → approved / rejected → placed` workflow. Manual entry only; an authority signal without a stated source is refused; nothing writes a link into an article.
- **UI** — an SEO panel on the Article view (score with per-dimension explanation, findings with passage locators, configuration, metadata with proposal approval, opportunities and diagnostics, gate checks), a rebuilt cross-article SEO Review page, gate criteria settings, and web-source management. The push panel now states the gate decision.

### Cost control

- Deterministic analysis runs first, always, and costs nothing.
- The AI pass requires an explicit `includeAi`; a paid model on top of that requires an explicit `confirmedCost`. Neither is ever defaulted to true, and Test mode refuses a paid model outright.
- An AI analysis whose content and configuration fingerprints match an existing one is **reused instead of paid for again**, with an explicit Force option. Editing the article invalidates the reuse.
- A failed AI pass keeps the deterministic analysis and is recorded as `partial` rather than being discarded or reported as complete.
- **No real AI spend was incurred during this milestone.** Every AI path was exercised against a local mock provider on 127.0.0.1 priced at zero. The one live check against the real configuration was a preflight, which contacts nothing: it reported the configured paid model, an estimated $0.04 per run, and Test mode refusing it.

### Supporting changes

- **Database** (additive only, via the existing idempotent `CREATE TABLE IF NOT EXISTS` pattern; no existing data touched): `article_seo`, `seo_analysis_runs`, `seo_findings`, `seo_recommendations`, `seo_internal_links`, `seo_external_sources`, `seo_image_requirements`, `web_sources`, `web_retrievals`, `web_findings`, `backlink_opportunities`. No existing table was altered.
- **`generation/providerTarget.service.ts`** (new) — provider/model resolution extracted from the generation service so article generation and SEO analysis resolve identically. Article generation's behaviour is unchanged and its tests still pass.
- **API** — `/api/seo/*` (overview, configuration, metadata, analyze, runs, findings, recommendations, links, sources, images, gate criteria) and `/api/web-intelligence/*` (capabilities, sources, findings, backlinks). `cms_errors` gained `seo_gate_blocked`.
- **No new dependencies.** The document parser and the JSON extractor are hand-written, matching the precedent set by `articleMarkup.ts`.
- **Security** — the SEO feature never sees a credential. It resolves a provider through the shared resolver, whose API key is server-side only and reaches no route response, log line or database row. Provider error text passes through the existing redaction before it is stored. Web sources store a domain and permissions and nothing else.

### Known limitations at completion

1. **No AI-assisted analysis has been run against a real provider.** The configured `seo_review` model is a paid OpenRouter model and Cynth is in Test mode, which refuses it — correctly. Every AI path was verified end to end against a local mock. Switching to Production mode and confirming the cost is all that remains.
2. **Sentence splitting is approximate.** It feeds diagnostics whose thresholds are extreme enough that a mis-split cannot change a verdict, but the sentence count is not exact.
3. **Keyword matching is exact-phrase, without stemming.** "packs" does not match "pack". This is why those checks are labelled diagnostics and why judging whether a *concept* is covered is left to the AI pass.
4. **Slug stability uses Cynth's own slug as the published one.** `article_cms_links` does not record the slug a post was created with, so a slug change is detected against the article's current slug rather than the live URL.
5. **Internal link relevance is lexical.** Shared topic, shared theme and word overlap — not semantic similarity. The AI pass can add suggestions, but only against real article ids.
6. **No SEO plugin integration.** By design: the mapping registry is empty until EveryFiveDays' SEO stack is chosen.
7. **No web retrieval of any kind.** The tables and contracts exist; the retriever registry is empty, so `/api/web-intelligence/findings` returns an empty list and always will until a retriever is written.
8. **Backlink opportunities are entered by hand.** There is no discovery engine.
9. **The in-flight guard for AI analysis is in-memory**, matching the generation engine's, and does not survive a restart mid-analysis.

Not built, per this milestone's constraints: a web crawler, backlink discovery, automatic backlink insertion, autonomous rewriting, a full article editor, automatic WordPress publication, and any SEO-plugin-specific API. Stopped as instructed.


## Milestone 15 — Model Management, EFD Verification, Quality Gate & SEO Status (Complete, 2026-08-30)

A verification milestone rather than a feature milestone: the objective was to
make existing infrastructure usable and to establish, by evidence, which parts
of it actually work. One capability was deferred as a result.

### AI model management

- **A model is Provider → Model → Capability, and holds a SET of capabilities.**
  `ai_model_capabilities` replaces the single `purpose` column. Before this,
  registering one model for two jobs meant registering it twice: two rows for
  the same model, priced, validated and chosen between separately, both
  appearing in every picker. The migration merged those duplicates and carried
  every capability and default flag across; `ai_provider_models.purpose` is
  deprecated-but-preserved and no longer read.
- **`research` was added as a capability**, alongside article generation, SEO
  review, quality review, title generation and keyword expansion. The meta
  endpoint publishes each with a label, a description, and whether any Cynth
  workflow routes to it yet — so a capability that can be assigned but is not
  yet wired is offered honestly rather than hidden or oversold.
- **Defaults are per capability.** "The default article model" and "the default
  SEO model" are independent choices, and one model can hold both. Removing a
  capability that was a default leaves that purpose with *no* default rather
  than promoting some other model into the role.

### Model validation — and the bug that motivated it

The reported failure was:

> The provider returned a response Cynth could not read. Nothing was saved — you can try again.

**Root cause, reproduced and fixed.** A provider had been configured with the
Base URL `https://openrouter.ai/` — the website, pasted from a browser —
instead of `https://openrouter.ai/api/v1`, the API root. Every catalogue read
therefore requested `https://openrouter.ai/models`, which is a real page: it
answers HTTP 200 with `text/html`. The request succeeded, the JSON parse did
not, and the only thing said about it was that the response was unreadable.
True, and impossible to act on.

- **`providers/baseUrl.ts`** checks a Base URL before it is used. A URL on a
  provider's own host that is missing the API path is refused by name, with the
  corrected value quoted — never applied automatically, since a provider may
  legitimately sit behind a proxy.
- **An unparseable response now says what arrived** (an HTML page, an empty
  body, a non-JSON content type) and from which URL.
- **`modelValidation.service.ts`** runs an ordered pipeline, and the order is
  the diagnosis: `configuration → endpoint → credential → catalogue →
  live probe → normalisation`. Whichever stage fails names the actual problem
  instead of the symptom it eventually produced, and every stage reports what
  it established. Stages 1–4 contact nothing chargeable.
- **Validate, then save.** A model is written to the registry only after
  validation passes, and the row records what was verified and when.

### Test Model

- `POST /api/ai-providers/:id/models/:modelId/test` sends the smallest request
  that establishes the endpoint answers, the key authenticates, the model runs
  and the response parses. Four-word prompt, output capped at 16 tokens,
  response discarded. **It does not create an article.**
- **A free model is tested outright; a paid one is not.** Without explicit
  confirmation a paid or unpriced model returns 402 with the estimated cost,
  computed from published prices and the probe's actual shape. Unknown pricing
  is treated as paid, never as free.
- Validation state and test state are stored separately, so a stale passing
  test is never mistaken for a fresh one, and changing a model's id clears
  what was verified about the old one.

### Purpose filtering

`GET /api/ai-providers/selectable-models?purpose=…` returns only the models
registered for that capability, and the Model Router enforces the same rule —
so the separation is a property of the system rather than of one screen. The
New Article workflow asks for `article_generation`; the SEO pass routes through
`seo_review`.

### The Quality Gate

Built. See [11_QUALITY_GATE.md](11_QUALITY_GATE.md) for the checks, the
severities and the four statuses. Deterministic, free, calls no model, and
writes nothing to the `articles` table.

### SEO Status

The Milestone 14 engine produced runs, findings, a score and a gate decision —
everything except one plain answer to "where does this article stand on SEO?",
which left every screen deriving its own label. `seoStatus.service.ts` derives
that one answer *entirely* from what the engine already stored:

`Not Evaluated` · `In Progress` · `Passed` · `Needs Attention` · `Failed`

Reading a status runs no analysis and spends nothing. `getLatestAnalysisAttempt()`
was added so a failed run is distinguishable from never having tried — the gate
still evaluates only against a usable run.

### Quality and SEO are separate, and shown as a pair

    Quality Gate  →  SEO Status  →  WordPress Draft

`Quality: Failed / SEO: Passed` is a valid state, and is the one the existing
article is actually in. Neither gate blocks reading or editing; only the CMS
push path refuses, and only on the SEO gate.

### EveryFiveDays WordPress — verified, not assumed

- **Connection test**: four distinct stages — reachability, the `wp/v2` REST
  namespace, authentication, and the `edit_posts` capability. Result against
  the live site: reached `http://everyfivedays.local`, authenticated as
  `Metawaste`, `canCreateDrafts: true`. Nothing was created.
- **Draft push**: the existing article 3 was pushed and became **WordPress post
  277, status `draft`**, verified independently through the WordPress REST API
  — correct title, correct slug, 10,863 characters of content matching the
  preflight exactly.
- **Persistence**: the post id is stored in `article_cms_links`.
- **Duplicate protection**: a second `create` was refused (`already_pushed`);
  `update` modified post 277 in place. Three push attempts, **one** post on the
  site.
- The article row itself was not modified: `updated_at` is unchanged.

### Web Crawl — DEFERRED TO PHASE 2

> **Superseded in part by Milestone 17 (2026-09-02).** The registry is no
> longer empty: an `http` retriever reads ONE page named by the user, through
> an authorised source, obeying robots.txt. General crawling, site search and
> backlink discovery remain deferred — `discover()` is still unimplemented and
> nothing enumerates a site. The rest of this section describes the state at
> the close of Milestone 15 and is left as written.

Not operational, and not made to look operational. The retriever registry is
empty by construction, no endpoint fetches a URL, `getRetriever()` returns null
for every type, and nothing has ever been retrieved. The Web Sources panel is a
permission list, and now says so with a **Deferred to Phase 2** badge and an
explicit statement of what was verified. Web intelligence and backlink
discovery follow it into Phase 2.

### Supporting changes

- **Database** (additive): `ai_model_capabilities` and `article_quality_gate`
  tables; eight validation/test columns on `ai_provider_models`. One
  consolidating migration merged duplicate model rows, losing no capability.
- **API**: `/api/quality-gate` (list, per-article, evaluate, preview, meta);
  `POST /api/ai-providers/:id/validate-model`;
  `POST /api/ai-providers/:id/models/:modelId/test`; capability add/remove;
  `purpose` filtering on selectable models; SEO status on the SEO article list.
- **No new dependencies.**

### Cost

**No article was generated and no paid model was called.** The only live model
requests were probes against a free model, at zero cost. The paid-model test
path was exercised only as far as its refusal.

### Known limitations at completion

1. **The Quality Gate calls no model.** Every check is deterministic. Editorial
   judgement — tone, accuracy, whether the argument holds — is unassessed, and
   the `quality_review` capability that would carry it is assignable but not
   routed to.
2. **Placeholder detection is textual.** It finds bracketed text not followed
   by `(` and unrendered template variables. A placeholder written as ordinary
   prose ("we will add the price later") is not detected.
3. **Truncation detection is heuristic** where the provider reports no finish
   reason. Where one is reported, that is used instead and is authoritative.
4. **`research`, `quality_review`, `title_generation` and `keyword_expansion`
   are assignable but unrouted.** They are labelled as such in the UI.
5. **Provider metadata is only as good as the catalogue.** A provider with no
   catalogue (Anthropic, OpenAI) cannot have a model id confirmed by
   validation; those stages report as skipped rather than as passed.
6. **The Quality Gate stores only the latest evaluation.** Unlike a generation
   attempt, it is free and reproducible, so history is not kept.

---

## Milestone 16 — Author Skills (Complete, 2026-09-01)

A feature milestone with a narrow objective: let an author's identity be
supplied as a **document** rather than as a set of fields, and have that
document reach the model unchanged.

The five persona documents the Product Owner had already written did not fit
the `authors` table. Decomposing them into `tone`, `philosophy`,
`preferred_expressions` and the rest would have meant rewriting them, and would
have discarded the parts that do the most work — the voice samples and the
"never does" lists. So Cynth learned to carry a document.

### What a skill is

- **A skill is markdown, stored verbatim and sent verbatim.** Nothing parses
  it, summarises it, extracts fields from it, reflows it or escapes it. What
  the user wrote is what the model receives, character for character — em
  dashes, curly quotes and markdown tables included. This is tested, not
  assumed.
- **It does not replace the structured persona fields — it sits beside them.**
  Both are sent. Where they disagree, the prompt states plainly that the skill
  wins, and the `AUTHOR SKILL` section is emitted immediately after the
  summarised `AUTHOR` section so that instruction refers to something the model
  can actually see.
- **A skill is scoped to one author, or shared across all of them.** A shared
  editorial philosophy is one row, not the same paragraphs copied into five
  personas. Shared guidance is emitted before the individual voice, matching
  what it is: the belief every author holds, which each of them then writes
  their own way.
- **Nothing reaches the model that the user did not put there.** A skill must
  be active *and* assigned. An author with no skill produces no section at all,
  exactly as before this milestone — every pre-existing author still generates
  identically.

### The engine did not need rebuilding

The content architecture from Milestone 10 already had the relationships this
feature needed, unused:

- `author_themes` already mapped thematic areas to authors, many-to-many,
  editable from either end. Milestone 16 populated it; it did not change it.
- The New Article wizard already narrowed the author list to the selected
  area. It now goes one step further: **an area with exactly one active author
  selects that author automatically.** Only exactly one — the schema permits
  several authors per area on purpose, and choosing between them is an
  editorial decision Cynth does not make.
- `generationContext.service.ts` remained the single place where an article's
  configuration becomes editorial guidance, and `promptBuilder.service.ts`
  remained the only thing that renders it. Both gained a section; neither
  changed shape.

`PROMPT_VERSION` moved from `2` to `3`. Articles record the version they were
generated under, so nothing already produced was rewritten.

### The Author folder

The database is the source of truth. `CYNTH/Author/` is the exchange format:
where a document written outside Cynth arrives, and where an edited one is
written back.

- **Import** reads one file, or the whole folder. Re-importing an edited file
  updates the row it created before rather than adding a second — matched by
  `source_filename` — so the operation is idempotent.
- **Export** writes a skill back to the file it came from, so the folder and
  the database converge rather than drifting into variants.
- **Import All** is the one-time setup. For each document it finds an author by
  the name the document states, creating one if there is none, and links that
  author to the thematic area the document's own H1 names. It reports every
  decision file by file rather than summarising them away.
- Generation never touches the folder. Cynth works with it absent, renamed or
  emptied.

### What import refuses to guess

A folder may hold notes, templates and drafts beside personas. A document that
names no author is imported **inactive and unassigned**, and the user decides
what it is. On the EveryFiveDays folder that meant `shared-philosophy.md` and
`system-prompt-template.md` were both held back — correctly, since the second
is a specification of this milestone's own behaviour and would have been absurd
to send to the model. `shared-philosophy.md` was then set to shared scope
deliberately, by hand.

Likewise, an author created by import gets a **name and the document, and
nothing else**. Every structured persona field is left null. And a document
naming a thematic area the project has not configured is reported as unlinked
rather than having that area invented for it. Both are tested.

### Management

A new **Author Skills** screen (`/author-skills`) lists every skill with its
scope, its author, the thematic areas that author covers, its size and whether
it is active — and offers add, edit, reassign, activate/deactivate, delete,
import and export. An author's own page shows their skills read-only, and says
which shared skills also apply. Assigning authors to thematic areas stays where
it already lived, on the Thematic Areas page and the author's own page; the
skills table shows the result rather than duplicating the control.

### Supporting changes

- **Database** (additive, one new table): `author_skills` — `author_id`
  (nullable, `ON DELETE CASCADE`), `scope`, `name`, `slug` (unique), `body`,
  `source_filename`, `position`, `is_active`. No migration was needed; the
  table is new.
- **API**: `/api/author-skills` — list, get, create, update, delete,
  `PATCH :id/author` (reassign), `PATCH :id/status`, `GET /library`,
  `POST /library/import`, `POST /library/import-all`, `POST :id/export`,
  `GET /meta/scopes`.
- **CLI**: `npm --prefix app/server run import:skills` runs the same import as
  the Import All button, for when starting the app is the longer path.
- **Tests**: 22 new, 229 total, all passing. They cover verbatim delivery
  through to the assembled prompt, the opt-in rules, shared-skill behaviour,
  import idempotence, export round-tripping, path-traversal refusal, and that
  import creates no editorial content.
- **No new dependencies.**

### Verified against the real project

The five documents were imported into the live database. Five authors were
created — Mara Kessler, Devon Cho, Priya Anand, Theo Lindqvist, Naomi
Alvarez — and each linked to the thematic area their document names. Selecting
each of the five areas in the New Article wizard resolves to the right author
and reports the right skill. A prompt built for Sleep & Recovery came to 9,977
characters across eight sections, carrying Naomi Alvarez's persona and the
shared philosophy intact, with the template document absent.

### Cost

**No article was generated and no model was called.** Nothing in this milestone
contacts a provider.

### Known limitations at completion

1. **Skill content is not validated as editorial guidance.** Any markdown is
   accepted. Cynth checks that a document exists and is not empty; whether it
   is a good persona is the editor's judgement, not the engine's.
2. **The Quality Gate does not check an article against its skill.** The gate
   remains deterministic and calls no model, so "does this read like Naomi
   Alvarez" is still unassessed. A skill is a guardrail on generation, not a
   test applied afterwards.
3. **Ordering within a scope is by `position`, which nothing sets yet.** With
   one document per author it does not arise; several documents for one author
   currently assemble in insertion order.
4. **Import matches an author by name, exactly.** Two authors sharing a name
   would collide, and a document whose `**Name:**` line is punctuated
   differently from the stored author creates a second author rather than
   matching the first.
5. **`changedSinceImport` compares timestamps at one-second resolution**,
   because that is what SQLite stores. A file edited within the same second as
   its import would not be flagged.
6. **There is no diff between a file and the skill it produced.** The UI says
   whether they have diverged, not how.

---

## Milestone 17 — Product Research & Contextual Insertion (Complete, 2026-09-02)

The editor supplies product URLs they have already chosen. Cynth reads what
each product page publishes about itself, works out what the product is for,
and the author places it where it is genuinely relevant — or leaves it out.

The flow the milestone implements, end to end:

    Article brief -> Theme -> Author/Skill -> Provided products ->
    Product research -> Article generation -> Contextual placement -> Card

### The rule the whole milestone is built around

**The affiliate URL the user supplies is authoritative.** It is stored once,
verbatim, and emitted into the rendered card verbatim. Nothing normalises it,
strips its parameters, canonicalises it, or derives a replacement from the page
that was read. The page's own URL is stored in a *separate column*
(`products.source_url`) precisely so the link Cynth publishes and the page
Cynth read can never be confused for one another — and the model is never sent
the affiliate URL at all, so it cannot reproduce, mangle, or invent a variation
of it. All three properties are tested.

### Web Sources was extended, not replaced

Milestone 14 built the web-intelligence architecture and deliberately no
crawler: the retriever registry was empty by construction, so `getRetriever()`
returned null for every type and no code path could fetch a page. The
obligations it wrote down for whatever was registered first are the ones
`httpRetriever` now implements:

- it is given a `WebSource`, never a bare URL — that is the interface;
- it refuses a source whose crawl permission is off;
- it reads robots.txt and obeys it whenever the source says to, and treats a
  robots.txt it *cannot* read as a refusal rather than as permission;
- it honours the stricter of the source's rate limit and the site's own
  `Crawl-delay`;
- every fetch writes a `web_retrievals` row, with a content hash, so any later
  claim can name the fetch it came from.

It reads **one named page**. It implements no `discover()` and follows no
links: registering it did not turn Cynth into a crawler, and the test that used
to assert "Cynth can fetch nothing" was replaced with one asserting the
guarantee that still holds — that a retriever cannot be handed a bare URL.

An authorisation for one domain cannot be spent on another, and the retriever
identifies itself honestly (`CynthBot/1.0`) rather than as a browser, because
robots.txt compliance is meaningless from something disguised.

### Retrieval is not ingestion

Extraction reads **only what a page publishes for machines**: schema.org
`Product` in JSON-LD, OpenGraph tags, and the standard meta description. It
never returns page copy, never walks the DOM for prose, and the retrieved HTML
never reaches a model.

That is also why nothing is vendor-specific. There is no Amazon parser, no CSS
selector for any retailer, and no per-site branch — a marketplace, a Shopify
store and a manufacturer's own site all extract through the same code, and
`vendor` is derived from the host as data.

A page publishing no usable metadata is **refused, not guessed at**: the user
is told the page carried nothing and offered manual entry, which stays fully
supported throughout.

### Understanding: the first workflow to route to `research`

`research` had been an assignable model capability since Milestone 15, marked
`implemented: false` because nothing routed to it. It does now.

The understanding step answers one question — *what is this product for?* —
because that is what a placement decision actually turns on: a monitor light
and a desk organiser both fit "workspace setup" and belong in completely
different sections. It routes through the Model Router, passes the same spend
gate as article generation and SEO analysis (`confirmedCost` is never defaulted
to true), never substitutes a model, never retries, and records every attempt in
generation history. It is given the extracted fields only — never the page.

`generation_history.article_id` now accepts null, for the first task that is
not about one article. The column was always nullable; nothing had written null
to it before.

### Placement is the author's decision

An article can now carry several products (`article_products`). The prompt
offers them as an **inventory, not a requirement**, each led by what it is for,
and states plainly that leaving a product out is a correct outcome — because a
model told to use three products will use three products whether they fit or
not.

The author places one by writing `[[product:12]]` on its own line where it
belongs. That division is the point: the prose stays the author's, and the card
— image, title, features, link — stays Cynth's, assembled from stored records
rather than from anything a model wrote. A marker naming a product that was not
offered, or repeating one already placed, is discarded before the draft is
saved rather than reaching a reader.

Where each product ended up is recorded afterwards, including `omitted` for the
ones the author judged did not belong. That is stored as the real outcome it is.

### The product card

`articleMarkup.ts` renders a marker into a card on the WordPress push. Semantic
HTML with stable `efd-product-card` class hooks and no styling, no `<script>`,
no inline CSS and no external asset beyond the image — so it survives a static
export. Cynth does not know what an EveryFiveDays card looks like and does not
guess; the site's own stylesheet targets the classes.

Every affiliate link carries `rel="sponsored nofollow noopener"` and opens in a
new tab. An unlabelled monetised link is a disclosure problem, not a styling
one. A product with no affiliate link renders as a card *without* a link rather
than a card pointing somewhere else, and only http(s) URLs ever become an
`href` or an image `src`.

### Amazon, checked rather than assumed

The concern raised before implementation was that Amazon's robots.txt might
refuse product pages outright. It was checked with the parser that was built,
against the live file:

- `https://www.amazon.com/dp/<ASIN>` — **allowed**
- `https://www.amazon.com/Some-Title/dp/<ASIN>?tag=…` — **allowed**
- `https://www.amazon.com/gp/product/<ASIN>` — **allowed**
- `https://www.amazon.com/dp/shipping/<ASIN>` — refused (Amazon disallows it)
- `https://www.amazon.com/gp/cart/view.html` — refused (Amazon disallows it)

So ordinary product URLs are readable, and the paths Amazon does disallow are
correctly refused. Adding `amazon.com` as a source with crawl permission
remains **the user's explicit decision**, as the architecture always intended.

### Supporting changes

- **Database** (additive): `article_products` and `product_research` tables;
  nine research columns on `products`. `articles.product_id` is
  deprecated-but-preserved and still read, so drafts created before
  `article_products` keep their single product. `affiliate_link` was not
  touched.
- **API**: `/api/product-research` — `POST /check`, `POST /retrieve`,
  `GET|POST /:id/research`, `GET /:id/research/preflight`, and
  `GET|POST|DELETE /articles/:articleId/products`.
- **Prompt**: `PROMPT_VERSION` `3` → `4`; new `PRODUCTS AVAILABLE` and
  `PRODUCT PLACEMENT` sections, which supersede the single `PRODUCT` block.
- **Fixed**: `research` is no longer advertised as unrouted.
- **Tests**: 22 new, 251 total, all passing. They run against a local mock
  retailer on 127.0.0.1 — **no real website is contacted and no model is
  called**. They cover the affiliate URL surviving to the rendered card, the
  authorisation and robots refusals, that page copy never reaches the
  extraction, placement and omission, and that a product title cannot inject
  HTML into a post.
- **No new dependencies.**

### Cost

**No article was generated and no model was called.** The only network request
made during development was to `amazon.com/robots.txt` — a file published to be
read for exactly that question.

### Known limitations at completion

1. **Placement quality is unmeasured.** Cynth records where a product landed;
   nothing checks whether that was a *good* place for it. The Quality Gate is
   still deterministic and calls no model.
2. **A page that renders its metadata with JavaScript yields nothing.** The
   retriever reads the HTML the server returns and executes no scripts. Sites
   that publish JSON-LD only after hydration will extract as empty, which
   reports honestly as "publishes no product metadata".
3. **Product images are referenced, not stored.** The card points at the source
   image URL unless the editor uploads their own, so a retailer changing or
   removing that asset breaks the image in a published post. Uploading an image
   to the product is the durable path, and it always wins over the source URL.
4. **Prices and availability are extracted but never published.** They go stale
   immediately, and nothing renders them.
5. **No `discover()`.** A product must be named by URL; Cynth cannot search a
   retailer or enumerate a category.
6. **The rate limiter is process-local and in-memory.** It resets when the
   server restarts, and would not coordinate across two Cynth instances.
7. **Placement rationale is never populated.** The column exists, and the
   marker convention carries no reason — only a location.

---

## Milestone 18 — Product Placement Review, Durable Images & Product Themes (Complete, 2026-09-02)

Three improvements requested after testing Milestone 17, and a reported
failure — "Amazon retrieval does not take place" — that turned out to be four
separate defects, one of them a safety hole.

### The Amazon failure, reproduced

The instruction was not to assume Milestone 17 worked because its tests
passed. It did not.

**1. The link was `amzn.to`, not `amazon.com`.** A different domain, correctly
refused. Consent is per-domain and remains so; what changed is that the
message now names the domain to authorise.

**2. A safety hole.** The retriever used `redirect: 'follow'`, so
authorisation was checked against the URL the user typed and never against the
URL actually fetched. An authorised domain redirecting to an unauthorised one
would have been read anyway. Redirects are now followed by hand and **every
hop is re-authorised**; the provenance record names the URL actually read, and
a redirect chain is recorded. Read forwards, the same rule is the feature: a
shortener on an authorised domain can now resolve to an authorised
destination, because both were permitted — not because redirects are exempt.

**3. HTTP errors became products.** A 404 produced a product called **"Page
Not Found"**, because `hasUsableMetadata()` only required a title and an error
page has one. A non-2xx response is now a refusal. A title is no longer
sufficient on its own either: usable research needs a title *and* something
else the page published.

**4. Amazon publishes no usable product metadata.** This was the decisive
finding, and it is not a bug in Cynth:

```
jsonld = 0
og:title       = "Amazon"
og:description = "Amazon"
og:image       = .../share-icons/previewdoh/amazon.png   (the Amazon logo)
```

Amazon serves real pages to CynthBot — 200, ~900KB, no bot-wall — but its
OpenGraph block is site-level boilerplate. Milestone 17 would have created a
product named **"Amazon"** illustrated with the Amazon logo: worse than a
refusal, because it looks like it worked.

The fix is not an Amazon parser. Extraction now **detects a site-level
OpenGraph block** — by comparing og:title against og:site_name, against
og:description, and against the host's own name — and ignores it entirely,
falling through to the document title with its site suffix stripped. Nothing
in that logic names a retailer.

**Verified against the live site after the fix:**

| URL | Result |
|---|---|
| `/Amazon-vibrant-.../dp/B09B8V1LZ3` | title **"2022 Echo Dot 5th Gen Smart Speaker \| Charcoal"**, real description, og block ignored |
| `/dp/B08N5WRWNW` (dead ASIN) | refused: *answered HTTP 404, so there is no product page to read* |

**What this means for Amazon**, stated plainly: retrieval yields a title and a
description and **no image and no specifications**, because Amazon publishes
neither in machine-readable form. That is exactly why uploading a product
image matters, and it is the honest answer to "is direct retrieval
appropriate": for Amazon it is thin but real, and the sanctioned route for
richer data is the Product Advertising API, which requires the operator's own
PA-API credentials and was not built on speculation.

No safety or compliance rule was weakened to make any of this work.

### 1. Product placement is now reviewed

Milestone 17 let the author decide where a product belongs and checked nothing.
A new **`product_placement`** SEO category and a per-product verdict on
`article_products` close that.

- Routed through the **`seo_review`** capability — the same Model Router,
  spend gate, single-attempt rule and generation history as the AI SEO pass.
  No second AI system, and no new capability for the user to configure.
- The reviewer is shown the product, what research established it is for, the
  heading it landed under, and the prose immediately around the marker — not
  the whole article, because the question is local.
- **A good placement is reported as good.** A review that only ever complains
  leaves the editor unable to tell "checked and fine" from "not checked", so
  `good` is a first-class verdict with its own stored explanation.
- **It is a review, not an edit.** It writes only the review columns; `status`,
  `placement_section` and the article body are untouched. A better section is
  recorded as `review_suggested_section` — a suggestion, in its own column, so
  it can never be mistaken for a move that happened.
- Weak and misplaced verdicts also become SEO findings, so they reach the
  existing findings list, the score and the gate. Neither severity blocks: the
  author's decision stands unless a human changes it.
- A suggested section is discarded unless it names a heading the article
  actually has — the same discipline the SEO parser applies to internal links.
- Regenerating an article **clears every verdict**, because they described
  where products used to be.

Results appear on the SEO Review page, alongside the other review information.

### 2. Product images are stored locally

Multipart upload, `product_images`, the primary flag and
`database/uploads/products/` all already existed and were already preferred
over the source URL. What was missing was a durable copy of a **retrieved**
image.

An image found during research is now downloaded once and stored through the
same path as an uploaded one — same folder, same UUID filenames, same rows,
same `/uploads/...` serving. There is no second image system: once stored, the
product card cannot tell the two apart.

Conservative about what it will store: http(s) only, the same four types the
upload path accepts, the same 8 MB ceiling, Cynth's own filename (never one
derived from the remote URL), and the folder created if absent. A failure to
store an image is a warning, never a failed retrieval — the rest of the
research is still good. An editor's own primary image is never displaced.

### 3. Products carry a thematic area

`products.theme_id`, a nullable reference with `ON DELETE SET NULL` — retiring
an area removes the association, never the product. The five current areas are
nowhere in the implementation: every picker is built from the `themes` table.

- Assignable when adding a product, changeable later, and removable — via the
  form or a dedicated `PATCH /api/products/:id/theme` endpoint, so clearing it
  does not require resubmitting the whole product.
- The products list gains a Thematic Area column and a filter, including a
  distinct **"No thematic area"** option, because that is a different question
  from "any area".
- Generation is told the product's area and whether it differs from the
  article's — **as information, never as a filter**. A mismatch is stated with
  "that is not a reason to exclude it", because the editor attaching the
  product is the stronger signal, and a product filed elsewhere can still be
  exactly right.
- No mismatch is claimed when either side has no area. An unknown is not a
  conflict.

### There is no product limit, and there never was

Confirmed rather than asserted: nothing in the schema, repository, prompt
builder, context resolver or UI caps the number of products on an article. The
three URLs in Milestone 17 were a test fixture. A test now attaches **25
products** to one article and asserts that every one of them reaches the
prompt.

The real constraints are the ones any prompt has: each product adds roughly
100–200 characters, and a very large set will eventually meet the model's
context window. Nothing truncates silently.

### Supporting changes

- **Database** (additive): `products.theme_id`; six review columns on
  `article_products` (`review_verdict`, `review_assessment`,
  `review_suggested_section`, `review_confidence`, `review_model`,
  `reviewed_at`).
- **API**: `PATCH /api/products/:id/theme`; `themeId` filter on
  `GET /api/products` (accepts `none`);
  `GET|POST /api/product-research/articles/:id/placement-review`.
- **SEO**: `product_placement` added to `SEO_CATEGORIES`.
- **Tests**: 18 new, 269 total, all passing, against a local mock retailer on
  127.0.0.1. **No real website is contacted and no model is called.** They
  cover each of the four Amazon defects, the redirect hole in both directions,
  the durable image on disk, theme assign/reassign/clear/filter, the mismatch
  wording, review storage leaving the author's placement intact, and 25
  products on one article.
- **No new dependencies.**

### Cost

**No article was generated and no model was called.** The only live network
requests were to Amazon's `robots.txt` and two Amazon product pages, to
reproduce and then verify the reported failure.

### Known limitations at completion

1. **Amazon yields no image and no specifications.** Its product data is not
   machine-readable. Upload an image for Amazon products; the card prefers it
   automatically.
2. **A page that renders its metadata with JavaScript still yields nothing.**
   The retriever executes no scripts. Reported honestly rather than guessed at.
3. **The placement review reads the marker's surroundings, not the whole
   article.** A product that would be better placed in a section the reviewer
   was not shown can only be caught via the heading list.
4. **Placement review routes to `seo_review`, not `quality_review`.**
   `quality_review` remains assignable and unrouted. Using it would have been
   semantically neater and would have required configuring a second model to
   review a placement.
5. **The review is per-article and manual.** It is not part of the SEO
   analysis run, and nothing triggers it automatically.
6. **A product has one thematic area, not several.** Unlike author/theme,
   which is many-to-many. This matches what was asked for; a join table would
   be the change if a product ever needs to span areas.
7. **Stored images are never re-fetched.** If a retailer updates the product
   photo, Cynth keeps the copy it took.

---

## Milestone 19 — Amazon Creators API Integration (Complete, 2026-09-02)

Amazon product data now comes from Amazon's official API rather than from
reading Amazon pages. Milestone 18 established that reading them is pointless —
Amazon publishes no JSON-LD and its OpenGraph is site-level boilerplate — and
this milestone replaces that dead end with the route Amazon actually provides.

### Two paths, no fallback between them

    Generic websites  ->  Web Source + http retriever  (Milestone 17)
    Amazon products   ->  Amazon Creators API          (this milestone)

The router sits in `retrieveProduct()`: an Amazon URL goes to the API, anything
else to the existing retriever. The rule that makes this an integration rather
than a preference is that **there is no fallback between the two**. An Amazon
URL whose lookup fails — unconfigured, bad credentials, unknown ASIN, API
down — is reported as failed. It is never quietly read as a page. Three tests
assert it, including one that asserts *zero* network calls are made when the
API is unconfigured.

The generic Web Source system is untouched. Authorising `amazon.com` there no
longer does anything for products, and the preflight now says so rather than
sending the user to configure the wrong thing.

### The API, as specified by Amazon

Implemented against Amazon's Creators API documentation, not guessed:

| | |
|---|---|
| Auth | OAuth 2.0 `client_credentials`, scope `creatorsapi::default`, POSTed as JSON |
| Token host | `api.amazon.com` (v3.1 NA), `api.amazon.co.uk` (v3.2 EU), `api.amazon.co.jp` (v3.3 FE) |
| Endpoint | `POST https://creatorsapi.amazon/catalog/v1/getItems` |
| Headers | `Authorization: Bearer`, `Content-Type`, `x-marketplace` |
| Body | `itemIds`, `itemIdType`, `marketplace`, `partnerTag`, `resources` |
| Casing | lowerCamelCase, converted from PA-API's PascalCase |

Tokens last 3600 seconds and are cached per credential version, refreshed a
minute early. A 401 on a request drops the cached token so the next attempt
mints a fresh one. Rotating credentials clears the cache without a restart.

The resources requested are `itemInfo.title`, `itemInfo.byLineInfo`,
`itemInfo.features`, `itemInfo.productInfo`, `itemInfo.technicalInfo`,
`itemInfo.classifications`, `images.primary.large` and
`browseNodeInfo.browseNodes` — and the Settings screen lists them, so the
integration's reach is inspectable rather than implied. **Prices are
deliberately not requested**: Cynth never publishes one, so collecting it would
be gathering data with no use.

Because the response is the one place Cynth touches a third-party shape, the
mapper reads defensively: every field is optional, `displayValue` wrappers and
bare strings are both accepted, and the PascalCase spelling is tolerated
alongside the documented lowerCamelCase. A sparse response produces a sparse
product — `foundVia` names what actually came back — rather than invented
fields.

### The affiliate URL, unchanged

The rule from Milestone 17 holds and is now enforced across a second path: the
API supplies product *data* and never a link. The client is never given an
affiliate URL, `partnerTag` is used only to satisfy the API and never to build
a link, and the URL the user supplied is stored once and emitted into the card
verbatim. The Amazon page an ASIN was read from is recorded separately in
`source_url`, as before.

**Short links are resolved, not read.** `amzn.to` is what an Associates
dashboard hands you, and it carries no ASIN — so it is followed to its
destination and the *final URL* is used to read the ASIN. The response body is
discarded. That is identifier resolution, not content retrieval, which is why
it does not go through the Web Source system: no page data is involved.

### Credentials

Stored the way every other credential in Cynth is stored, with no second
mechanism invented: the two values go to the gitignored `.env.local` via the
existing secret store, **never to SQLite**, and the only fact any response
states about them is `hasCredentials`. Non-secret configuration — partner tag,
marketplace, credential version — lives in the `settings` table.

The partner tag is deliberately *not* treated as a secret: it appears in every
affiliate link on the site, so hiding it would be theatre.

`isConfigured` is reported as one answer rather than two, because credentials
without a partner tag cannot call the API and reporting them as "configured"
would promise something that fails.

A **Test Connection** button makes the smallest real call that exercises auth,
the partner tag and the endpoint together, and discards the result — the same
idea as the model Test button from Milestone 15.

### What the user must supply

Settings → Amazon Creators API:

1. **Credential ID** and **Credential Secret** — Associates Central → Tools →
   Creators API. Requires 10 qualifying sales in the last 30 days; Amazon
   revokes access if that lapses.
2. **Credential Version** — shown beside the credentials; selects the token
   region, and a mismatch is the usual cause of an auth failure.
3. **Partner Tag** — the Associates tracking ID, e.g. `yoursite-20`.
4. **Default Marketplace** — used only when a URL does not name one.

### Supporting changes

- **No schema change.** The Amazon path writes the same `products` and
  `product_research` rows the web path does; only
  `product_research.extraction_method` differs, recording `creators_api` so a
  field's provenance stays answerable. `retrieval_id` is null there, because
  nothing was crawled and recording a fetch that never happened would be false.
- **API**: `/api/amazon/config` (GET, PUT) and `/api/amazon/test` (POST).
- **No per-article product cap**, still. The client sends every ASIN in one
  request rather than one request per product; a test asserts 25 ASINs in a
  single call.
- **Tests**: 21 new, 290 total, all passing. `fetch` is stubbed for the whole
  Amazon file, so **no real Amazon request is made** and a test that reached
  the network would fail rather than silently pass.
- **No new dependencies.** The official SDK was not adopted: the surface Cynth
  needs is one token call and one getItems call, and a dependency would add a
  supply-chain surface for less code than it saves.

### Also fixed: the flashing terminal window

Unrelated to Amazon, reported alongside it. A console window was opening and
closing about once a minute.

**Cause.** The `CYNTH Server` scheduled task retries every minute after a
failure. Port 4100 was held by a **manually started server** — started during
Milestone 18's verification — so every retry hit `EADDRINUSE`, exited 1, and
flashed a window. `MultipleInstances: IgnoreNew` did not help: it prevents a
second *task* instance and knows nothing about a process started outside Task
Scheduler.

**Fixed** by stopping the orphan, and by registering the task with `-Hidden` so
a recovery attempt is never visible whatever the cause. The installer script
was updated too, so a reinstall does not reintroduce it. See
`docs/14_LOCAL_SERVICE_MANAGEMENT.md` for the operational rule this implies:
when the task is installed, restart *the task*, never start a second server by
hand.

### Cost

**No article was generated and no model was called.** No live Amazon request
was made during development — the integration was built against Amazon's
published specification and exercised against a stubbed transport.

### Known limitations at completion

1. **Verified live as far as Amazon allows; the data path is blocked on
   account eligibility.** A real Test Connection with real credentials
   confirmed the parts Cynth controls:

   - the OAuth token is issued — HTTP 200, `scope: creatorsapi::default`,
     `expires_in: 3600`, from `api.amazon.com` for credential version 3.1;
   - `POST https://creatorsapi.amazon/catalog/v1/getItems` reaches the service
     and is parsed — Amazon answered with a *semantic* refusal, not a
     malformed-request error, so the host, path, headers and body shape are
     right.

   Amazon then refused with HTTP 403:

   ```json
   {"message":"Your account does not currently meet the eligibility requirements.",
    "reason":"AssociateNotEligible","type":"AccessDeniedException"}
   ```

   That is the documented 10-qualifying-sales-in-30-days requirement, and
   nothing in Cynth can change it. **The response mapping remains unproven**:
   no real item has been returned, so `mapAmazonItem` has only ever run against
   the documented shape in tests. When the account becomes eligible, the first
   real lookup is what proves it.

   **Fixed while diagnosing this:** the error reader only understood the
   per-item `errors: [{code, message}]` form, so a top-level
   `{message, reason, type}` fault was discarded and reported as a bare
   "HTTP 403" — advising the user to re-check credentials Amazon had already
   accepted. It now reads both shapes, gives eligibility its own error code
   (`amazon_not_eligible`, distinct from an authentication failure), and
   explains the real blocker. A regression test carries the exact 403 body.
2. **Only `getItems` is implemented.** `searchItems`, `getVariations` and
   `getBrowseNodes` exist in the API and are not used — Cynth looks up products
   the user named and does not search Amazon.
3. **No description field.** The Creators API exposes features rather than a
   prose description, so `description` stays null on Amazon products and the
   research step works from the features instead. Nothing is synthesised to
   fill the gap.
4. **Availability is not tracked.** A product that goes out of stock or is
   delisted keeps whatever Cynth stored; nothing re-checks it.
5. **The rate limit is Amazon's, unmodelled.** Cynth batches ASINs into one
   request but implements no client-side throttle, so a burst of lookups could
   be rate-limited by Amazon. The error says so when it happens.
6. **Short-link resolution issues one plain HTTP request** to Amazon's
   shortener, outside the Web Source permission system. It reads only the final
   URL and never the body — but it is a request to Amazon that the Web Source
   rules do not govern, and that is a deliberate, documented exception rather
   than an oversight.

---

## Milestone 20 — The Editorial Pipeline Spine (Complete, 2026-09-03)

The multi-model editorial pipeline, built as a **controlled state machine**
rather than an agent loop. Cynth owns orchestration; models own thinking.

### The two numbers that make it controlled

`MAX_AUTOMATIC_REVISIONS = 1` and `MAX_AUTOMATIC_REVIEWS = 1` live in
`pipeline.constants.ts` and are enforced in backend code against counters held
on the pipeline row — not in a prompt, and not by a caller remembering to
check. Write → review → pass, or write → review → one surgical revision →
**deterministic validation** → stop. There is no path that reaches a second
revision and none that reaches a second review: after the revision the article
is checked by code, not by a model.

### The vocabulary

- **20 states**, persisted on every transition, so a run is resumable and its
  history is answerable. Terminal states are `READY`,
  `NEEDS_EDITORIAL_ATTENTION` and `FAILED` — and the middle one is not a
  failure. It means the automatic budget was spent and a human now decides.
- **10 stages**, each either costing money or producing persisted output.
  `paid` marks the ones that call a model, because those are the ones that
  must never re-run by accident.
- **6 roles** — topic research, keyword research, title selection, article
  writer, article reviewer, article revision. A role is distinct from a
  *capability*: a capability says what a model is able to do, a role says what
  it is doing in this pipeline, for this mode. That separation is what lets one
  model hold several capabilities while a role has exactly one primary and one
  fallback.

### Four gates, in one place

Every paid stage passes through `stageRunner.service.ts` in the same order, so
no stage author can forget one:

1. **Idempotence.** A stage with a successful run for this pipeline version
   returns that stored result and calls nothing. This is what makes a restart,
   a refresh or a reopened article free.
2. **The spend gate.** The same gate article generation and SEO analysis
   already used. Test mode refuses a paid model; Production requires explicit
   per-request confirmation. `confirmedCost` is never defaulted to true.
3. **The call.** One attempt on the primary model.
4. **Technical fallback.** Only if the primary failed for a *transport* reason
   — and the fallback passes the spend gate independently, so a free primary
   can never fall back to a paid model in Test mode.

**A parse failure is deliberately not fallback-eligible.** A malformed reply is
an editorial/format problem, not a transport one, so it never causes a second
model to be paid for the same question. A poor-quality result is likewise not a
technical failure: that path is the editorial revision, capped at one.

### Cost accounting

`getCostBreakdown()` reports per-stage estimates and a total. **A model with no
published pricing is reported as unknown, never as zero** — the breakdown
carries `hasUnknownCosts` so the UI can say the real total is higher rather
than quietly understating it.

### Supporting changes

- **Schema**: `article_pipelines`, `pipeline_stage_runs` (unique on
  `pipeline_id, pipeline_version, stage, attempt` — the idempotency key),
  `pipeline_transitions`, `pipeline_role_models`.
- **Model registry**: `roleDefaults.service.ts` seeds five models and six role
  assignments. Two documented substitutions were made because the named models
  no longer exist or are strictly worse: `claude-opus-4.8 → claude-opus-5`
  (same price, newer) and `gpt-5.5 → gpt-5.6-sol-pro` ($2/$10 against $5/$30 —
  cheaper *and* newer).
- **Dev/Production modes** select which models the roles resolve to. The
  stages and the rules are identical in both.
- **API**: `/api/pipeline` and `/api/pipeline/roles/:mode`.

### Cost

**No article was generated and no model was called.** Every test stubs
`fetch`.

### Known limitations at completion

1. **`amazon_matching` is a declared stage with no implementation.** Product
   opportunity → Creators API search → matching → placement needs
   `searchItems`, which Milestone 19 did not implement.
2. **No observability screen.** Stage outputs are retrievable at
   `/api/pipeline/:id/outputs` and tested, but nothing renders them.

---

## Milestone 21 — Article Templates & The Research Stages (Complete, 2026-09-03)

### Templates are two-layer and versioned

A template has a **content schema** (which sections an article must contain,
minimum length, whether it requires an FAQ or sources) and a **presentation
schema** (how EveryFiveDays should lay it out). The separation is the point:
Cynth decides what an article must *say*; the site decides what it looks like.

**A published template version is never overwritten.** An article written to
v1 still means what it meant. Eight templates are seeded on startup, and
`TEMPLATE_FALLBACKS` maps a type with no template of its own to a near
neighbour — recorded as `borrowed: true` rather than hidden.

The article carries its type, template id and template version, so
EveryFiveDays can resolve a presentation template later without re-deriving
anything.

### The research stages

**Topic research** → **keyword & title research** → **classification**. Each
one assembles a prompt from persisted configuration, hands it to the stage
runner, and validates the structured reply. Every stage returns structured,
persisted data.

Three rules are in the prompts because they are editorial rules, not
formatting preferences:

- **Judge the opportunity honestly.** A saturated or low-value topic is said to
  be one, rather than having enthusiasm manufactured for it.
- **Do not invent statistics, studies, traffic numbers or keyword volumes.**
  Where the model is reasoning from general knowledge it must say so.
- **Only list a source you can actually name.** An empty source list is better
  than a fabricated URL.

Topic research is **not discarded once an article exists**. It is the record of
why this article was worth producing, and later stages read it rather than
re-deriving it from the finished text.

### The classifier cannot invent a type

An article type outside the registered list fails the stage rather than being
coerced into the nearest match. A human override is recorded as an override
(`article_type_override`), so "the model said X, the editor chose Y" stays
visible.

### The brief

Assembled from what is already stored — research, keywords, classification,
template, author persona, project rules — with **no model call**. Where no
sources were captured, the brief says so explicitly rather than inviting
citations the writer would then invent.

### Cost

**No model was called.** Template selection and brief assembly are free by
construction, and tests assert that they make zero calls.

---

## Milestone 22 — Generation, Review, One Revision, Validation (Complete, 2026-09-03)

### The chain

**Write → review → at most one revision → deterministic validation.**

The writer receives the complete brief and the template's section list. The
reviewer is an **independent critic that does not rewrite**: it produces a
structured assessment and, where changes are needed, a precise specification of
them. A requested change must be actionable on its own — "improve this section"
is not a specification.

Two safeguards in the review parser:

- `revision_required` is trusted **only when there is something to act on**. A
  reviewer that asks for a revision and specifies nothing would spend the one
  revision on nothing.
- An issue with no stated change is dropped, because it is not executable.

### Validation replaces the second review

`validation.service.ts` runs **deterministic** checks: every required section
present and non-empty, minimum length met, FAQ present where the template
requires one, sources present where the template requires them, the primary
keyword actually used. No model is asked. This is what makes the one-revision
cap safe: the last word belongs to code.

The FAQ is reconciled deliberately — templates list `faq` as a section while
articles carry it as its own structured field, and it satisfies the
requirement either way.

### Both representations are persisted

`structured_content` (the template's sections, which validation checks and
which travels to WordPress) and rendered markdown (which everything that
already read `content` continues to read). Neither is derived from the other at
read time.

### Cost

**No model was called.** The chain is exercised against a stubbed transport.

---

## Milestone 23 — Media Library, The Orchestrator & Draft Deletion (Complete, 2026-09-03)

### The media library

Images for **articles**, as distinct from product images. Upload, describe,
file under a thematic area, and attach to an article. Available from the main
menu beside Thematic Areas and Authors, and from the Dashboard.

**Matching is deterministic and explained.** Cynth does not look at pixels. The
thematic area does most of the work — an article in one area never considers
another area's images — and the remaining ranking is term overlap between what
the editor wrote about the image and what the article is about. Every
suggestion carries the reasons it scored what it scored, so a ranking is never
unexplained. Unfiled images are included rather than hidden, because an
unfiled image is not necessarily wrong.

Attaching stays a separate, deliberate act: `/suggest` proposes and explains,
and nothing is attached by it.

### The orchestrator

`pipeline.orchestrator.ts` — the conductor that was missing. Before it, the
stages existed but nothing ran them in order, and the New Article wizard still
asked a person to type the topic, the scope and the keywords the pipeline was
built to produce.

`startArticlePipeline()` creates a **near-empty draft** — title, topic,
keywords, article type and brief are all things the pipeline produces.
`advancePipeline()` calls every stage unconditionally and relies on stage-level
idempotency, which is what makes it safe to call repeatedly, safe after a
restart, and free for work already done.

The new **Generate Article** screen asks for a thematic area and, optionally, a
steer. Nothing else.

### Deleting a draft

Deletion is irreversible and Cynth has no undo, so the flow is: **ask what
would happen, show it, and only then destroy anything.** A preflight names what
goes and what survives.

- **Goes**: the article, its generated content, its keyword record, its SEO
  configuration and analysis, its product and image attachments, its pipeline
  runs.
- **Survives**: the products, images and authors it referenced — those are
  shared — and the **generation history including what each attempt cost**.
  History is detached (`article_id` nulled) rather than deleted, so the record
  of what was spent is not erased along with the thing it was spent on.

**One blocker, and it is overridable rather than absolute.** An article that
exists as a CMS post refuses by default, because Cynth cannot delete a remote
post: deleting here removes only the link, the post stays published, and a
later push would create a duplicate. That consequence is what the message
leads with. The override reads "Delete anyway, and break the CMS link" rather
than "Delete", and `force` is never sent by default.

### Cost

**No model was called.**

---

## Milestone 24 — Guided Generation (Complete, 2026-09-04)

Requested as: break the single "Generate Article" action into steps that
present what Cynth produced and let the editor choose, with the option to skip
and let Cynth decide.

### A checkpoint is a persisted pause

Not a wizard step held in a component. A checkpoint is a row, so a guided run
survives a closed tab, a restart, or a week of neglect: the decision, and who
made it, is stored, and the **options are not** — they already live in the
stage run this checkpoint sits behind. Copying them would create a second
version of the truth that could drift from the first.

The URL carries the pipeline id (`/generate/:pipelineId`), so a paused run is
resumable by opening it again.

### Four checkpoints, after the work rather than before it

| Checkpoint | After | The question |
|---|---|---|
| Topic | topic research | Which of these four topics? |
| Title & keywords | keyword research | Which title, and which keywords? |
| Article type | template selection | Cynth classified this — is it right? |
| Review | article review | Accept the draft, or spend the one revision? |

Each sits **after** the stage that produced what is being decided, so the
editor chooses between real options the pipeline generated rather than
answering a blank form. Research first, decide second.

### Topic research now returns a shortlist

The prompt asks for **four genuinely distinct topics** — different questions,
different angles, or different points in the buying decision — ranked, with the
one it would produce first named. The output is flattened: the recommendation
is also readable at the top level, which is what leaves the automatic path and
every downstream stage unchanged.

Two parsing decisions:

- **A single-topic reply is read as a shortlist of one.** A model concluding
  that only one topic here is worth producing has answered the question asked.
- **A topic missing a required field still fails the stage.** Accepting a
  shorter list is not leniency about a broken one.
- A `recommended_index` pointing outside the list is corrected to 0 rather than
  trusted, so a model pointing at a topic it did not write cannot select
  nothing.

The cost estimate for the stage rose with the output (1,800 → 4,200 assumed
completion tokens), because under-assuming would understate the figure the
spend gate asks the user to confirm.

### What an answer can and cannot do

- **Choose** one of the produced options.
- **Override** with your own title, your own keywords, or your own topic.
- **Accept** the recommendation in one click — recorded as `accepted`, not as
  a choice.
- **Hand it back**: "Stop asking — finish it for me" switches the run to
  automatic and settles every outstanding decision. Those are recorded as
  `automatic`, never as `accepted`, so the history never claims a person
  approved something they only stopped objecting to.

A decision **cannot** invent an option: validation is strict, happens at
decision time while the person is still looking at the screen, and refuses an
index that does not exist rather than rounding to the nearest one.

**An answered checkpoint is never re-answered.** The stages behind it may
already have run on the first answer, and quietly changing it would leave the
article disagreeing with the run that produced it. Changing your mind after
that point is a new version.

### A custom topic is never presented as researched

Cynth has not researched a topic the editor typed, and it must never look as
though it had. The researched fields that cannot honestly carry over — sources,
competing coverage, timing, the content gap — are **cleared**, and the research
summary says plainly where the topic came from. Keyword research downstream
reads that summary, so the next model is told the truth too. The UI says the
same thing before the decision is made.

### Asking for different options costs money, and says so

"Ask for different options" is a real second execution of a paid stage. It goes
through the ordinary stage runner, so it passes the same spend gate as the
first and returns `cost_confirmation_required` until confirmed. It is available
only for checkpoints whose options a model produced, and only while the
checkpoint is **open** — nothing downstream can have been built on the answer
being replaced.

**The previous attempt is not deleted.** It stays in the run history with what
it cost, because money spent on options nobody chose was still spent.

### The cap is untouched

`MAX_AUTOMATIC_REVISIONS = 1` constrains revisions Cynth performs *by itself*.
Choosing a title is not an automatic revision. In guided mode a person may
decline the revision the reviewer asked for, or request the one the reviewer
did not — and neither path reaches a second. The panel states the remaining
count where the decision is made rather than in a footnote.

### Supporting changes

- **Schema**: `pipeline_checkpoints` (unique on `pipeline_id`,
  `pipeline_version`, `kind`); `article_pipelines.run_mode`, defaulting to
  `automatic` so no existing run changes character because the column arrived.
- **API**: `POST /api/pipeline/:id/checkpoints/:kind/decide`,
  `POST /api/pipeline/:id/checkpoints/:kind/rerun`,
  `POST /api/pipeline/:id/run-mode`; `POST /api/pipeline` accepts `runMode`.
- **Answering does not advance the run.** The next stage costs money, and
  someone who has just chosen a title has not thereby agreed to pay for the
  article.
- **Tests**: 18 new.

### Fixed

- **The review cap fired on a review that had already happened.** `canReview()`
  was checked *before* the idempotency gate, so re-entering `runArticleReview`
  — a resumed run, a refreshed page, or a guided run continuing after a
  decision — turned a stored result into `generation_in_progress`. The gate now
  comes first: returning the review that already happened is not a second
  review. The revision stage was deliberately **not** given the same shortcut —
  asking for a second revision is refused outright rather than quietly answered
  with the first one.
- **Stage output was read from the earliest successful attempt, not the
  latest.** Harmless until a checkpoint could re-run a stage; after a rerun it
  would have shown the editor one set of options while the pipeline consumed
  another.
- **A transient stage failure ended the run permanently, and the only way on
  was to pay for everything again.** A stage failure sets `FAILED`, which is
  terminal, so `advancePipeline` returned immediately ever after; the only
  route forward was a new version, which re-runs every stage from the
  beginning. A free model returning an empty response therefore cost the topic
  research that had already succeeded — and, in a guided run, the decision
  already made about it. `POST /api/pipeline/:id/retry` now reopens a failed
  run *in place*: it moves the state back to where the last successful stage
  left it and runs nothing. There is still no retry loop and nothing retries
  itself; completed stages are idempotent, so continuing afterwards re-runs
  only what actually failed. Verified live — one run whose keyword stage failed
  three times finished with topic research at a single successful attempt.
- **The new panels were unreadable in dark mode.** The checkpoint and
  featured-image styles referenced `--surface`, `--border` and `--accent`,
  which this app does not define — it uses `--color-*`. Every one of them fell
  through to a hardcoded light-theme fallback, so the option cards rendered
  white under near-white text. The styles now use the real tokens, and the two
  that genuinely did not exist (`--color-warning`, `--color-warning-soft`) were
  added to `tokens.css` in **both** the light and dark blocks, paired the way
  every other colour there is.
- A literal NUL byte in `migrations.ts` (a composite map key written as a raw
  control character) replaced with its escape sequence. Identical behaviour;
  the file is no longer treated as binary by `grep`.

### Verified live

A guided run was driven end to end against the **free** development models:
four distinct topics returned and offered, a topic other than the
recommendation chosen, an out-of-range choice refused
(`There is no topic 9 in this shortlist.`), and the title/keyword checkpoint
reached with six titles built from the **chosen** topic rather than the
recommended one. The keyword stage failed three times on the free model and
the run was resumed each time; `pipeline_stage_runs` ends with topic research
at **one** successful attempt, which is the proof that nothing was paid for
twice.

### Cost

**No paid model was called.** The live run used free development models.

### Known limitations at completion

1. **Guided mode asks four questions, not one per stage.** Classification,
   brief assembly and validation have no checkpoint — the first is decided at
   the article-type checkpoint, and the other two are deterministic.
2. **Keywords are edited, not chosen between.** The stage produces one keyword
   plan, so the checkpoint offers editing rather than competing strategies.
3. **A decision is final for the version.** Revisiting one means a new version,
   which re-runs every stage and is charged accordingly.

---

## Milestone 25 — Featured Image Generation (Complete, 2026-09-04)

Requested as: an AI model that reads the title and content and creates a
suitable featured image, with room for a better image model later.

### No new provider account was needed

OpenRouter publishes a dedicated image endpoint —
`POST /api/v1/images`, with `model`, `prompt`, `n`, `aspect_ratio` and
`output_format`, returning base64 images and a **reported cost** — and 52
image-output models, including Gemini 3.1 Flash Image, Seedream 4.5, Recraft
and the GPT image models. The existing OpenRouter provider record reaches all
of them, so no OpenAI or Google key is required.

(Corrected 2026-09-05. This originally said eleven, which is how many the
default catalogue read returns; 41 more are visible only under a second query.
See *Fixed after completion* below.)

`generateImages` is an **optional** adapter method. A provider without it
cannot be asked for an image, and the caller is told so rather than being
silently routed elsewhere.

### Cost is reported, never estimated

Image models are priced **per image**, not per token, so unlike every text
stage there is no honest up-front estimate — a token count cannot produce one.
Therefore:

- The spend gate still runs. An image model is never free, so **Test mode
  refuses image generation outright** and Production requires an explicit
  confirmation that is never defaulted to true.
- The confirmation says what it actually knows: charged per image, exact figure
  unknown until the provider answers.
- The figure recorded afterwards is **the one the provider reported**
  (`usage.cost`), tagged `costBasis: 'provider_reported'`. Where the provider
  reports nothing it is recorded as `unreported` and stays null — unknown, not
  zero. OpenRouter bills a generation in full or not at all, so there is no
  partial charge to account for.

### Suggest before generating

The panel is ordered by cost, cheapest first: what is already attached, then
what Cynth already owns that fits (the Milestone 23 deterministic matcher,
free), and only then drawing a new one. The cheapest good image is one already
owned.

**Nothing on this path runs as part of the pipeline.** It costs money and is
never triggered by anything except a person pressing the button.

### What Cynth will not draw, and why

Three constraints live in the **prompt builder**, not the UI, so no caller can
generate an image without them:

- **No real products, brands, logos or packaging.** EveryFiveDays recommends
  real things people can buy. An image model asked for "hiking backpacks" will
  happily draw a photorealistic backpack that does not exist, with an invented
  logo — and on a page that earns commission that is a misleading picture of a
  product, not a stylistic choice. Featured images are conceptual, scene-level
  or abstract; real products are photographed.
- **No recognisable real people.**
- **No text, lettering or numbers.** Image models still garble lettering, and a
  headline rendered with a misspelling is worse than no headline. If the title
  belongs over the image it goes in the page template, where it is real
  selectable text.

The prompt is assembled from the article — title, topic, thematic area and its
guidance, audience — exactly as text prompts are, and is **readable before
paying for it** (`GET /featured-image/:id/prompt`, free). An article with
neither a title nor a topic is refused rather than handed to a model with an
empty brief, which would make one up.

### A candidate is not a library image

Generated candidates wait in a pending folder until one is chosen. Only the
chosen one becomes a media asset — so rejecting all four leaves nothing in a
library the editor curates by hand. A new batch replaces the previous one,
because choosing between candidates generated from two different prompts is not
a choice worth offering.

The chosen image is filed under the article's thematic area, marked
`credit: AI-generated` and tagged `ai-generated`, so it stays identifiable as
machine-made to whoever finds it in the library a year from now.

### Supporting changes

- **No schema change.** A chosen image is an ordinary `media_assets` row; the
  per-image charge is recorded in `generation_history.payload`, because the
  token columns cannot hold a charge that is not a token charge.
- **New capability** `image_generation` in `MODEL_PURPOSES`, assignable in
  Settings → AI Providers like any other.
- **API**: `/api/featured-image/:articleId` (GET), `/prompt` (GET),
  `/generate` (POST), `/select` (POST), `/candidates` (DELETE).
- **The candidate id is validated, not trusted.** It is a filename Cynth
  generated, and it is still checked against a strict character set and the
  article it belongs to — a path separator there would write outside the
  uploads folder.
- **Tests**: 14 new. No real provider is contacted and no real image model is
  paid.

### Cost

**No image was generated against a real provider.** The integration was built
against OpenRouter's published specification and exercised against a stubbed
transport.

### Fixed after completion (2026-09-05)

Three defects found by using the feature, two of them in this milestone's own
work.

1. **Most image models were invisible.** `GET /models` is not the whole
   roster. It answers with 431 models of which only eleven produce images —
   the multimodal chat models. `GET /models?output_modalities=image` answers
   with 52, and **41 of those appear nowhere in the first list**: Seedream,
   Recraft, MAI-Image, Muse, Grok Imagine. The adapter read only the first, so
   those models could not be found, added, or assigned — with no symptom a
   user could diagnose, because the model simply was not there. `listModels`
   now reads both and merges by id, the plain catalogue winning on conflict. A
   failure on the second read degrades to fewer models rather than to no
   catalogue. The live catalogue went from 431 entries to 472.

   The claim in this milestone's original entry that Seedream was among the
   models the integration reached was **wrong**: it was taken from
   OpenRouter's documentation example rather than from the catalogue, and the
   catalogue did not contain it.

2. **An image model could be classified FREE, defeating the spend gate.**
   `classifyModel` read `prompt` and `completion` prices only. OpenRouter
   lists Seedream 4.5 at **prompt 0, completion 0, image output $9.58/M
   tokens** — so a model that charges for every image it draws classified as
   free, which would have let it run in Test mode and skip the cost
   confirmation entirely. This is precisely the failure the "unknown is not
   free" rule exists to prevent, arriving through a price nobody had thought
   to read.

   Fixed at the root rather than at the call site: `image_output_price` is now
   stored on `ai_provider_models`, carried through the router and the role
   registry, and read by `classifyModel` — where any non-zero extra charge
   makes a model paid, exactly as a per-request charge already did. The
   featured-image path additionally treats a NULL image price as **unknown**
   rather than free, because a model registered before this column existed has
   no image price on record and unknown is gated.

   The catalogue card now shows an **Image output** row when there is one.
   Without it a card read "Paid · Input Free · Output Free", which looks like
   a bug rather than a model whose only price is per image.

3. **The new capability was not offered where models are added.** The server
   published `image_generation` on `/ai-providers/meta`, and the provider
   detail screen read it — but Model Discovery derived its checkbox list from
   `PURPOSE_LABELS`, a client-side fallback map, so the capability was
   assignable everywhere except the one screen where a model is added from the
   catalogue. Discovery now reads the server list, with the map as fallback
   wording only, which is what the map's own comment always claimed.

**Tests**: 4 new (387 total). The caching test in `models.test.ts` now derives
the cost of a refresh instead of hardcoding one request, since a refresh is
legitimately two reads.

### Known limitations at completion

1. **Unverified against a live image model.** The request and response shapes
   come from OpenRouter's current documentation and its live model catalogue;
   the first real generation is what proves them.
2. **Featured images only.** Inline and section images are not generated.
3. **No image editing.** Cynth cannot crop, recolour or ask for a variation of
   a candidate it produced — the only revision is generating a new batch.
4. **Alt text is not generated.** The chosen asset gets a title and a credit;
   accessibility text is still the editor's to write.
5. **Pending candidates are swept on the next generation or on selection**, not
   on a schedule. An article whose candidates are never chosen and never
   regenerated keeps them on disk until it is deleted.

---

## Milestone 26 — Short-Form By Default (Complete, 2026-09-05)

Requested as: articles should not exceed 1,500 words, and should not fall
below the length at which a blog post stops being substantive.

### A band, not a floor

Every template previously stated a MINIMUM and nothing else, which gave the
writer exactly one direction to push in. `ContentSchema` now carries
`maxWords` as well, and the writer, the reviewer and validation are all given
the same band from one function.

That last part is the point of `articleLength.service.ts`. A writer told 1,500
and a validator checking 2,000 produces an article that is wrong by one of the
two rules whatever it does; the reviewer needed it too, because it had been
asking for depth in articles already at their ceiling and the one permitted
revision was being spent making them longer.

### Version 2 of all eight templates

Templates are versioned and never overwritten, so this is a new version rather
than an edit. v1 remains in the registry with the lengths it was published
with, and an article that recorded v1 — such as the WordPress-pushed article 3
— still resolves to the schema it was actually written to.

| Template | v1 minimum | v2 band |
|---|---|---|
| How-To | 1200 | 800-1400 |
| Ultimate Guide | 2000 | 900-1500 |
| Comparison | 1500 | 850-1400 |
| Product Review | 1400 | 800-1300 |
| Buying Guide | 1800 | 900-1500 |
| Evidence-Based Analysis | 1600 | 850-1400 |
| Listicle | 1400 | 800-1300 |
| Trend Analysis | 1300 | 700-1200 |

Per-section minimums were scaled down with the whole, and a test asserts that
a template's required sections cannot sum past its own ceiling — a template
that asks for more words than it allows fails every article written to it,
twice.

### The floor is not a standard, and does not pretend to be

There is no official minimum length for a blog post. The floors sit at
700-900 words because below roughly that an article cannot cover a subject and
satisfy a template's sections at the same time. `FLOOR_MAX_WORDS` (400) exists
only to stop a setting that would fail every article.

### One ceiling, changeable without a deploy

The publication-wide maximum is a setting (`article.maxWords`, default 1,500)
rather than a constant, editable at **Settings -> Editorial**. The effective
ceiling for any article is the LOWER of that and the template's own: a
template may be shorter than the house maximum, never longer. So lowering the
setting shortens everything, and raising it above 1,500 changes nothing on its
own.

Where the setting binds rather than the template, the validation finding says
so, because "this is too long" is not actionable without knowing which rule
made it too long.

### Reported, never truncated

An over-length article produces a warning naming the count and the ceiling.
Nothing is cut. Truncating an argument to meet a number is worse than a long
article, and what to remove is an editorial decision.

### Supporting changes

- **No schema change.** `maxWords` lives inside the existing
  `content_schema` JSON. A v1 row has no `maxWords`, which reads as "no
  ceiling of its own" — the house limit then applies alone rather than
  leaving the article unbounded.
- **API**: `GET`/`PUT /api/generation/article-length`.
- **Tests**: 11 new (398 total), including one asserting that the writer's
  prompt actually contains the band rather than trusting that it does.

### Fixed

- **A blank setting capped every article at 400 words.** `getHouseMaxWords`
  treated only `null` as unset, and `Number('')` is 0, which clamped to the
  floor. Blank now reads as unset.

### Known limitations at completion

1. **The ceiling is publication-wide, not per-article.** A piece that
   genuinely warrants 2,500 words needs the setting changed and changed back.
2. **Nothing enforces the ceiling during generation.** It is an instruction to
   the model and a check afterwards; a model that ignores it produces a
   warning, not a shorter article.
3. **Existing drafts are unaffected.** They were written to v1 and keep it.

---

## Milestone 27 — The Products Checkpoint (Complete, 2026-09-05)

Requested as: add products on the Product page, then have Cynth offer the ones
in the article's thematic area once the title is settled, with a way to add one
if the area has none.

### The gap this closes

Everything needed to place a product well already existed — the writer is told
what each product is FOR and that omission is a correct outcome, section
schemas say which sections may carry one, and the Milestone 18 review grades
each placement afterwards. What did not exist was any way to attach a product
to an article the pipeline was writing. The products panel lived only in the
manual New Article wizard, so a pipeline article reached the writer with
nothing attached.

### A fourth checkpoint, after the article type

Topic -> Title and keywords -> **Article type** -> **Products** -> write ->
Review.

It sits after the type is settled rather than immediately after the title,
because whether products belong at all is a different question for a buying
guide than for a trend analysis. The panel states the template's real
`placementSlots` — four for a buying guide, zero for a trend analysis — read
from the template rather than from a number written into the UI.

It is the only checkpoint whose options are not a stage's output. They are the
product registry as it stands, rebuilt on every read, so a product added in
another tab appears without restarting anything.

### The thematic area does the filtering

Products filed under the article's area are listed first, exactly as the media
library narrows images. Everything else — filed elsewhere or unfiled — is in a
second collapsed list, because a misfiled product must stay reachable rather
than becoming invisible.

**Add a product** opens the product form in a new tab. The run is persisted, so
navigating away would not lose it, but sending someone away mid-decision to
fill in a form and find their way back is worse than two tabs. **Refresh the
list** re-reads the checkpoint.

### Readiness, stated before the choice

Each product is marked `ready` or `thin`:

- **ready** — it has "what it is for" or "the problem it solves".
- **thin** — it has only a description, or nothing at all, with a note saying
  which.

This is the field that matters. A product Cynth knows nothing about can only be
placed decoratively, and the editor should learn that while choosing rather
than in the finished draft. The writer is told the same thing: a product with
nothing recorded now arrives with an explicit instruction to place it only if
the article makes its purpose obvious, and otherwise to leave it out.

### The fields the writer reads are now fillable by hand

This was the real blocker, and it was not visible from the product page.
`useCase`, `problemSolved`, `bestFor` and `keyFeatures` were writable only by
product research — which needs a retrievable URL, and for Amazon needs the
Creators API that account eligibility still blocks. **A product added by hand
therefore reached the writer as a name and a brand**, which is enough to
mention it and not enough to place it.

They are now on the product form, under their own heading that says what they
are for. Research still fills them when it runs; whichever wrote them, the
writer reads the same fields. On an edit, an absent field leaves what research
wrote alone while an empty string is a deliberate clear.

The writer's product block was also widened to pass the description, the "best
for" and the editorial fit, so nothing an editor fills in is wasted.

### An exact decision, not an additive one

Applying the decision attaches what was chosen and detaches what was not: an
editor who removes a product expects it gone, not merely unticked. Only the
LINK is touched — the product, its research and its images are shared records
and survive being detached. Choosing none is a real answer and a common one,
recorded as a decision rather than refused.

### Verified live

Driven end to end on the real database against free models: the checkpoint
reported 4 placement slots and no products in Productive Workspace Setups; a
product created through the API with the new fields appeared immediately as
`ready` with its use case; the affiliate link came back byte-identical. The
test product was then deleted.

### Supporting changes

- **No schema change.** The columns existed; only research could write them.
- **Tests**: 6 new (404 total), including one asserting the chosen product
  reaches the writer's prompt with its use case and the "options, not
  requirements" framing intact.
- The guided-walk tests now take their answers from one helper, so a future
  checkpoint is added in one place rather than in every test that walks past
  it.

### Fixed

- **The area's name was derived from a product that matched it**, so an area
  with no products yet reported no area at all — which the panel rendered as
  "this article has no thematic area", the one thing it was not. It now reads
  the name from the thematic area itself, and the panel distinguishes "no area"
  from "no products in this area".

### Known limitations at completion

1. **No product can be created from inside the checkpoint.** The button opens
   the existing form in a new tab; there is no inline create.
2. **The suggestion of two or three is guidance, not a limit.** Choosing more
   than the template has slots for warns and proceeds, consistent with the
   Milestone 18 rule that there is no hard maximum.
3. **Placement is still the writer's decision.** The checkpoint decides what is
   AVAILABLE; where a product lands, or whether it appears at all, is the
   writer's, and the placement review grades it afterwards.

---

## Milestone 28 — Product Opportunities (Complete, 2026-09-05)

Requested as: the reverse of the existing product workflow — let the models
read the article skeleton and propose the KINDS of product that would suit it,
so the editor knows what to go searching for.

This is the half of the §18 spec that needs no Amazon API. `amazon_matching`
remains unimplemented because it needs `searchItems`; the opportunity half
needs only the article.

### Both directions now exist

**Product-first** (Milestones 17, 18, 27): the editor has products; Cynth works
out where they belong.

**Article-first** (this milestone): Cynth has an article; it works out what
kinds of product the reader would want.

### Categories, never products

The single rule that makes this safe. It proposes "clumping cat litter", not
"Dr Elsey's Ultra Unscented".

A model asked for specific products invents plausible ones — wrong model
numbers, discontinued lines, prices that were never real — and that is exactly
the failure Milestone 19 exists to prevent. A CATEGORY cannot be hallucinated
in the same way: it is a description of a need, and the editor supplies the
real product. The prompt forbids brands, model numbers, prices and
availability, and a test asserts those instructions are present.

### What a suggestion carries

Each one names the category, why a reader of THIS article would want it, which
section of the article's own template it would serve, two to four search terms
to paste into a retailer, and a priority. The search terms are click-to-copy,
because the point of the feature is the next thing the editor does with it.

A section key the template does not have is recorded as **null** rather than
coerced to the nearest one — the suggestion is still a useful shopping idea,
but it must not claim a place it does not have. A suggestion with no category
at all is dropped as unusable.

**An empty list is an explicit, valid answer.** Plenty of articles should carry
no products, and a model that always finds four is not answering the question.

### It never reaches the writer

The suggestions are a brief for the EDITOR. They are deliberately absent from
the writer's prompt, which is only ever told about products that actually exist
in Cynth — a category in the writer's prompt is an invitation to describe a
product nobody owns. A test asserts a suggested category the editor did not buy
does not appear in the writer's prompt.

### Asked only when someone will read it

The stage runs when the run is GUIDED and the article's template has somewhere
to put a product. An automatic run has nobody shopping, so paying a model for a
list nobody sees is spend with no purpose; a trend analysis has no product
slots, so the question does not arise. Both cases skip the stage, and the
progress list shows it as `skipped` rather than `pending` — a progress list
showing work that is not coming is a list that lies about what is left.

### Model routing

Shares the `keyword_research` role rather than adding a seventh. It is the same
shape of task that role already does — one narrow structured question asked of
a stronger model's output — and adding a role would make every existing
installation report itself unconfigured until the new role was assigned, which
is a poor trade for a naming distinction. `title_selection` already shares a
stage on the same reasoning.

### Verified live

Run on the real database against the free development model, on the standing
desk mats article. It returned four categories, each mapped to a real section
key of the buying-guide template, with search terms:

- *Standing desk mats for plantar fasciitis* -> `recommended_products`
- *Standing desk mats for knee osteoarthritis* -> `best_for_users`
- *Barefoot-friendly standing desk mats* -> `comparison`
- *Standing desk mats for high arches* -> `recommended_products`

No brand or model was named in any of them.

### Supporting changes

- **No schema change.** The output is a stage run like any other.
- New pipeline stage `product_opportunity` and state `IDENTIFYING_PRODUCTS`;
  the existing `PRODUCTS_READY` is its completion state.
- **Tests**: 4 new (408 total), covering the shape, the skip, the prompt's
  rules, and the boundary that keeps categories out of the writer.

### Known limitations at completion

1. **Suggestions are not saved to a shopping list.** They live on the pipeline
   run. Starting a new version asks again rather than carrying them forward.
2. **Nothing searches for the products.** The editor takes the terms to a
   retailer themselves — `amazon_matching` still needs `searchItems`, which
   Milestone 19 did not implement and account eligibility still blocks.
3. **No link from a suggestion to the product form.** Adding a product is a
   separate click, and the category is not pre-filled into it.
4. **It runs once per version.** There is no "suggest again" for this stage, as
   there is for topic and keywords.

---

## Milestone 29 — The Cost Confirmation, Fixed (Complete, 2026-09-05)

Reported as: "I get 'This is a paid model. Confirm the estimated cost to
continue.' but I don't know where to confirm."

Reproduced immediately in Production mode. Three separate defects, and the
second was the serious one.

### 1. The question could not be answered

The pipeline screen asked for confirmation through `window.confirm`. That was
wrong twice over:

- **It never showed the estimate.** The dialog said "confirm the estimated
  cost" and then did not state a cost. There was nothing to confirm.
- **A browser can suppress it.** After a few dialogs Chrome offers "prevent
  this page from creating additional dialogs", and from then on the confirm
  returns false silently — leaving exactly the reported symptom: the message
  on screen, and nowhere to click.

Replaced with an in-page panel that names the stage, the model, and the
figure:

> **This will cost money** · Waiting for you
> Topic Research runs on **anthropic/claude-opus-5**.
> Estimated cost for this stage: **$0.1079**

The estimate is real. `stageRunner` already computed it in the spend gate and
threw it away; `GenerationError` now carries a `SpendRefusalDetail` through the
route to the browser.

It also states, plainly, that one click authorises more than one charge:
confirming runs the paid stages until the run next stops to ask something.
Each stage's actual cost still appears in Progress as it completes.

### 2. Saying no ENDED the run

The serious one. A refused cost confirmation was handled as a failed stage, so
the pipeline moved to `FAILED` — a terminal state. Answering "not now" to a
question therefore killed the run, and the only way forward was a new version
that pays for everything again.

Four dead runs were found in the live database from the user's own attempts,
all `FAILED`, none having spent anything.

`isSpendRefusal()` now distinguishes the two cases, and it is a real
distinction rather than a cosmetic one:

- A stage that FAILED is a broken run. Something was attempted and went wrong.
- A stage that was never allowed to spend **has not run at all**. Nothing was
  called, nothing was charged, and the pipeline is exactly where it was.

Every stage service checks it before its `setState(FAILED)` — including the
revision stage, which was ending runs at `NEEDS_EDITORIAL_ATTENTION` for the
same reason.

### 3. It reported work that was not happening

Each stage sets its running state before calling the runner, so a refused gate
left the pipeline reading `RESEARCHING` while it sat waiting for an answer.
The state before the stage started is now captured and restored on a refusal,
so the run reads as what it is.

This is the same rule applied elsewhere in the pipeline: a progress display
that shows work which is not coming is a display that lies about what is left.

### Recovering the dead runs

The Milestone 24 retry path revives them. **Try the failed stage again**
reopens a `FAILED` run in place, and the cost panel now appears properly. They
can equally be deleted from Drafts — nothing was spent on any of them.

### Supporting changes

- **No schema change.**
- `GenerationError` gained an optional `spend` detail; the pipeline routes pass
  it through. It carries a stage, a label, a model name, a cost class and a
  figure — never a credential.
- **Tests**: 2 new (410 total). One asserts that declining leaves the run
  alive AND back at the state it started from; the other that the refusal
  carries a real number rather than a promise of one.

### Known limitations at completion

1. **The estimate is for the blocked stage only**, not the whole run. Stages
   use different models and different prompt lengths, so a whole-run total
   before anything has been researched would be a guess. The panel says which
   figure it is showing.
2. **Confirmation is per advance, not per stage.** One click covers the paid
   stages until the run next stops. This is stated on the panel rather than
   discovered.
3. **The manual New Article wizard is unchanged.** It already had a proper
   preflight with a cost checkbox; this milestone brings the pipeline screen up
   to it.

---

## Milestone 30 — Cost Tuning (Complete, 2026-09-05)

Not a feature. A deliberate reduction in what an article costs, after the
first Production run showed the real figures.

### The shortlist halved

`TOPIC_CANDIDATES` dropped from 4 to 2.

Topic research is the second most expensive stage, it runs on the premium
model, and its cost is almost entirely output tokens — so the number of topics
it researches IS the cost of that stage. Four researched topics is a nicer
choice; two is a genuine one, and the editor picks at a checkpoint either way.

The number is now one exported constant driving the prompt AND the assumed
output budget together (`TOPIC_CANDIDATES * TOKENS_PER_TOPIC + overhead`), so
the figure the spend gate shows cannot drift away from what the prompt asks
for. That drift is what made the estimate confusing in the first place.

Topic research: **$0.1088 -> $0.0588**.

### Roles settled

| Role | Model | Price per M |
|---|---|---|
| Topic Research | anthropic/claude-opus-5 | $5.00 / $25.00 |
| Keyword & Title | qwen/qwen3.7-flash | $0.03 / $0.13 |
| Title Selection | nvidia/nemotron-3-super-120b-a12b:free | free |
| Article Writer | anthropic/claude-opus-5 | $5.00 / $25.00 |
| Article Reviewer | openai/gpt-5.6-sol-pro | $2.00 / $10.00 |
| Article Revision | openai/gpt-5.6-sol-pro | $2.00 / $10.00 |

**`title_selection` is assigned but inert.** No stage uses that role: the
keyword stage returns the keyword plan and the title candidates in one call,
which is cheaper and less error-prone than two round trips over the same
inputs. The assignment is parked there for if that stage is ever split.

`nemotron-3-ultra` was deliberately NOT chosen. It returned empty responses
three times consecutively on the keyword prompt during live Development
testing — it is the model behind the failures seen there.

### What an article now costs

| Stage | Estimate |
|---|---|
| Topic Research (2 topics) | $0.0588 |
| Keyword & Title | $0.0002 |
| Article Type | $0.0001 |
| Product Opportunities | $0.0001 |
| Article Generation | $0.1113 |
| Review | $0.0260 |
| **Total** | **$0.1964** |
| With the one revision | $0.2424 |

Down from $0.2464 ($0.2924 with revision). Two stages remain 87% of the cost,
both on Opus 5, both deliberately.

These are ESTIMATES, and they assume each model writes its full output budget.
The one real measured generation on record — article 3, Sonnet 4.6, 363 in /
2,435 out — cost **$0.0376**, well under its estimate. Actuals are normally
lower.

### Known limitations at completion

1. **`TOPIC_CANDIDATES` is a constant, not a setting.** Changing it is a code
   change and a redeploy, unlike the article word limit.
2. **No cost preview before starting.** The spend gate shows the blocked
   stage's estimate; there is no screen that says what a whole run will cost
   under the current role assignments before you begin.

---

## Milestone 31 — Picking a Run Back Up (Complete, 2026-09-08)

Reported as: "if one model fails and I try again and it still fails, then I go
change the model in Settings > Model role, I can't continue where I left off. I
can see the draft but I can't edit it, that draft is useless despite the fact
that it has already created a title."

### What was actually wrong

Nothing in the engine. Everything needed to continue a run already worked:

- **Roles resolve at stage execution time**, so a model changed in Settings
  applies from the next stage onward. Swapping a broken model mid-run was
  always supported.
- **Completed stages are idempotent**, so continuing never pays twice.
- **`resumeAfterFailure()` (Milestone 24)** reopens a FAILED run in place.
- **`/generate/:pipelineId` hydrates from the server**, and had done since
  guided mode was built — the options come back with the run because they were
  never held in the browser.

The defect was that **nothing ever linked to that URL**. The only navigation to
it was the redirect that fired immediately after starting a run. Leave the page
— which is exactly what "go and change the model in Settings" means — and the
run became unreachable. Every door led somewhere else:

- **Drafts** listed the *article*, not the run, and linked to `/articles/:id`,
  a read-only viewer with nothing in it.
- The article row is genuinely empty at that point: title, topic and body are
  written when the writer stage runs, which had not happened. So the row read
  **"Untitled draft · Not generated yet"** — true, and completely misleading.
- **Generate Article** offered only the Start form, which begins a *new* run.

So a live run holding paid research presented itself as a dead draft, and the
only apparent way forward was to start again and pay for the same research a
second time. That is the report, exactly.

### Found in the live database

Pipeline 16 (article 24), the user's own run:

| | |
|---|---|
| Topic research | succeeded on `anthropic/claude-opus-5` |
| Keyword research, attempt 1 | primary `qwen3.7-flash` rate-limited; fallback `minimax-m3:free` returned `model_not_found` |
| Keyword research, attempt 2 | **succeeded** on `qwen3.7-flash` after the model was changed |
| State | `SEO_COMPLETE`, checkpoint `keywords_title` **open**, six title candidates stored |
| Already spent | **$0.1257** |

The retry had worked. The run was alive, correct, and waiting at a question
with its options ready — and there was no way to reach it.

### The fix — give every unfinished run a door

**`isResumable(state)`**, in the constants beside `isTerminal`, and
deliberately not its inverse. The two are different questions:

- *Terminal* asks whether anything continues on its own.
- *Resumable* asks whether a person can still act on it.

`FAILED` is both — no stage runs by itself, but it is precisely the state a
person fixes and resumes. `READY` has finished. `NEEDS_EDITORIAL_ATTENTION` is
waiting on a human editor rather than on a stage, so resuming moves it nowhere.

**`GET /pipeline/resumable`** returns those runs, described well enough to
decide whether to pick one up: theme, mode, what it is waiting on, what
continuing would run next, whether it stopped, and **what has already been paid
for it** — which is the entire argument for continuing rather than restarting.
Only the current version of each article is considered; a superseded version is
history, not an invitation.

The identity — topic and title — is read from **the run's own stage output**,
not from the article row. Not a shortcut: the article row has neither yet, and
that is why the draft looked empty. A run that has researched a topic and
chosen a title knows perfectly well what it is about.

**Two doors, at both places someone actually looks:**

1. **Generate Article** lists unfinished runs *above* the Start form, so the
   cheaper option is seen before the one that would replace it.
2. **Drafts** shows the run's real title, what it is waiting on, what has been
   spent, and a **Continue** button that goes to the run rather than to the
   empty article. Finished articles are untouched — they still read "Open" and
   open the article.

### What this deliberately does NOT do

**There is still no article editor.** "I can't edit it" has two readings, and
only one of them was a bug:

- *Continue the unfinished run* — fixed here.
- *Edit the prose of a finished draft* — Cynth has never had this. Every draft
  in `NEEDS_EDITORIAL_ATTENTION` still needs an editor Cynth does not provide.

Conflating the two would have shipped a text editor nobody asked for while
leaving the actual complaint — a live run with paid work in it, unreachable —
in place. They are separate pieces of work.

### Supporting changes

- **No schema change.** Every field was already persisted; nothing new is
  written. This milestone only reads.
- The Drafts list takes run hints as a plain local shape, so the articles
  feature does not gain a dependency on the pipeline feature.
- A failure to load the runs degrades the Drafts list to what it was before
  rather than breaking it, so the error is not surfaced.

### Tests

3 new (**414 total**, all passing):

1. A part-way run is listed with what it is waiting on — and asserts the
   article row still has no topic, which is the reason the list exists.
2. `READY` and `NEEDS_EDITORIAL_ATTENTION` are not offered; `FAILED` is, marked
   as stopped and naming what continuing would try.
3. **The reported case end to end**: a stage fails, the model is changed in
   Settings, the run resumes — and the topic research row is asserted to be
   *the same row*, proving the paid work is kept rather than repeated.

### Known limitations at completion

1. **No article editor**, as above.
2. **The run list is not paginated.** It shows every unfinished run. With ten
   on screen this is a feature — the abandoned ones are visible and can be
   deleted. With a hundred it would need trimming.
3. **A run's identity is only as good as its last stage.** A run that failed at
   topic research has no topic, so it reads "Untitled run in <area>". There is
   nothing better to show; nothing has been decided yet.

---

## Milestone 32 — The Voice, and the Idea (Complete, 2026-09-08)

Two reports, one of them serious:

1. "The skills file, author philosophy file etc weren't used when creating the
   articles. The article read like any regular AI generated article."
2. "I should be able to tell CYNTH an idea for an article I want it to write
   about... it should take that topic idea and build an entire article on it."

### 1. The writer was told to obey a filename

The pipeline's writer prompt contained this:

> The author's full voice documents (Author Persona: Smart Pet Care, Shared
> Editorial Philosophy — EveryFiveDays) govern tone, structure and vocabulary.
> **Follow them exactly.**

It named the documents. It did not include them. The model was instructed to
follow, exactly, two documents it had never been shown.

What the writer actually received about voice:

| | |
|---|---|
| Author name | "Mara Kessler" |
| Persona summary | `expertise` + `perspective`, capped at 500 chars — **and NULL for every author in the database**, so empty |
| Voice documents | **their filenames** |

Meanwhile `briefStages.service.ts` was calling `listActiveSkillsForAuthor()`,
which returns each document **with its body**, and then doing:

```ts
skillNames: [...skills, ...shared].map((skill) => skill.name),
```

Roughly 7,900 characters of deliberately written voice guidance — 5,558 for the
Smart Pet Care persona, 2,355 for the shared editorial philosophy — were loaded
from the database and discarded, every single run.

The articles read generic because nothing in the prompt made them anything
else. This was not a tuning problem or a model problem.

**The manual New Article path was never affected.** `promptBuilder.service.ts`
has always emitted `--- <name> ---\n<body>` for each document (Milestone 16).
Only the pipeline — the path actually in use — dropped them.

#### The fix

`buildVoiceBlock()` emits the documents verbatim, in a `=== VOICE DOCUMENTS ===`
section, with the rule that where they conflict with any summary in the prompt,
**the documents win**. Nothing parses, trims or summarises a voice document:
the editor wrote it to be followed, not interpreted.

It is given to three stages, for three different reasons:

- **The writer**, so the article has a voice to be written in.
- **The reviewer**, which has always listed "author voice" among the things it
  assesses — and was judging it against a name. That is not an assessment.
- **The reviser**, which is the one stage allowed to rewrite prose. Without the
  voice it corrects sentences into its own default register and quietly undoes
  the writer, sentence by sentence.

`buildGenerationContext` was already being called in the writer and reviewer
stages. The documents were in hand both times.

**Cost**: roughly 1,900 extra input tokens per stage. On the current roles that
is about **+$0.028 per article**, and it is the difference between a house
voice and a generic one.

### 2. An idea was always a suggestion

`seedTopic` existed and reached the researcher, but only ever as a *direction*:

> The editor has proposed this direction: "X". Propose 2 distinct topics within
> it, each a genuinely different article rather than the same one reworded.

So "write about the healthiest snacks for cats recovering from a health
problem" produced a shortlist of other articles near that idea, and the article
the editor actually asked for was one option among them — or absent.

#### The fix — `topic_mode`

A new column on `article_pipelines`, `'explore' | 'exact'`, defaulting to
`explore` (exactly how every existing run already behaved).

**`exact` is a different job, not a stricter version of the same one.**
Exploring asks *what should we write here?*; exact asks *this is what we are
writing — is it any good, and what is the strongest way to do it?* The prompt
says so directly: research this subject, return exactly one topic, do not
propose alternatives, do not broaden it, do not narrow it to one sub-part.

Two things are deliberately preserved:

- **Honest research.** "Being told to write something is not a reason to
  pretend it is a good idea." A weak subject is still reported as weak in the
  research summary and the content gap.
- **The angle is still the model's job.** It may sharpen the wording and must
  choose the strongest angle — the article simply has to remain recognisably
  the one that was asked for.

The mode is stored on the run, not passed per call, so a run resumed days later
is still faithful to the subject the editor decided on.

The UI asks the question only once there is an idea to be faithful to, and
**defaults to exact**: someone who has typed out an idea has already decided
what they want written. `exact` with a blank idea is forced back to `explore`,
because there is nothing to be faithful to and a stored intent that contradicts
its own prompt is worse than no intent.

**Cost**: an exact run researches one topic instead of two, so the output
budget and the gate figure scale down with it.

### Supporting changes

- **Schema**: one column, `article_pipelines.topic_mode`, added through the
  existing `addMissingColumns` path. Existing rows default to `explore`.
- `startNewVersion` carries the topic mode forward: an editor who supplied a
  decided subject has not changed their mind by asking for another attempt.

### Tests

6 new (**429 total**, all passing):

- The persona body and the shared philosophy reach the writer — asserted on the
  document text, not on a section heading. A companion assertion fails if the
  prompt ever goes back to naming documents it has not supplied.
- The reviewer and the reviser get the same documents.
- Deactivating a document removes it, and the section is omitted rather than
  left empty.
- An exact idea reaches the researcher verbatim, with the alternatives
  instruction absent — and the honesty instruction present.
- Exploring is untouched.
- `exact` with a blank idea is not honoured.

### Known limitations at completion

1. **No article editor still.** Unchanged from Milestone 31.
2. **The persona summary fields remain empty.** `authors.expertise` and
   `authors.perspective` are NULL for every author. This no longer matters much
   — the documents carry the voice — but the summary line is dead weight until
   those fields are filled.
3. **Product images are still not seen by the writer.** They reach the rendered
   card at CMS push, and nothing else. See the open question in the CHANGELOG.

---

## Milestone 33 — The Card You Can See (Complete, 2026-09-08)

Reported as: "CYNTH asks for all these product images but doesn't use them in
writing the articles."

### The images were used. In one place, at the last possible moment.

`renderProductCard` has always rendered the image, preferring the editor's
uploaded primary over the retailer's CDN URL. All 8 products carry images, 16
files, every one with a primary.

But the card is assembled at **CMS push time**. Cynth's own article view
rendered the body as a single text node, so `[[product:14]]` appeared as
literal text and the uploaded image appeared **nowhere in the application**.
The first place an editor could see how a card looked was the published post —
the last place you want to find out.

That is why the images looked unused. They were not; they were invisible.

### What was NOT changed, deliberately

The writer still never writes an image, a price or a URL. It writes a marker,
and the card is built from stored records. That rule is what keeps the
affiliate URL exactly as the editor supplied it: **a link the model never sees
is a link it cannot alter.** Rendering a preview does not weaken it — the
preview reads the same fields the published card reads, and writes nothing.

`productCard.ts` remains the single thing that generates what WordPress
receives. `ArticleContent.tsx` is a preview and says so.

### The fix

- **`GET /articles/:id/products`** returns the article's products resolved
  exactly as the CMS card resolves them, image precedence included.
- **`ArticleContent.tsx`** splits the body on marker lines and renders each as
  the card it becomes: image, title, brand, what it is for, up to four
  features, and the affiliate link with the same `rel="sponsored nofollow
  noopener"` the published card carries.
- A product with **no affiliate link** renders with a stated warning rather
  than a silently linkless card. Article 24 has one, and it is now visible
  before publishing rather than after.
- A marker whose product is no longer attached renders as an explicit orphan
  notice. `stripInvalidMarkers` should prevent this; if it ever appears,
  showing it is the point, because the published article will be missing that
  card too.

### The bug this uncovered: the Quality Gate blocked its own product cards

Found while verifying the preview against article 24, which reported:

> The article has no unfilled placeholders — **BLOCKING**
> 4 distinct placeholder(s) are still unfilled, for example [[product:14],
> [[product:15]...

`PLACEHOLDER_PATTERN` is `/\[[^\]\n]{2,80}\](?!\()/g`. Given `[[product:14]]`
it matched the inner `[product:14]`, which is not followed by `(`, and reported
it as unfilled.

So an article was blocked from publishing **for placing the products it was
asked to place** — and the more products it placed, the worse it scored. A
product marker is the opposite of an unfilled placeholder: it is a finished
instruction the renderer acts on.

Markers are now removed before the scan rather than added as an exception to
the pattern, so the pattern stays readable and this stays one decision in one
place. A real placeholder sitting beside a card is still caught — there is a
test for exactly that, because a fix that blinded the check would be worse than
the bug.

Article 24 re-evaluated from **failed** to **passed** on this check.

### Verified live, on the real article

Four cards render for article 24, all four images decode at full resolution
(1500x1487, 1295x1449, 1092x1427, 1500x1225), and the three affiliate links are
byte-identical to the stored `amzn.to` strings. No raw marker text remains
anywhere on the page.

### Tests

3 new (**432 total**):

1. The preview payload carries the image and the **verbatim** affiliate link —
   asserted against the stored product row, so any future normalisation of that
   URL fails the build.
2. A placed product card is not an unfilled placeholder.
3. A real placeholder beside a product card is still caught, and the card is
   not named alongside it.

### Known limitations at completion

1. **The preview is not the published markup.** It reads the same fields but
   renders Cynth's own styling; the site's stylesheet owns the real card.
2. **The writer still does not see the image.** It writes from the recorded
   text fields. Sending the image itself to a vision model is a separate
   change, with its own cost, and was explicitly deferred.
3. **The body is still displayed as preformatted text** between cards. Markdown
   is not rendered; only markers changed.

---

## Milestone 34 — AI Search Readiness (Complete, 2026-09-08)

A new SEO dimension, `ai_search`, covering whether an answer engine can lift an
answer out of an article and attribute it. Ported selectively from the
Agentic-SEO skill after a gap analysis, not adopted wholesale.

### Why a dimension rather than more readability checks

It rewards something classic SEO does not: **a passage that survives being
extracted from its own page.** An article can score well on structure,
readability and on-page and still be unquotable, because every section depends
on the one above it. That is a distinct failure mode and it needed its own
weight.

### The weights were rebalanced, not diluted

The dimension weights sum to 100, so adding one means taking the weight from
somewhere. `ai_search` is funded at **6** by the four dimensions whose concerns
it partly overlaps:

| Dimension | Before | After |
|---|---|---|
| Topical coverage | 15 | 13 |
| On-page SEO | 15 | 13 |
| Structure | 12 | 11 |
| Readability | 10 | 9 |
| **AI search readiness** | — | **6** |

Everything else is unchanged, and a test asserts the total is still 100 — a
guard rather than a formality, because adding a dimension without funding it
silently rescales every previously recorded score.

### The deterministic half (four checks)

All four are `recommendation` severity. This is a judgement about reach, not
about correctness, and it must never block a push.

1. **`passage_too_thin_to_quote`** — a section under 60 words cannot answer
   anything on its own.
2. **`passage_answer_buried`** — a section over 350 words is read as one block,
   so a specific answer cannot be lifted cleanly.
3. **`passage_opens_with_preamble`** — the section opens by announcing what it
   will cover ("In this article we will look at..."). An answer engine reads
   roughly the first 60 words and moves on; an opening that describes itself
   has spent that space saying nothing.
4. **`passage_opens_dependently`** — the section opens with a bare
   demonstrative or pronoun. "This means you should..." is fine on the page and
   useless off it: quoted alone, the reference has nothing to point at.
5. **`no_definition_statement`** — the article never states plainly what its
   own target query IS. Answer engines lift "X is ..." constructions almost
   verbatim, and an article on a subject that never defines it has nothing to
   offer for the most basic question asked about it.

Two deliberate narrowings, both tested:

- **The demonstrative rule requires a bare one.** "This stiffness is what
  transfers load" carries its own subject; "This is why" does not. Flagging
  both would make the check noise.
- **The H1 and the lead-in are skipped.** They are the title and the
  introduction, judged as such elsewhere. Without this the article's own title
  is reported as "too short to answer anything" — true, and useless.

The citable band (134-167 words) is documented in the constants and used in the
*advice*, never as a threshold to fail against. Like the SERP limits, it is a
guide to obvious over- and under-shooting, not a target to write toward.

### The semantic half (the AI pass)

Two categories were added to the reviewer's schema, `citability` and
`experience_signals`, with rules that split the work from the deterministic
checks rather than duplicating it:

- **citability** — could a passage be quoted BY ITSELF and still answer the
  question it appears to answer? Length and openings are explicitly excluded,
  because code already checks those.
- **experience_signals** — does this read as written by someone who has
  actually used, tested or handled the subject? First-hand observation,
  specific conditions and numbers, named trade-offs, attributed claims.

With one prohibition that matters more than the rest:

> Do NOT reward citing sources for their own sake, and do NOT ask for
> credentials the author does not have. An honest "we have not tested this" is
> a trust signal; an invented one is the opposite. Never recommend claiming
> experience the article does not evidence.

E-E-A-T advice that pushes an author toward asserting expertise they lack is
worse than no advice. The rule is stated in the prompt rather than hoped for.

### Verified live

Article 24 scored **88** on `ai_search` (weight 6, contribution 5.28) with two
genuine findings: the empty FAQ heading, and a section opening with an upward
reference. The dimension renders in the article view.

### Tests

7 new (**439 total**):

The well-formed case (no findings), each of the four checks firing, the
narrow demonstrative rule NOT firing, and the weights guard.

**One test failure worth recording**: registering these tests first made an
unrelated internal-links test fail. They create several articles about the same
subject, and internal-link candidates are ranked across every article in the
database, so the new articles crowded out the intended target. The block is now
registered last, with a comment saying why — the ordering is load-bearing.

### Assessed and NOT ported

`fetch_page.py` and `parse_html.py` were reviewed against the future crawling
feature rather than this milestone. See the note below.

### Known limitations at completion

1. **Nothing here measures actual AI visibility.** It measures whether the
   article is *shaped* to be cited. Whether it is cited is not observable from
   inside Cynth.
2. **The passage checks use the document model's word counts**, which include
   the heading line. Immaterial at these thresholds, but the numbers in a
   finding are two or three words higher than the prose alone.
3. **`experience_signals` only runs in the AI pass**, so a deterministic-only
   analysis scores `ai_search` on citability alone.

---

## Note — the crawling feature (assessed 2026-09-08, NOT built)

Planned direction: give Cynth a URL, have it crawl the site and pull keywords,
titles and SEO information, then organise that and feed it into article
creation. Assessed now because two scripts in the installed SEO skill were
proposed as a starting point.

### `scripts/lib/safe_http.py` — the valuable one

`fetch_page.py` is a thin wrapper; the substance is in the library beneath it,
and it is genuinely good. It does the parts crawlers usually get wrong:

- **SSRF protection** — resolves the host and rejects private and internal IPs,
  so a supplied URL cannot be pointed at localhost or the LAN.
- **Response size caps**, so one enormous document cannot exhaust memory.
- **Redirect limits** and scheme validation.

Cynth already has a per-hop redirect authorisation rule for product retrieval
(Milestone 18). The same reasoning applies here, and this is a good reference
implementation of it.

### `scripts/parse_html.py` — a good specification, not a good dependency

It extracts exactly the right things: title, meta description, canonical,
headings, internal and external links, images with alt/loading/dimensions,
JSON-LD schema, OpenGraph, Twitter cards, hreflang, robots directives, lang,
viewport and word count. As a **checklist of what to extract**, it is worth
following closely.

As runtime code it is the wrong shape for Cynth. It is Python and
BeautifulSoup; Cynth is a single Node process served by a Windows Scheduled
Task. Shelling out to Python would make it a hard runtime dependency of the
server for one feature.

**Recommendation**: port the logic to TypeScript, using `safe_http.py` as the
specification for the fetch guards and `parse_html.py` as the specification for
extraction. Do not shell out.

### The gap neither script covers

**Neither reads robots.txt.** They read `meta robots` and the `X-Robots-Tag`
header — which is what a page says about *indexing*, not what a site says about
*crawling*. The standing rule that Cynth does not weaken compliance to make a
retrieval work applies here in full.

**Cynth already has that half**, and an earlier draft of this note wrongly
implied otherwise. `web-intelligence/retrievers/httpRetriever.ts` (Milestones
17-18) already fetches and parses robots.txt with wildcard and `$` matching,
caches it per host, honours crawl-delay, sends a named user agent, rate-limits,
caps responses at 5 MB, and follows redirects with **per-hop authorisation**
rather than `redirect: 'follow'` — which is stricter than `safe_http.py`. An
unreadable robots.txt is treated as a refusal, not as permission.

So the remaining gap is narrower than it first appeared:

1. **Private-IP rejection.** The one guard `safe_http.py` has that the existing
   retriever does not: resolve the host and refuse private or internal
   addresses, so a supplied URL cannot be aimed at localhost or the LAN. The
   existing retriever was built for known retailer domains; a feature that
   accepts an arbitrary URL from the user needs this.
2. **Extraction.** `httpRetriever.ts` pulls only `<title>`. Everything else on
   the `parse_html.py` checklist — meta description, canonical, headings,
   links, images, schema, OpenGraph, hreflang — has to be written.

---

## Milestone 35 — The Description That Never Arrived (Complete, 2026-09-13)

Reported as: "CYNTH when creating the article only uses the 'What's it for' &
'The problem it solves' info and misses out both short & long descriptions."

Half right, and the half that was right mattered a great deal.

### One `??` discarded most of what was known about every product

`generationContext.service.ts` resolved the two description fields into one:

```ts
description: product.shortDescription ?? product.description,
```

So a product with **both** — the normal case, since research fills both — sent
the writer the short one and silently dropped the long one. The short
description did reach the writer, labelled "Description", which is why the
report was half right. The long description never did.

Measured on the four products of the live litter-box article:

| Product | Short | Full (discarded) |
|---|---|---|
| Cumrige Automatic Litter Box | 248 | **958** |
| UPFAS Automatic Litter Box | 261 | **932** |
| Amazon Basics Large Litter Box | 247 | **722** |
| Dr. Elsey's Ultra UnScented | 235 | **819** |
| **Total** | 991 | **3,431** |

The writer was receiving 991 characters of description and losing 3,431 —
roughly **four and a half times more than it got**. The long description is
where the specifics live: capacities, materials, dimensions, compatibility.
Exactly the detail that separates a useful product paragraph from a vague one.

### The fix

The two fields are now carried apart, because they are not two versions of the
same text:

- **`shortDescription`** — the editor's summary line, written for a card.
- **`description`** — the full detail, usually the longest thing known.

Every consumer now chooses deliberately instead of inheriting a coalesce:

| Consumer | Uses |
|---|---|
| Writer prompt (pipeline) | **both**, as `Summary:` and `Full description:` |
| Writer prompt (manual wizard) | **both**, same labels |
| Published card (`productCard.ts`) | `useCase ?? shortDescription ?? description` |
| Preview card (`ArticleContent.tsx`) | the same precedence, deliberately |

A card wants the short text. Falling back to the long one would drop a wall of
manufacturer copy into the middle of an article, so the long description is
reachable by a card only when nothing shorter exists at all.

The long description is also not repeated under two labels when there is no
short one, and the "nothing is recorded about this product" guard now considers
both fields — otherwise a product described at length in one field only would
have arrived labelled as unknown.

### Framing, which matters as much as the data

A long description is usually the manufacturer's own marketing copy. It is
simultaneously the richest source of specifics available and the most likely
thing to drag advertising language into the article. Supplying it without
saying what it is would have been the worse outcome, so the prompt says both:

> The description fields are SOURCE MATERIAL, not copy to reuse. "Full
> description" is usually written by the manufacturer: take the specifics from
> it — sizes, capacities, materials, what it works with — and state them in
> your own voice. Never echo its phrasing, its superlatives or its sales
> framing.
>
> Where the supplied text makes a claim you cannot check, either attribute it
> ("the manufacturer says...") or leave it out. Do not restate a marketing
> claim as a finding of fact.

This is the same principle as the affiliate URL rule: the useful part of a
retailer's data is taken, and the part that would compromise the article is
explicitly refused.

### Cost

About 3,400 extra characters of prompt for a four-product article — roughly 850
input tokens, under **$0.005** on the current writer. For 4.5x the product
detail.

### Tests

3 new (**445 total**):

1. Both descriptions reach the writer under distinct labels, and the specifics
   that exist ONLY in the long one (`210D ripstop`, `Rated to 18 kg`) actually
   arrive — asserting on the detail, not on the field name.
2. The source-material framing is present, including the attribution rule.
3. A product with only a long description is not reported as unresearched, and
   the long text is not repeated under two labels.

### Verified live

`GET /articles/24/products` returns both fields for all four products, and the
preview cards still show their short blurbs (241-280 characters each) rather
than the manufacturer copy — so the change reaches the writer and nothing else.

### Known limitations at completion

1. **`bestFor` is empty on every live product**, and `keyFeatures` on most.
   Those fields reach the writer and always did; they simply have nothing in
   them. Filling them is editorial work, not a code change.
2. **The legacy single-product block** in the manual prompt builder still emits
   one `Description` line. It reads a narrower type kept only for drafts that
   predate `article_products`, and nothing writes to it any more.

---

## Milestone 36 — The Meta Description, and the Slug (Complete, 2026-09-23)

Reported as: every SEO ranking check flags the same two things — no meta
description, and "The article has no slug".

Both were real. They had different causes, and only one of them is fully
closed by this milestone.

### The meta description was never produced by anything

`article_seo.meta_description` was reachable by exactly one route: a manual
`PUT` from the SEO screen. No stage wrote it. Confirmed against the live
database — **NULL on all nine generated articles**, as was `seo_title`.

The writer already produces an `excerpt`, which is a different thing for a
different reader: the excerpt is a listing blurb for someone already on the
site; a meta description has to earn a click from a results page. Reusing one
as the other is the obvious failure, so the prompt says so directly:

> The meta description is what appears under the title in search results.
> Write it for someone who has not clicked yet: say what the article settles
> and who it is for, in 70-160 characters. It is NOT the excerpt reworded, and
> it must not be a sentence lifted from the article.

The writer owns it because the writer is the only stage that has read the
finished article, and because it costs nothing — one more field in a call that
already happens.

Two rules hold it honest:

- **Nothing invents one downstream.** If the model omits it the field stays
  empty. A fabricated description is worse than letting the search engine pick
  its own snippet from the text.
- **A human description is never overwritten.** An editor who has written
  their own search-result copy has made a decision, and a revision or a
  regenerate must not silently replace it. Only an empty field is filled.

### The slug was assigned by a startup backfill, and nothing else

`refreshSlug()` recomputes an article's slug from its title and is correctly
called by `saveGeneratedArticle` — the MANUAL generation path. The pipeline
does not use that function. Its own `saveArticle()` wrote the title and never
refreshed the slug.

So a pipeline-generated article had **no slug until the server next
restarted**, when the "articles that predate slug support" backfill happened to
catch it. That backfill masked the bug for every older article and left the
newest one bare — which is exactly what was observed: one article with a
perfect title and `slug = NULL`.

`saveArticle()` now calls `refreshArticleSlug()`, so the slug exists the moment
the article has a title. `refreshSlug` was exported for this; it previously had
no callers outside its own file.

### What a slug is, and why it matters here

The slug is the part of the URL that identifies the page —
`everyfivedays.com/**automatic-litter-box-buyers-guide**/`. Cynth derives it
from the title and sends it to WordPress on push. Without one, WordPress
invents its own from whatever title it receives, which means the URL is decided
by the CMS rather than by the editor, and can differ from what Cynth records.

### The half this milestone does NOT close

**Cynth cannot push a meta description to WordPress, and this is not a Cynth
limitation.**

WordPress core has nowhere to put one. A meta description lives in whichever
SEO plugin the site runs, under that plugin's own post-meta keys — Yoast, Rank
Math, SEOPress and AIOSEO all differ. `cms/seoAdapter.ts` has held an
intentionally empty mapping registry since Milestone 14 for exactly this
reason, and `wordpressConnector.draftBody()` deliberately writes no SEO fields.

Checked against the live site on 2026-09-23:

- `https://everyfivedays.com/wp-json/` lists no SEO plugin namespace. The
  registered namespaces are oembed, novamira, duplicator, several elementor
  ones, image-optimizer and xpro — **no Yoast, Rank Math, SEOPress or AIOSEO.**
- The homepage `<head>` contains **no `<meta name="description">` and no
  `og:description`** at all.

So the site currently publishes no meta descriptions from any source, which is
why the ranking check reports it. Cynth now has the text; there is nowhere on
the site to put it yet.

When an SEO plugin is chosen, the work is one `SeoFieldMapping` registered in
`seoAdapter.ts` plus applying it in `draftBody()`. The seam was built for this
and nothing else in Cynth changes.

### Tests

3 new (**448 total**):

1. A generated article gets both a slug and a meta description — and the
   description is asserted NOT to equal the excerpt, which is the failure this
   would most likely regress into.
2. A hand-written meta description survives a full review-and-revision cycle.
3. The writer prompt actually explains what a meta description is for; its
   absence would be a silent quality regression rather than a visible failure.

### Known limitations at completion

1. **Existing articles have no meta description.** Nine of them. Producing one
   means re-running a writer that has already been paid for, so nothing was
   backfilled automatically. A cheap dedicated backfill pass would be a small
   piece of separate work.
2. **The push gap above**, pending an SEO plugin decision.
3. **`seo_title` is still never generated.** The same gap as the meta
   description, and deliberately not fixed in the same pass: an SEO title is
   only worth setting when it differs from the editorial title, and Cynth
   already states that the article title stands in when none is set. Worth
   revisiting once real SERP data exists.

---

## Milestone 37 — Rank Math, and the Meta Description Backfill (Complete, 2026-09-23)

Rank Math was chosen and installed. This wires Cynth to it, and fills in the
meta descriptions of every article written before Milestone 36.

### What Rank Math was already doing

Worth stating, because it changes what "fixed" means here. Checked against the
live site: a published post already had a meta description —

> A laptop cannot put the screen and the keyboard in the right place at the
> same time. Here are the three honest ways around that, ranked…

That is **Cynth's excerpt, verbatim**. Rank Math's default description template
is `%excerpt%`, and Cynth already pushes an excerpt, so posts were getting a
description by fallback. Functional, but it is the listing blurb doing a job it
was not written for — exactly the conflation Milestone 36 separated.

So the goal was not "produce a description where there was none", it was
"replace the fallback with copy written for a results page".

### The mapping

`cms/seoAdapter.ts` held a deliberately empty registry from Milestone 14. It
now holds one entry, for Rank Math's four post-meta keys:

| Cynth | Rank Math |
|---|---|
| `metaDescription` | `rank_math_description` |
| `seoTitle` | `rank_math_title` |
| `canonicalUrl` | `rank_math_canonical_url` |
| `targetQuery` | `rank_math_focus_keyword` |

Only non-empty values are emitted. An empty string would overwrite something a
human had written in Rank Math's own editor, which is the one outcome worse
than sending nothing.

**Which mapping applies is configuration, not assumption.** A new
`cms_connections.seo_target` column names the plugin per connection; a null or
unrecognised target selects no mapping and sends no plugin fields, which is
exactly what every connection did before. A typo degrades to "no SEO fields",
never to wrong ones.

### The precondition, which is on the WordPress side

Rank Math does not register its meta keys with `show_in_rest`. Verified
directly: `GET /wp-json/wp/v2/posts?_fields=meta` returns only `footnotes`.
**WordPress silently drops unregistered meta keys** — no error, no effect, a
push that looks like it worked.

`docs/rank-math-rest-meta.php` is the mu-plugin that registers the four keys.
It is deliberately narrow:

- `auth_callback` requires `edit_post` — the same permission WordPress already
  requires to edit the post. It grants no access anyone did not have.
- It registers only the four keys Cynth writes. Every other Rank Math field
  stays editable only in Rank Math's own interface.
- It reads, changes and deletes nothing. Registration only.

Until that file is installed at `wp-content/mu-plugins/`, the mapping produces
fields WordPress ignores.

### The backfill

A `meta_description` model purpose, routed to a free model, that reads a
finished article and writes one description. **It is a repair path, not the
default** — see the note below.

Rules it inherits rather than reinvents: it routes through the Model Router, it
passes the same spend gate, and **it never overwrites a description that
exists**. An article that already has one is refused rather than rewritten,
which is what makes "run it over everything" safe.

Run over all nine existing articles on `inclusionai/ling-3.0-flash-fin:free`:
**9 written, 0 failed, at no cost.** Every description landed between 127 and
159 characters.

#### One defect found and fixed in the same pass

Three of the first nine were cut mid-word — *"...when the tracking itself
becomes count"* — because the cleaner ended in a hard `slice(0, 160)`. That
reads as broken rather than as shortened.

`trimToLimit()` now prefers the last complete sentence that fits, falls back to
the last whole word, and strips a dangling comma or hanging conjunction. The
three affected descriptions were cleared and rewritten; all three now end
properly.

### Why the free model is NOT the default for new articles

The question was whether to make this the standard path going forward. It
should not be, and the reasoning is worth recording because it is not obvious:

- **The writer already produces one for nothing.** It is one more field in a
  call that is already being made and paid for. A separate pass cannot be
  cheaper than free.
- **The writer has the best context.** It has just written the whole article.
  The backfill model sees the title, the excerpt and the first 700 words.
- **A separate call is a separate failure mode.** Another request, another
  timeout, another rate limit, another stage that can leave an article
  half-finished — to replace something that already works.
- **Free models here have a record of returning empty.** That is why guided
  runs kept failing in Development mode.

The right shape is the one built: **the writer produces it by default, and the
free-model pass repairs anything that lacks one.** That also covers the
"moving forward" worry — if the writer ever omits a description, the backfill
fills it, on demand, for nothing.

### Tests

5 new (**453 total**): the cleaner strips quoting and labels; an over-long
description trims at a boundary rather than mid-word; a short one is untouched;
the Rank Math mapping emits only fields that have values; an unknown target
selects no mapping.

**One existing test was rewritten rather than deleted.** It asserted the
mapping registry was EMPTY — correct while no stack had been chosen. The
guarantee it protected still holds and is now stated directly: a mapping exists
only for a target a connection explicitly names, and an unnamed or unknown
target selects nothing.

### Known limitations at completion

1. **The mu-plugin is not installed.** Until it is, `rank_math_description` is
   sent and ignored, and Rank Math keeps using its `%excerpt%` fallback.
2. **`seo_target` has no UI yet.** It is set per connection in the database;
   the connection form does not expose it. All three WordPress connections were
   set to `rankmath`.
3. **`seo_title` is still never generated**, so `rank_math_title` is only ever
   sent when a human has written one. Unchanged from Milestone 36.

---

## Milestone 38 — SEO Title, Focus Keyword, and Metadata-Only Push (Complete, 2026-09-23)

Four things, from four questions.

### 1. The HTML encoding worry was mine, and it was wrong

I flagged `â€"` in the pushed content and said it might be mojibake. Checked
properly at byte level:

- **Database**: zero mojibake sequences, 138 real em dashes across nine
  articles.
- **Live page**: decodes as clean UTF-8, 24 `E2 80 94` em-dash sequences, zero
  `C3 A2 E2 82 AC` mojibake sequences.

The mangling was in my own terminal display pipeline, not in the content.
Recorded because "I raised it, I checked it, it is not real" is worth as much
as a fix.

### 2. An SEO title is not wrong — it was needed

The question was whether Cynth writing one is a mistake. Measured on the nine
real articles:

| | |
|---|---|
| Titles over the ~60 characters a search result shows | **8 of 9** |
| Longest | 100 characters (CGMs Without Diabetes) |
| Only one that fits | 38 characters (7 Best Budget Hiking Backpacks) |

Eight of nine were being cut off mid-word in search results. The two titles do
different jobs and the architecture already separated them: the editorial
title is the H1 and can take the space it needs to be precise; the SEO title
has about 60 characters to earn a click.

The writer now produces one, the same way it produces the meta description —
one more field in a call already being made. With two rules:

- **An over-long one is discarded, not truncated.** Cynth already falls back
  to the article title when the field is empty, so storing a bad SERP title is
  worse than storing none.
- **One identical to the headline is discarded too.** It would be a second
  field to maintain that makes the result no better.

### 3. The focus keyword had nothing to grade

Rank Math scores a post against its focus keyword, which Cynth sends from
`article_seo.target_query`. **Eight of nine articles had that field NULL**, so
Cynth sent no focus keyword and Rank Math had nothing to grade.

The cause was a gap between two features that never spoke: the keyword stage
writes to the `keywords` table, and the SEO engine reads `article_seo` — and
nothing bridged them. The pipeline now fills the SEO configuration from what
the keyword stage already decided: target query, secondary keywords, semantic
topics and audience.

Free, since the stage has already run, and it cannot disagree with the stored
keywords because it is written from the same object. **Never over the top of a
human**: a target query an editor has set is what the article competes for,
and a rerun leaves it alone.

### 4. The canonical URL is deliberately left empty

Asked to do what is best technically, and the best thing here is nothing.

For an ordinary post on one site, the canonical URL is the post's own
permalink, and Rank Math emits that automatically. Writing one from Cynth
would at best duplicate what the plugin already does correctly.

At worst it does real harm. A canonical pointing at the wrong URL tells Google
to index that other page *instead of this one* — a wrong canonical can remove
a page from search results entirely. It is worth setting only for syndicated
or deliberately duplicated content, which is a judgement about publishing
strategy rather than something to derive from an article record.

So `rank_math_canonical_url` stays empty unless a human fills it, and that is
the correct outcome rather than an unfinished one.

### 5. Metadata-only push — the third option, built

Cynth refuses to modify published CONTENT, and that rule is right. But it made
the SEO metadata feature useless on exactly the articles that matter: five of
six live articles were already published, so their meta descriptions could
never be sent.

`pushSeoMetadata()` is the narrow path. **A meta description is not content**
— no reader sees it on the page — so writing one to a published post changes
nothing a reader can observe and does not touch its published state.

Narrow by construction rather than by promise: `updateSeoMetadata()` on the
connector builds a request body containing `meta` and nothing else. There is
no code path in it that can send a title, a body, an excerpt, a slug or a
status.

**Proven against the live site**, on both kinds of post:

| Post | Status | Result |
|---|---|---|
| 346 | draft | `rank_math_description` written |
| 344 | **published** | `rank_math_description` written, still published, body unchanged (3,545 words) |

### One thing to know: Hostinger caches the rendered page

After writing to post 344, the stored meta was correct — verified by reading it
back authenticated — but the public page still served the OLD description.
That is `hcdn`, Hostinger's CDN, serving cached HTML; a `?nocache=` query
string did not bypass it.

So the sequence is: Cynth writes → WordPress stores → **the page updates when
the cache is purged or expires.** Purging is a Hostinger-side action. Anyone
verifying this work should read the post meta over the REST API rather than
scraping the rendered page, or they will conclude a correct write failed.

### Tests

4 new (**457 total**): a long headline gets a short SERP title that is not the
headline again; an over-long SERP title is discarded rather than stored; the
pipeline fills the SEO target query from the keyword stage; a target query the
editor set survives a rerun.

### Known limitations at completion

1. **No UI for the metadata-only push.** It is `POST /articles/:id/cms/push-seo`
   with a `connectionId`. The article screen does not offer a button yet.
2. **The eight existing articles still have no SEO title**, and no backfill
   writes one — the meta-description backfill covers only the description.
   Regenerating is the only current route for those.
3. **`seo_target` still has no UI**, unchanged from Milestone 37.

---

## Milestone 39 — One Pass, Two Fields, and a Button (Complete, 2026-09-23)

Both gaps from Milestone 38 closed, but not as the two separate features they
were described as.

### Why the backfills were merged instead of doubled

The obvious reading was "add an SEO title backfill alongside the meta
description backfill". That would have meant two near-identical services and
**two model calls per article** for two facts derived from one reading of it.

A meta description and an SEO title are the same job: how does this article
present itself on a results page. Writing them together is cheaper, and more
importantly it is the only way the two are guaranteed to agree with each other
rather than being written blind of one another.

So `writeMetaDescription` became `writeSearchMetadata`, which:

- **Asks only for what is missing.** An article with a good description and no
  SEO title is asked for a title alone. The prompt is built from the gaps.
- **Asks for an SEO title only when the headline does not fit.** Below the
  SERP limit the article title does the job, and a second field saying the
  same thing is a field to maintain for nothing.
- **Refuses an article that needs neither**, which is what makes "run it over
  everything" safe without the caller filtering first.
- **Discards an over-long SEO title rather than truncating it.** The field
  exists *because* the editorial title is too long; a truncated one defeats
  its own purpose, and Cynth already falls back to the article title.

### The buttons

Two, on the SEO panel, in their own row because they do a different kind of
thing from analysis — analysis only reports, these two WRITE and SEND:

- **Write missing search metadata** — fills empty fields only.
- **Push SEO metadata to WordPress** — sends only the SEO fields. Safe on a
  published post.

### Run over the real articles

**SEO titles, 8 candidates:**

| | |
|---|---|
| Written first pass | 7 of 8, every one 50-57 characters |
| Failed | 1 (article 32) — the model returned a title over the limit, which was correctly discarded rather than truncated |
| After one retry | 8 of 8 |

The failure is worth recording as a success of the rule: the model produced
something unusable, Cynth saved nothing and said so, and a retry got a good
one. A truncating implementation would have stored a broken title and reported
success.

Examples, against the headlines they replace:

| Editorial title | SEO title |
|---|---|
| What Happens When You Stop Paying for Whoop, Oura, Fitbit, Garmin or Ultrahuman (80c) | What Canceling Your Recovery Wearable Really Costs (50c) |
| How to Make a Laptop Workspace Ergonomic Without Spending Much (62c) | Your laptop posture problem, and three ways to fix it (53c) |
| CGMs Without Diabetes: What the Sensor Measures, and the Smallest Difference It Can Honestly Resolve (100c) | What a Consumer CGM Measures, and How Precise It Really Is (58c) |

**Metadata pushed to the live site: 6 of 6**, five of them PUBLISHED posts —
the case the old content-push path could never serve. Verified by reading the
post meta back authenticated: every one carries both `rank_math_title` and
`rank_math_description`, and every post kept its published state.

### Tests

3 new (**460 total**): an SEO title is wanted only when the headline overruns;
an article needing neither field is not a candidate; an over-long SEO title is
discarded rather than truncated.

### The focus keyword, backfilled for free

The Milestone 38 fix filled `article_seo.target_query` for NEW articles only,
which left the eight existing ones with nothing for Rank Math to grade.

No model call was needed to repair them: the keyword stage had already written
a `primary_keyword` for every one into the `keywords` table — the two tables
simply never spoke. Copying it across, under the same "fill a blank, never
replace a decision" rule, filled 8 and left 1 alone (article 3, which an
editor had already set).

All six live posts were then re-pushed and verified: **6 of 6 now carry
`rank_math_title`, `rank_math_description` AND `rank_math_focus_keyword`**.

### Known limitations at completion

1. **The rendered pages still show the old descriptions** until Hostinger's
   cache is purged. The stored values are correct — verify over the REST API,
   not by scraping the page. See Milestone 38.
2. **`seo_target` still has no UI.** Set per connection in the database.
3. **The canonical URL is still deliberately empty**, per Milestone 38.

---

## Milestone 40 — The Featured Images Were Asking the Wrong Model (Complete, 2026-09-25)

Reported as: the featured images are trash, the information they show makes no
sense, and the no-real-products constraint seems to be destroying the quality.

The last part was half right, and the half that was wrong matters more.

### What the images actually looked like

Two of the three ever generated, read back from disk:

**"Creatine for Cognition"** — a floating brain dissolving into blue particles.
The single most generic stock image in existence for anything cognitive.

**"How to Make a Laptop Workspace Ergonomic Without Spending Much"** — a
premium height-adjustable standing desk with an external monitor and an
ergonomic office chair. Technically a clean photograph, and it **contradicts
the article**, which is about fixing your posture for nothing using a stack of
books.

Neither is a model performing badly. Both are a model being asked the wrong
question.

### Three faults, one cause

The prompt was a specification document — `=== WHAT THE ARTICLE IS ABOUT ===`,
`=== STYLE ===`, `=== HARD RULES ===` — handed to a diffusion model.

1. **Diffusion models weight tokens; they do not parse documents.** Roughly
   half the prompt was headings and meta-instruction, diluting the subject.

2. **The prohibitions were negations, aimed at the one component that cannot
   act on them.** "Do not depict any identifiable real-world product, brand,
   logo, packaging or trademark" pushes all five of those words into the
   conditioning. There is no reliable NOT operator, and Cynth's image adapter
   has no negative-prompt parameter to put them in instead.

3. **Nothing decided what to DRAW.** "Something that evokes the subject" left
   an editorial judgement to a diffusion model, which resolves it by reaching
   for the nearest cliché. Hence the brain. Hence the desk.

The article's actual content never reached the prompt at all — only its title,
topic and theme. That is why the ergonomics image could not know the piece was
about spending nothing.

### The fix: decide first, draw second

`imageDirection.service.ts` is a new stage. A **text** model reads the article
and chooses one concrete scene. The image model then photographs that scene and
is never asked to interpret anything.

The director is told what a good choice is, in the terms that actually matter:

> The image must agree with what the article actually ARGUES, not just its
> topic. An article about doing something cheaply must not show expensive
> equipment.

And it is told which clichés to avoid **by name**, because a generic "avoid
clichés" does nothing — the model does not know which ones it reaches for.
Eight are listed, including the floating brain, the lightbulb, the glowing
neural network and "an immaculate empty desk that looks like a furniture
advertisement".

### The constraints were not relaxed. They moved.

This is the part the report got half right.

The constraint was not the problem; **asking a diffusion model to honour it
was**. "Do not name a real product" is trivial for a language model and nearly
meaningless to an image model. So the rules now sit in the director's prompt,
as instructions to something that can follow them, and the image model receives
no prohibition list at all.

One negative clause is kept in the image prompt: **no text**. That exception is
deliberate — every image model still garbles lettering, and unlike a brand it
cannot be prevented upstream, because a scene can be entirely text-free and the
model will still invent a sign.

A test asserts the old negation list has NOT come back.

### What it produces now

| Article | Before | After |
|---|---|---|
| Creatine for Cognition | a floating brain in blue particles | *"a half-empty tub of creatine monohydrate beside a chipped glass and a folded laundry basket… the quiet evidence of a small, unglamorous hope carried through another ordinary day"* |
| Laptop ergonomics on no budget | a premium standing desk and ergonomic chair | *"a laptop propped open on a stack of old paperbacks, elbows lifted off the table edge, a worn cushion behind someone's lower back, a faint coffee ring beside the screen"* |
| Automatic litter box guide | — | *"a gray cat sits rigidly beside an automatic litter box, half in and half out, one paw lifted… watching the unit with still, cautious eyes, not approaching"* |

The laptop scene is the article's own central recommendation. The litter box
scene is its actual argument — the failure mode, not a product beauty shot.

Note the creatine scene contains a *product category*, unbranded. That is
within the rule and always was; the old prompt's blanket negation was
suppressing it for no benefit.

### Order of operations, corrected

Choosing the scene is now a model call, so building the prompt first would mean
a refused image generation had still sent a request. The spend gate now runs
**before** the director, preserving the guarantee that a refusal costs nothing
and contacts nobody. A test caught this.

### Falling back

A director that cannot run does not remove the feature: generation falls back
to a short deterministic prompt, and the brief reports `scene: null,
directedBy: null` so a poor image is always traceable to the reason. The
fallback is deliberately vaguer than the old prompt — with nothing deciding
what to show, a short prompt produces a better generic image than a long one
full of rules.

### Cost

**Nothing.** The director runs on `inclusionai/ling-3.0-flash-fin:free`, the
same free model used for search metadata, under a new `image_direction`
purpose that falls back through the other short-copy purposes if unassigned.

### Tests

4 rewritten, 2 new (**462 total**). The rewrites were necessary rather than
incidental: three existing tests asserted the negation list was IN the image
prompt, which was the defect. They now assert the opposite, plus that the
constraints are present in the director's prompt — the guarantee was restated,
not dropped.

### Generated and checked, and it found one more defect

Two real images were generated on Seedream 4.5, at $0.04 each.

**The first was a large improvement and exposed a residual fault.** It showed
a laptop raised on a stack of books on a worn kitchen table, a cushion on the
chair, morning light — the article's own central recommendation, where the old
image had shown a premium standing desk. But the book spines faced the camera,
and the image model rendered **gibberish lettering** on every one.

That is the failure `NO_TEXT` exists to prevent, and it proved the clause
cannot do the job alone: telling the image model "no text" cannot save a scene
built from objects whose whole identity is printed lettering. The fix belongs
where the scene is chosen, so the director now has an extra rule — books,
packaging, labels and screens are allowed, but only where no lettering faces
the camera (spines turned away, a cover edge-on, a screen dark or angled), and
a scene that only works with its lettering visible must be replaced.

**The second generation confirmed it.** Same scene, reframed: the laptop
raised on books with a folded towel, the book *page edges* to camera rather
than the spines, a coffee ring on the counter — and, unprompted, a separate
external keyboard at the lower height with hands resting on it, which is the
article's second argument (a riser alone moves the problem to your shoulders).
No lettering anywhere in the frame.

One image that states both halves of the article's advice.

### Known limitations at completion

1. **Seedream returns one image per request regardless of `n`.** A request for
   two produced one, billed as one. The count parameter is sent and honoured
   by the contract; this model appears not to implement it.
2. **The three original images are unchanged.** Replacing them means
   generating again, at $0.04 each.
3. **`GET /prompt` now costs a model call**, because the prompt does not exist
   until a scene is chosen. Free, but no longer instant.

### Addendum — what twelve real images taught the director (2026-09-25)

Milestone 40 was documented with a stated limitation: *no image had been
generated with the new prompt yet*. Twelve then were, one per article, and
they found five faults that no amount of reading the prompt would have found.
Each is recorded with the image that produced it, because the image is the
evidence and the rule on its own reads like fussiness.

**1. Gibberish on book spines.** The director chose "a stack of old
paperbacks" — a good scene — and the image model wrote nonsense on every
spine. `NO_TEXT` cannot save a scene built from objects whose identity *is*
printed lettering. Rule added: books, packaging and screens are allowed only
where no lettering faces the camera.

**2. "A ring" becomes a wedding band.** Twice. For an article on sleep
trackers, "a thin silver ring resting on the pillow beside a sleeping person"
is, as a photograph, an article about a marriage ending. An image model draws
the most common thing a word can mean. Rule added: name an object by its shape
and material, not only its category.

**3. Which then produced a shop listing.** Describing form precisely pulled the
model towards the best-known object of that shape: a studio-lit smartwatch
beside a phone on a bare nightstand. No logo on it, and unmistakably one
company's hardware, shot the way that company shoots it. Rule added: a device
may appear, but never as the display piece — *if the frame would work as a
shop listing, it is the wrong frame*.

**4. An invented brand, and half a frame of mirrored gibberish.** The worst of
the twelve. The director put "a printed subscription sheet edged with dates"
in the scene — having been told twice not to put lettering in frame — and the
image model printed the invented brand name **"Smatter"** across the
appliance. This one is not a missing rule. The rule was there and was ignored,
so it became a **check**:

> `findTextRisk()` reads the chosen scene for words that carry print. If it
> finds one, the director is shown the exact phrase it wrote and asked again,
> up to three times, **before any image is paid for**.

The asymmetry is the argument: asking the director again is free, and the
image that would have followed costs four cents. The list is deliberately
short — a check that rejects good scenes costs a good photograph every time
and is invisible when it does. Bare `sheet` is not on it, because it would
reject a bedroom scene every time; `paper` is, except for towels, bags, clips,
cups and napkins.

When all three attempts still name something printed, the scene is used anyway
and the brief carries a `concern`. A director that cannot find a print-free
scene is not a reason to remove featured images from an article — but a
garbled image should be traceable rather than mysterious.

**5. "Worn" compounds into squalor.** The guidance said *a worn thing on a
kitchen table says more than a studio composition*, and "worn" plus "specific"
produced grimy tiles, peeling laminate, stained pillowcases and sediment in a
water bottle. Two changes: the camera clause no longer says "slightly
imperfect" (the intent was unstyled, not unclean), and the word "worn" is no
longer suggested to the director at all. A reader deciding what to buy should
not be looking at a photograph that feels like bad news.

### One image, not three

`DEFAULT_CANDIDATES` is now 1.

Seedream 4.5 returns a single image per request whatever `n` says — asking for
three produced one, billed as one — so the old default promised a choice the
provider never delivered. And now that the director chooses the scene, extra
candidates are the same scene redrawn rather than competing ideas: on a
provider that *does* honour `n`, three would be three charges for three
near-identical photographs. The control still offers up to four.

The confirmation dialog also read `MAX_CANDIDATES`, so an unspecified count
asked the editor to approve four images and then drew one. Approving a figure
you are not charged is the wrong way round even when it errs cheap.

### What the twelve cost, and what they produced

**$0.48**, all on Seedream 4.5 at $0.04 each. Nine articles have a candidate
or an attached image; five of the twelve were retries after a fault above.

| Article | Scene |
|---|---|
| Budget hiking backpacks | scuffed pack half-open on a kitchen table, dented bottle, paper map — **accepted** |
| Laptop ergonomics | laptop on books with an external keyboard in use — **accepted** |
| Automatic litter boxes | a cat sitting back watching the unit mid-cycle, not approaching |
| Creatine | loose powder, a scoop and a glass of water *(was: a floating brain)* |
| Pet-tech subscriptions | an unbranded feeder unplugged on the counter, cat waiting below |
| Sleep tracker accuracy | a matte black band left on the pillow of an unmade bed |
| CGMs without diabetes | a plain white sensor disc on a forearm beside a coffee mug |
| Caffeine + L-theanine | a blank blister strip beside a mug in morning light |

### Known limitations at completion

1. **Grime is reduced, not eliminated.** The creatine retry still came back
   with a chipped counter edge. The image model adds wear the scene never
   asked for.
2. **`concern` is carried but not yet shown in the panel.** It reaches the
   brief; the UI does not display it.
3. **`GET /prompt` and `POST /generate` each run the director**, so the
   previewed scene is not the one drawn — only the same kind of scene.
4. **Article 34 has no title**, so it is correctly refused rather than drawn.

---

## Milestone 41 — Illustrations, and the Image That Could Not Reach the Site (Complete, 2026-09-25)

Two unrelated faults, both found by an editor looking at the result rather
than at the code.

### The image that had nowhere to go

Reported as: *there's no image for "How to Make a Laptop Workspace Ergonomic
Without Spending Much"*. In Cynth there plainly was one — attached, serving,
correct. On the live site:

```
GET /wp-json/wp/v2/posts/344 → {"status":"publish","featured_media":0}
```

Nothing was broken. **There was no path.** The article was pushed, the image
was chosen afterwards, and every write the WordPress connector makes to a post
restates `status: draft` — the invariant the whole module is built around. So
the only way to give a published article its picture would have been to
unpublish it first.

Four live posts were in that state: three with no image, and two carrying the
pre-Milestone-40 images (including the floating brain on the creatine
article).

`pushFeaturedImage()` closes it, following `pushSeoMetadata()` exactly, and
for the same reason: **a featured image is not the article's content.** It
changes no word a reader reads. The connector uploads the file, points
`featured_media` at it, and sends **no status at all** — that omission is what
makes it safe, because WordPress then leaves the post's own status alone.

A test asserts no status and no title, body, slug, excerpt or author is ever
sent on this path.

**The test harness was asserting the wrong invariant.** The fake WordPress
demanded `status === 'draft'` on *every* post write — which would have
rejected the metadata-only paths for doing the one thing that makes them safe.
Corrected to what the rule actually is: Cynth never writes a status other than
draft, and may write none.

### Illustration mode

An editor asked for a person deciding whether to keep paying, with a thought
bubble over their head holding the device — and got a photograph of a band on
a windowsill instead. Two separate faults.

**The director was quietly overruling the editor.** Given a steer it did not
like, it reverted to its own preference for the photographable. The steer is
now stated as binding: *"That instruction is binding. Where it conflicts with
anything below, follow the editor."*

**And the medium was assumed.** Every rule in the director was written for a
photograph, and the prompt ended "editorial photograph, natural light, shallow
depth of field" — so a drawn idea came back as a real room with a cartoon
pasted into it. `style` is now `photograph` (the default) or `illustration`,
which swaps the camera clause for a drawing clause and tells the director that
thought bubbles, cutaways and comparisons are available to it.

A note on the first version of this entry, which claimed a photograph *cannot*
carry a thought bubble. It can — a photo-illustration with a drawn bubble is
ordinary editorial practice, and the editor said so. Both now work: the same
request run as a photograph produced a real woman at a real kitchen table with
a crisp white bubble above her head. Illustration mode is for ideas that have
no physical referent at all, not for this.

### An empty answer no longer costs four cents

Observed on a real generation: the free director model returned an empty body,
the director threw, and the whole article fell through to the deterministic
fallback — which then spent $0.04 drawing *"a quiet environmental photograph
suggesting the setting of…"*, complete with "no people in focus", contradicting
the editor's own request for a person.

Retrying the director is free. It now retries within the same loop that
handles printed-text risk, and only falls back if three attempts come back
empty.

### Cost

**$0.12** — three images at $0.04: the drawn version, the photographic version
the editor actually wanted, and the fallback one that prompted the retry fix.

### Tests

472 pass. 4 new for style and the empty-answer retry, 2 new for the image
push, and the mock's invariant restated.

### Known limitations at completion

1. **The style is per-generation, not remembered.** Each new generation starts
   at Photograph.
2. **`pushFeaturedImage` replaces, it does not clean up.** The previous
   attachment stays in the WordPress media library.
3. **No image has been pushed to the live site yet** — the route, the button
   and the tests exist; sending is the editor's call.

### Addendum — publishing an article removed it from Cynth (2026-09-26)

Reported as: *this article isn't present on CYNTH* — about a piece that was
there the whole time. Article 27, 9,514 characters, written on 2026-09-14 by
`openai/gpt-5.6-sol-pro`, with a featured image attached.

`DraftsPage` is the only page in Cynth that lists articles, and it asked the
server for `status: 'draft'` and nothing else. There are exactly two statuses.
So marking an article published did not move it somewhere else — it removed it
from the application, reachable only by typing its URL.

The page now offers **Drafts / Published / All** and is titled Articles. The
server already supported the filter; nothing there changed.

Worth naming the shape of this, because it is not a display bug. A list that
hard-codes one value of the only field that classifies its rows will hide
everything else, silently, and the absence looks like data loss to whoever is
looking for it.

### A false alarm, checked before reporting

The published article's title came back through `curl` as
`Â£300â€"Â£600` — the textbook double-encoding signature. Read straight out of
SQLite by codepoint it is `£` U+00A3 and `–` U+2013: clean UTF-8, mojibake
only in the terminal pipe. The same false alarm as the em dashes in Milestone
39, caught the same way, and recorded here so the next look at a mangled
pound sign starts with the bytes.

---

## Milestone 42 — Photographing the Topic Instead of the Argument (Complete, 2026-09-27)

Reported as: three paid generations for *"Pet Tech Subscriptions: Three-Year
Cost and What Stops Working When You Cancel"*, all producing images unrelated
to the subject.

They were not random. Asked three times through the free preview, the director
returned the same photograph:

> *"a matte-black pet feeder beside a ceramic bowl, a phone face-down"*
> *"a matte white plastic pet feeder sits beside a ceramic bowl, a phone resting face-down"*
> *"a square white feeder with a rounded lid beside a faded ceramic bowl, a phone screen-down"*

The topic photographed; the argument absent. That article is about
thirty-six monthly payments and a device going inert when you stop paying, and
**no object means either of those things**. Told to "choose ONE real, specific,
physical scene", the director could only point at the nearest object. Retrying
could never have fixed it.

### Three changes

**Say what to do when the argument has no object.** Some articles argue about
a cost mounting over years, two options compared, a service that degrades.
Photographing the thing at rest says nothing about any of them, so the
director is now told to show the CONSEQUENCE — the moment it reaches a person
or an animal, the waiting, the going-without, the two states side by side.

With a second line that names the tell:

> If you find yourself placing the subject on a table because nothing else
> comes to mind, that is the signal you are photographing the topic rather
> than the argument.

Re-sampled three times afterwards, all three scenes found the article's own
strongest sentence — *"A camera going dark is an inconvenience. A feeder going
dark is a dog who didn't eat"* — and put the dog in the frame.

**The house cliché.** Reviewing the day's output: a backpack on a kitchen
table, a wristband on a nightstand, powder on a counter, a feeder on a
counter, a tracker on a counter. Each defensible alone; together, one
photograph printed five times. *A single object resting on a kitchen table or
counter, shot across the surface in window light* is now named in the banned
list as this publication's own cliché, not a generic one.

**Previewing and drawing are the same scene now.** `GET /prompt` and
`POST /generate` each ran the director, so the scene an editor read was never
the scene drawn — which is what turned "try again" into a four-cent lottery.
The generate call now accepts a `scene`, and given one the director does not
run at all. The panel's *Show the prompt first* became **Suggest a scene
(free)**, with **Draw this scene** and **Suggest another** beneath it: ask as
many times as you like for nothing, pay once for the one you chose.

The printed-text check still runs on a supplied scene. Skipping the director
must not skip the guard — an editor pasting "a receipt on the counter" should
be told, not quietly charged for an image full of garbled lettering.

### What it produced

A dog sitting beside an empty bowl, head up, next to an unbranded automatic
feeder with no light on it. The article's argument, in one frame.

### Cost

**$0.08** — two images. The first, drawn before the scene could be pinned,
came back without the dog: a person standing in a kitchen beside an empty bowl
and a collar that reads as a belt. That image is the case for the feature.

### Tests

475 pass, 3 new.

### Known limitations at completion

1. **Grime persists.** The accepted image has a stained tile floor the scene
   never asked for.
2. **Background labels are not verifiable here.** The image contains blurred
   jars on a shelf; nothing is legible at full size, but they are labels, and
   there is no image library installed to crop and check them properly.
3. **A suggested scene is not stored.** Reloading the panel loses it.

### Addendum — the previous batch is no longer destroyed (2026-09-27)

Asked to see the earlier suggestion for the pet-subscriptions article to
compare the two, and it did not exist. `generateFeaturedImages` called
`discardCandidates` before writing the new batch, deleting the last one
outright.

That was the right behaviour when it was written: a batch meant three
renderings of one idea, and choosing between candidates built from two
different prompts is a worse problem than losing one. It stopped being right
the moment each generation became a deliberate, paid attempt at a DIFFERENT
idea — which is exactly what Milestone 42's free-preview loop encourages.

Exactly one batch back is now kept, in `pending/superseded`, and shown in the
panel as **Previous suggestion** with its own *Use this one instead*. Enough
to compare two ideas; not a folder that fills with pictures nobody chose.

Two details that keep it honest: a kept image is selectable, so preferring the
earlier idea is one click and not a regeneration; and *Discard all* takes the
kept copy too, because discarding should mean discarding rather than leaving a
back door.

---

## Milestone 43 — Every Product Button Said "Check Price" (Complete, 2026-09-28)

Reported as: the cards in the pushed articles read "Check price" instead of
"Shop on Amazon".

Nothing was broken on the site. Its shortcode already holds the right map:

```php
const VENDORS = array(
    'amazon' => array( 'Shop on Amazon', 'efd-product-card--amazon' ),
);
const VENDOR_FALLBACK_LABEL = 'Check price';
```

That fallback is deliberate and correct — never claim a shop you cannot name.
It was firing because **Cynth never sent a vendor**. The `products.vendor`
column existed, `renderProductCard` read it, and a comment in that file
asserted the value was "derived from a URL host". Nothing had ever written to
it. All 22 rows were NULL, so no card carried a `vendor=` attribute, so every
button on the site took the fallback.

A comment describing behaviour that was never implemented is worse than no
comment: it stops the next reader looking.

### Read from the link, never guessed

`vendor.service.ts` derives the retailer from the host of the affiliate URL —
the one authoritative statement of where a reader is being sent. The URL
itself is parsed and nothing else: not rewritten, not canonicalised, not
appended to.

A host that identifies no shop returns null, and the card then carries no
vendor at all. Shorteners (`bit.ly`), affiliate networks (`awin1.com`,
`linksynergy.com`), IP addresses and unparseable strings all take that path,
because a wrong shop name on an affiliate button is worse than a neutral one.

### Naming a retailer nobody has listed yet

The requirement was "later, when I add other companies, it should say the
exact platform". That cannot depend on somebody editing a map first, so two
attributes go out:

- **`vendor`** — the slug the site's map is keyed by. A match brings the
  retailer's styling, which Cynth cannot supply.
- **`cta`** — the exact wording, `Shop on Argos`, so a shop the site has never
  heard of is still named on the button.

Display names come from the domain, with a five-entry correction map for the
ones title-casing gets wrong: Best Buy, eBay, AliExpress, B&H Photo, John
Lewis.

### The site derives it too, and that is the half that matters today

New pushes carry the attributes. **Already-published articles cannot**: their
shortcodes were written before the fix, and Cynth deliberately refuses to
rewrite the body of a published post.

So `efd-site.php` now falls back to reading the host of the `url` attribute it
already receives. Every card that is already live starts naming its shop with
no article re-pushed and no content touched — which is the only way to fix
five published posts under a rule that forbids editing them.

### Backfill

21 of 22 products filled at startup. The twenty-second has no affiliate link
at all and correctly stays null.

### Tests

486 pass, 9 new. One existing test was restated rather than deleted: it
asserted that a null vendor produces no attribute, which *was* the defect. It
now asserts the fallback to the link, and keeps the guarantee that matters —
an unidentifiable link still produces nothing.

### Known limitations at completion

1. **`efd-site.php` has not been deployed.** The file is updated in the
   EveryFiveDays working copy; uploading it to Hostinger is a manual step, and
   until it happens the live buttons still read "Check price".
2. **No PHP is installed on this machine**, so the change was verified by
   reading and by brace/paren balance, not by `php -l`.
3. **An unlisted retailer gets the house accent**, not its own styling. That
   needs a row in the site's `VENDORS` map — the wording is right without one.

### Addendum — PHP, and the registry Cynth could not write (2026-09-28)

**PHP 8.3.35 is installed** at `C:\tools\php`, unpacked from the official
Windows zip (SHA-256 verified against `windows.php.net/downloads/releases/sha256sum.txt`).
No installer, no PATH entry, no admin rights; deleting the folder removes it.

It earned its place immediately. `efd-site.php` — already uploaded to
Hostinger — lints clean, and a reflection harness exercised
`EFD_Site::vendor_from_url` against 13 real cases: every Amazon shape in the
library resolves to `amazon`, unlisted retailers resolve to themselves
(`argos`, `chewy`, `zooplus`), and shorteners, affiliate networks, IP
addresses and unparseable strings all resolve to nothing. That is verification
rather than inference, which is what the previous entry had to settle for.

### The registry had no way to be written from Cynth

The site's product registry wins over a placement for the affiliate URL and
the image — deliberately, so a changed link is fixable in one place. But the
only thing that could FILL it was `export-products.php`, which reads a
WordPress install. Nothing created entries from Cynth, where products are
actually maintained. So 11 of 22 products had no entry, and their cards
published with no picture — visible on the ergonomics article, whose card
renders with no `<img>` at all.

`npm run export:registry` writes `products/registry.json` and stages the image
files. Two decisions in it are worth keeping:

**It sends only what Cynth knows.** The importer writes every meta key it is
handed, so an empty value would blank the live entry. `efd_image_url` and
`efd_image_id` are set by the importer for the install it imports INTO, and
sending them empty would have erased the picture from every product already on
the site. Empty values are omitted entirely.

**Its dry run only reports what it would actually change.** Comparing whole
meta objects called all twelve existing products "changed" the moment the
exporter stopped emitting an image URL — a difference in the file that writes
nothing to the site. A dry run that cries wolf is a dry run nobody reads.

Result: 13 new entries, 9 genuinely changed (all `efd_summary`, the registry's
fallback wording, which a placement's own summary overrides anyway).

### Two latent faults found on the way

`import-product-images.php` still pointed at
`C:/Users/MetaWaste/Desktop/CLAUDE/CYNTH/database/` — the path from before
OneDrive's Known Folder Move. It would have reported "no images" rather than
failing, so the staleness was invisible. Corrected to `C:/CYNTH/database/`.

`deploy.mjs` resolved manifest images only against the local WordPress uploads
folder, which is the wrong place for images that come from Cynth. It now
prefers `products/media` beside the manifest, so a repo-only export never has
to write into a running install.

### Not done

**Nothing has been pushed.** The manifest and 25 staged images are written;
`node scripts/deploy.mjs products` (dry run) then `--apply` is the step that
touches the live site, and that is the editor's call.

## Milestone 44 — Never Say It Twice (Complete, 2026-10-27)

### The request

Two things, from the editor: as more articles are written, none should repeat
any part of one that already exists; and each thematic area should widen its
scope without straying from its core ideas. On the first, the editor asked
that an article is **never written** once it crosses a similarity threshold
with what exists, and that Cynth hold a graph memory of the whole catalogue.
On the second, a subtopic outside an area's scope is proposed, and a person
approves it before anything is written.

### What was wrong

Topic research saw titles. A title says what an article is called, not what
it says, so a fresh subject could still re-explain existing sections — and
did. Caffeine timing is explained in three articles across two areas. The
budget-workspace article repeats the wrist, chair and screen-height articles.
Nothing after topic research saw the catalogue at all.

Scope was prose. Each brief lists what is in scope; nothing counted which of
those subjects had ever been written about.

### The graph (coverage-graph/)

`coverage_articles`, `coverage_points`, `coverage_point_links`,
`coverage_subtopics`, `coverage_article_subtopics`. Every article is cut into
points at its headings (each FAQ question separately; stubs under 40 words
fold into the previous point), each embedded with the model recorded beside
it. Points across articles at ≥0.70 are linked. Each article's primary
subtopic is the one its title and introduction sit closest to; a subtopic is
touched by any section that sits closest to it at ≥0.42.

The graph syncs at the start of every topic research. Only articles whose
title or text hash changed are embedded, so with nothing new it makes no call.

### The gates

| Stage | Compares | Stops |
|---|---|---|
| topic_screen | each proposed topic (topic + angle) against every article's title + introduction | drops ≥0.65; holds a topic in an unapproved subtopic; stops the run when nothing survives |
| section_screen | each planned section (heading + "covers") against every point; the chosen topic again | cuts ≥0.62; stops when >40% is cut, or the topic is a duplicate |
| draft_screen | each drafted section against every point | ≥0.76 becomes a major review issue; final validation blocks if it survives |

Thresholds are settings (`coverage.*`), editable on the Coverage page.

Each gate's output records what it judged (`basedOn`), and is recomputed when
that changes. Topic decisions index into the SCREENED shortlist, and the
keyword rerun reads it too. A screen that let nothing through is an empty
shortlist, never a fallback to the unscreened research.

### How the thresholds were set

`scripts/coverage-calibrate.ts` embeds the live catalogue and scores
everything against everything; `scripts/coverage-probe.ts` scores hand-written
probes. Reworded duplicates of six existing articles scored 0.67–0.80 on the
topic comparison (each matched the right article); new in-scope topics
0.42–0.50; close neighbours 0.59–0.62. Planned sections with a "covers" line:
duplicates 0.63–0.84, new 0.38–0.58. Headings alone peaked at 0.70 against
their own duplicates, which is why keyword research now writes a "covers"
line per section.

### Scope

`coverageScope.ts` writes out each area's core idea, its brief's core
subtopics, and an adjacent ring (e.g. Fitness Technology's "measured versus
derived" admits smart scales and blood-pressure cuffs). Topic research must
name the subtopic each topic serves, or `NEW: <name>` with the part of the core
idea it serves. A new one is held and appears on the Coverage page. Approved
subtopics join the ring; rejected ones are listed to topic research as never
to be proposed.

### Known limitations

- A topic the editor sets in exact mode is never held for scope (it is the
  editor's own decision), but is still stopped if it duplicates an article.
- Graph indexing cost is per catalogue, not per article, so it is not in any
  pipeline's cost breakdown. It is recorded on `coverage_articles`.
- The draft gate compares sections, not sentences. A single repeated paragraph
  inside an otherwise new section can score under the threshold.
- The test article "7 Best Budget Hiking Backpacks" (no area) is indexed and
  listed to topic research as unassigned context.
