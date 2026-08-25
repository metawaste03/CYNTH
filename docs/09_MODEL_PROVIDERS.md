# Model Providers

## Purpose

This document defines the intent behind how Cynth connects to AI model providers to power generation, review, and analysis tasks across the engine.

## Scope

This document covers the conceptual approach to model provider integration. It does not select a specific provider, API, or SDK, and does not define prompt content (see the `prompts/` directory).

## Responsibilities

The model provider layer, once implemented, is expected to:

- Provide the underlying AI capability consumed by the Article Engine ([08_ARTICLE_ENGINE.md](08_ARTICLE_ENGINE.md)), Quality Gate ([11_QUALITY_GATE.md](11_QUALITY_GATE.md)), and SEO Engine ([10_SEO_ENGINE.md](10_SEO_ENGINE.md)).
- Remain consistent with the local-first principle from [00_PROJECT_VISION.md](00_PROJECT_VISION.md) to the extent that principle applies to model access.
- Be swappable/pluggable rather than hard-coded to a single vendor, if that is confirmed as a requirement.

## Current Status

**Implemented.** Milestone 8 built provider and model configuration plus the Model Router; Milestone 9 built the generation engine that actually calls a configured model. See [13_MILESTONES.md](13_MILESTONES.md) for the full record.

As built:

- **Pluggable multi-provider, not single-vendor.** Every provider sits behind one internal `ProviderAdapter` interface. Adapters exist for OpenRouter, Anthropic, and OpenAI; adding another means adding one adapter file and one registry entry, with no change to the generation engine, the routes, or the UI.
- **Which model runs a task is configuration, not code.** The Model Router resolves a task type (currently `article_generation`, with `title_generation`, `keyword_expansion`, `seo_review`, and `quality_review` reserved) to the provider/model configured as default for it. Nothing hard-codes a vendor, and the frontend cannot select one.
- **Keys never enter SQLite.** The database stores only the *name* of the environment variable holding a key; the value lives in a local, gitignored `.env.local` file. Exactly one server-side function returns a key value, so an adapter can authenticate its own request — it is never reachable from an API response, a log, or the database.
- **No provider SDKs.** The adapters use the runtime's built-in HTTP client, so integrating a provider adds no dependency.
- **Failure is surfaced, never worked around.** Cynth makes one attempt per request and never retries or silently falls back to another provider. Authentication failures, unknown models, rate limits, provider errors, timeouts, and network failures each surface as a distinct, plain-language error, and retrying is always the user's explicit decision.
- **Local-first, in practice, means local data.** Editorial data, drafts, and generation history stay on the operator's machine; inference is remote. This is what the implementation does — see the TODO below, which remains open as a matter of stated principle rather than of code.

## Future Expansion

Cost and rate-limit *policy* remains undefined (see TODO). Token usage is captured in generation history when a provider reports it, which is the raw material any future cost view would need, but no billing, budgeting, or quota system exists or is planned in the current scope.

## TODO

- ~~TODO: Decide whether Cynth targets a single AI provider or a pluggable multi-provider design.~~ **Resolved (Milestones 8–9):** pluggable multi-provider, as described above.
- TODO: Reconcile "local-first" with the reality that most capable models are hosted/remote — decide what "local-first" means in this context (e.g. local data storage vs. local inference). *The implementation currently keeps all data local and sends only the assembled prompt to a remote model, but this has not been confirmed as the intended principle.*
- TODO: Define cost/rate-limit handling expectations. *Rate limits currently surface as a distinct, retryable error, and reported token usage is recorded per generation — but no cost expectations, budgets, or quotas have been defined.*
- ~~TODO: Define fallback behavior if a provider is unavailable.~~ **Resolved (Milestone 9):** no automatic fallback and no automatic retry. The failure is reported clearly and the user decides whether to retry or reconfigure.
