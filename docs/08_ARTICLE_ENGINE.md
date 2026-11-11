# Article Engine

## Purpose

This document defines the intent behind Cynth's core article engine — the component responsible for assisting in the drafting of articles, as the central function described in the project's purpose statement.

## Scope

This document covers the conceptual responsibilities of the article engine. It does not define the prompts used to drive generation (see the `prompts/article_generation/` directory), nor the underlying model provider integration (see [09_MODEL_PROVIDERS.md](09_MODEL_PROVIDERS.md)).

## Responsibilities

The Article Engine, once implemented, is expected to:

- Assist a human editor in drafting articles, consistent with the Editorial Constitution ([01_EDITORIAL_CONSTITUTION.md](01_EDITORIAL_CONSTITUTION.md)).
- Respect the selected author's identity, as provided by the Author System ([07_AUTHOR_SYSTEM.md](07_AUTHOR_SYSTEM.md)).
- Account for article type conventions, corresponding to the `data/article_types/` directory.
- Hand off drafts to the SEO Engine ([10_SEO_ENGINE.md](10_SEO_ENGINE.md)) and Quality Gate ([11_QUALITY_GATE.md](11_QUALITY_GATE.md)) before anything is considered publish-ready.
- Never publish autonomously — the human editor retains final decision authority, per [00_PROJECT_VISION.md](00_PROJECT_VISION.md).

## Current Status

**First drafting pass implemented.** As of Milestone 9 the article engine can produce a draft end to end. See [13_MILESTONES.md](13_MILESTONES.md) for the full record, including known limitations.

The drafting workflow as built:

1. The eight-step New Article wizard collects the article type, author, topic, working title, keywords, optional product, and content brief, saving to the database at every step (Milestones 5B and 6).
2. The Prompt Builder assembles one complete prompt from that saved draft — article details, the author's full voice profile and writing samples, the author's skill document and any shared editorial guidance where present (Milestone 16), the product's editorial notes where applicable, the content brief, and a fixed instruction block (Milestone 7). It is the single source of truth for the prompt; nothing else assembles one. Sections whose configuration is absent are omitted rather than filled in, so an author with no skill document produces a prompt identical to the one they would have produced before skills existed.
3. The Model Router resolves which configured provider and model handle Article Generation (Milestone 8).
4. The generation engine sends the prompt through that provider's adapter and normalizes the response (Milestone 9).
5. The generated title and body are saved against the draft — never overwriting the editor's working title — and every attempt is recorded in generation history.
6. Where the author placed a product, that placement is read back out of the generated draft and recorded, including the products they judged did not belong (Milestone 17). Cynth renders the product card from its own records at push time; the model writes only the marker saying where one goes, never the link, the image or the price.

Article type conventions live in the seeded `article_types` table rather than `data/article_types/`, which remains empty; that directory was superseded once a database existed. `prompts/article_generation/` likewise remains empty: the prompt is assembled in code by the Prompt Builder from database records, not loaded from prompt files.

The engine does **not** yet hand off to the SEO Engine or Quality Gate — both remain unbuilt — and it cannot publish anything. A generated article stays a draft, labelled as AI-generated, until a human editor approves it.

## Future Expansion

The remaining stages named in this document's Responsibilities — SEO handoff and Quality Gate handoff — are still to be built, along with revision/iteration handling. The generation engine was built with those in mind: task type is a parameter throughout, so title generation, keyword expansion, SEO review, and quality review can each use their own configured model through the same Model Router without reworking the engine.

## TODO

- ~~TODO: Define the actual drafting workflow (inputs required, stages, outputs) once scope is set.~~ **Resolved (Milestones 6–9):** the five stages recorded above.
- ~~TODO: Define what "article types" exist for EveryFiveDays (currently unknown; `data/article_types/` is empty).~~ **Resolved (Milestone 2):** ten types seeded into `article_types` — Product Review, Educational Article, Buying Guide, Comparison, Roundup, Opinion, Beginner Guide, FAQ, Case Study, How-To.
- TODO: Define how the article engine hands off to keyword generation, title generation, SEO review, and rewrite stages. *The routing mechanism exists; what each stage should do is still undefined.*
- TODO: Define revision/iteration handling (how an editor requests changes to a draft). *Currently regeneration replaces the article body; there is no way to request a targeted change.*
