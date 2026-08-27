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

### Milestone 13: model discovery, the registry, and model selection

- **No hardcoded model list, anywhere.** Cynth contains no array of model names. Models come from a live read of the provider's own catalogue (`GET /api/ai-providers/:id/catalog`), which for OpenRouter currently returns over 400 models. A baked-in list would be wrong within weeks.
- **Discover → inspect → add.** The AI Provider screen browses the live catalogue with free/paid/unpriced filters and a search, shows each model's id, vendor, context length, input and output pricing, capability metadata and availability, and saves a chosen model to the registry. Adding a model is never a code change.
- **Free/paid is decided by price, never by name.** `classifyModel()` reads only the pricing metadata. It never looks at the model id — which matters, because OpenRouter lists ids ending in `:free` *and* lists paid models with "free" in their names, and it lists genuinely-free models with no such marker at all. A model is free only when its input and output prices are both known and both zero, and any flat per-request charge is zero too.
- **Unknown is not free.** A price the provider does not publish stays NULL and classifies as `unknown`, which the cost layer treats as paid. Negative prices — OpenRouter's sentinel for "depends where this routes to", used by five models in the live catalogue — are normalised to unknown rather than taken literally, which would otherwise have produced a negative estimated cost.
- **The registry is provider-independent.** `Provider → Model Registry → Generation`. Registry entries store provider, model id, display name, pricing, capability metadata and active state, keyed by the Cynth provider record that reaches them. The existing Anthropic and OpenAI adapters are unaffected; OpenRouter is simply the first provider that publishes a catalogue Cynth can read.
- **Refreshable metadata.** Re-reading a catalogue updates pricing, context length, vendor, capabilities and availability on every registered model, while leaving the user's own configuration — display name, purpose, enabled state, default-for-purpose — untouched. A model that vanishes from a catalogue keeps its last known pricing and is flagged as no longer listed; blanking it would turn "we no longer know what this costs" into "this is free".
- **The model is selectable per generation.** The New Article workflow offers a model picker grouped by cost class, showing provider and per-million-token pricing on every option. The picker names a registry entry only — the Model Router still resolves which provider serves it, so the browser never selects an endpoint or touches a credential.
- **A selected model is the model that runs.** There is no code path that substitutes a different model: not the purpose default, not a cheaper one, not a working one. A selection that cannot run is an error. Selecting a paid model does not bypass the spend gate, and a free model that fails never becomes a paid one.

## Future Expansion

Cost *policy* remains deliberately light. Cynth is cost-**aware**, not a billing system: it shows what a generation is expected to cost from the provider's published prices, refuses paid generation outright in Test mode, and requires an explicit per-request confirmation in Production mode. Reported token usage is recorded per generation, which is the raw material any future spend view would need, but no budgeting or quota system exists or is planned in the current scope.

## TODO

- ~~TODO: Decide whether Cynth targets a single AI provider or a pluggable multi-provider design.~~ **Resolved (Milestones 8–9):** pluggable multi-provider, as described above.
- TODO: Reconcile "local-first" with the reality that most capable models are hosted/remote — decide what "local-first" means in this context (e.g. local data storage vs. local inference). *The implementation currently keeps all data local and sends only the assembled prompt to a remote model, but this has not been confirmed as the intended principle.*
- TODO: Define cost/rate-limit handling expectations beyond awareness. *Rate limits surface as a distinct, retryable error; reported token usage is recorded per generation; estimated cost is shown before every paid generation and requires explicit confirmation. No budgets or quotas are defined, and none are currently in scope.*
- ~~TODO: Define fallback behavior if a provider is unavailable.~~ **Resolved (Milestone 9):** no automatic fallback and no automatic retry. The failure is reported clearly and the user decides whether to retry or reconfigure.
