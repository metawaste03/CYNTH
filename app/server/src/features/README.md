# features

Backend feature modules, mirroring the frontend's feature folders.

- `authors/` — full CRUD for author profiles and their writing samples (Milestone 3).
- `products/` — full CRUD for products, including local image uploads (Milestone 4).
- `article-types/` — read-only listing of the seeded article types (Milestone 5A). No create/edit/delete — that data is seeded reference data, not user-editable here.
- `dashboard/` — read-only aggregate counts (authors, products, articles) for the Dashboard (Milestone 5A).
- `articles/` — draft persistence for the full Content Brief workflow: article type, author, product, topic, working title, keywords, and content brief fields (Milestone 6, extending the minimal version from 5B). Create, update (full-replace), fetch a draft by id, and (Milestone 7) `GET /:id/prompt` to retrieve its assembled prompt. Still no article content/body editing, no list/delete endpoints, no AI, no publishing.
- `prompt-builder/` — assembles the complete prompt text (article + author + optional product + content brief + instructions) from a draft already in the database, with the required-field validation described in Milestone 7. Pure text assembly — calls no AI model, sends nothing externally.
- `ai-providers/` — full CRUD for AI provider configuration and their models (Milestone 8). API keys are never stored in SQLite or returned by the API — see `shared/secrets/providerSecrets.ts`. Only one default provider system-wide, and one default model per built-in purpose (enforced in the repository, same unset-others-then-set pattern as `product_images.is_primary`). `test-connection` returns a fixed placeholder message and calls nothing external.
- `model-router/` — given a task type, returns which provider/model is configured to handle it. Pure lookup — never contacts a provider, never returns an API key value.
- `generation/` — the AI generation engine (Milestone 9): draft → Prompt Builder → Model Router → provider adapter → configured model → normalized response → saved back to the draft, with one `generation_history` row per attempt. `providers/` holds one adapter per provider type (OpenRouter, Anthropic, OpenAI), all behind the single `ProviderAdapter` interface in `generation.types.ts`, so adding a provider means adding one file and one registry entry. Adapters are the only code that knows a vendor's API shape, and the only code that ever sees a key. The task type is a parameter throughout, so future tasks (title generation, SEO review, quality review) route through the same path. Generation never changes an article's status — drafts stay unpublished until a human approves them. Endpoints live on `articles/` (`GET /:id/generation`, `POST /:id/generate`, `GET /:id/generation-history`), mirroring how Milestone 7 put `GET /:id/prompt` there.

`seo-review/` and `quality-gate/` are still reserved and empty — no routes, no business logic.
