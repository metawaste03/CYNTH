# SEO Engine

## Purpose

This document defines Cynth's SEO engine — the intelligence layer that sits between article generation and CMS submission, as introduced in [00_PROJECT_VISION.md](00_PROJECT_VISION.md).

```text
Editorial Configuration
        ↓
Article Generation
        ↓
SEO Engine
        ↓
SEO Review / Optimization
        ↓
CYNTH Draft
        ↓
WordPress Draft
```

## Scope

This document covers what the SEO engine does, how it decides, and the boundaries it will not cross. It does not contain prompt text (see `app/server/src/features/seo/seoPrompt.service.ts`) or scoring constants (see `seo.constants.ts`).

## Responsibilities

### SEO is part of the article lifecycle

The engine operates on an Article and reads the editorial context that article was built from: Project, Theme, Topic, Author, Author Persona, Article Type, and the content itself. It does not treat an article as a generic block of text, and the same context that reached the writing model reaches the reviewing model — "does this article do its job" is unanswerable without knowing what its job was.

### SEO configuration

Each article carries an SEO configuration, entirely user-owned: target search query, search intent, secondary intents (for hybrid), supporting queries, concepts to cover, target audience, geographic target, objectives and notes. Every field is optional. **A target query is not required** — a topic-oriented article with no exact-match keyword is a normal article, and the engine analyses it semantically.

### Deterministic and AI-assisted analysis are separate

| | Deterministic | AI-assisted |
|---|---|---|
| Decides | facts | judgements |
| Examples | missing title, missing meta description, heading hierarchy, slug format, duplicate metadata, missing alt text, term counts | search intent alignment, topical completeness, content usefulness, missing concepts, authority opportunities |
| Cost | free, always runs first | costs money, runs only when asked |
| Confidence | always 1 | the model's own, and the score weights by it |

The line is drawn on reliability, not difficulty: a model asked whether two slugs are identical will sometimes be wrong about it.

### Findings

Every finding is structured, never prose: a stable code, a category, a scoring dimension, a severity (`blocking` / `warning` / `recommendation` / `info`), an origin (`deterministic` / `ai`), a summary, an explanation, a recommendation, the element it applies to, a **passage-level locator** (heading path, paragraph index, character offsets, a verbatim excerpt) and a confidence.

A quote the model produces is **verified against the article** before it is shown. An excerpt that does not occur in the text is dropped and the finding says so.

### The score

0–100, weighted across nine dimensions: search intent (15), content relevance (12), topical coverage (15), on-page (15), structure (12), readability (10), internal linking (8), external authority (5), technical metadata (8).

Four rules keep it honest:

1. **Nothing is scored that was not examined.** A dimension only a model can judge, in an analysis where no model ran, is reported as *not evaluated* and excluded from the average. Coverage states what fraction of the weighting was actually assessed. A diagnostic alone does not count as an assessment.
2. **`info` findings cost nothing.** Keyword density above all.
3. **AI penalties are weighted by confidence.**
4. **The score is SEO readiness, not article quality.** The two are deliberately separate judgements and Cynth keeps them apart.

### Keywords are diagnostics

Term occurrences and density are reported so they can be read, never so they can be hit. There is no target density anywhere in Cynth and no finding rewards one. The only density rule that affects the score fires on **overuse**. The engine distinguishes a missing important *concept* from a missing exact *keyword*, and reports the first.

### Recommendation → Proposed Change → Approved Change

Three distinct records:

- **Recommendation** — what Cynth thinks should change.
- **Proposed change** — concrete text it suggests. May be absent; advice without a replacement is still advice.
- **Approved change** — what a human accepted. Approving an SEO *metadata* proposal writes it into the field. Approving advice about the article *body* records the decision and changes no prose: **Cynth does not rewrite articles.**

### The SEO gate

```text
CYNTH Draft → SEO Analysis → SEO Findings → User Review → SEO Ready → WordPress Draft
```

Configurable criteria, evaluated on the single path out of Cynth. A perfect score is never required and no minimum score is set by default; blocking findings are what stop a push, and a reviewed-and-dismissed finding stops counting. Every criterion reports its own verdict and reason, so "not ready" is always actionable. The gate can be switched off entirely, in which case it is still evaluated and shown but never blocks.

### CMS-independent SEO metadata

```text
CYNTH SEO Metadata → CMS SEO Adapter → WordPress SEO Plugin
```

`buildCmsSeoMetadata()` assembles what a CMS receives, from human-owned values only — a proposal nobody accepted is not metadata. `SeoFieldMapping` describes how one CMS/plugin combination expects it. **No mapping is registered**, because EveryFiveDays' SEO stack has not been chosen and writing post-meta keys for a plugin that may not be installed would create orphaned data.

### Web intelligence foundation

```text
Web Source → Retrieved Content → Extracted Finding → Knowledge / SEO Intelligence → Generation Context
```

**DEFERRED TO PHASE 2 (verified, Milestone 15).** Architecture only.
`retrievers/index.ts` is an **empty registry**, so no code in Cynth can fetch a
web page.

Milestone 15 tested this rather than assuming it, because a UI that exists is
not a feature that works. What was checked, and what it returned:

| Check | Result |
|---|---|
| `hasAnyRetriever()` | `false` |
| `listRetrievers()` | `[]` |
| `getRetriever(type)` for every plausible type | `null` |
| Any route that fetches a URL | none exists |
| `web_retrievals` rows ever written | 0 |
| `web_findings` rows ever written | 0 |

The controlled real-world crawl the milestone called for could not be
performed, because there is no code path to perform it with: a source can be
authorised (step 1), and a crawl cannot be initiated (step 2). The Web Sources
panel is labelled **Deferred to Phase 2** and states this plainly rather than
leaving a reader to infer it from a missing button.

The data model makes provenance structural for whenever a retriever does
arrive: a finding requires a retrieval, a retrieval requires a web source, and
a web source is only ever created by the user with both permissions (crawl,
search) defaulting to off.

`WebResearchService` returns *selected, cited findings* rather than page text — future generation gains a short attributed research section, never a dump of scraped websites.

### Backlink foundation

```text
Potential Backlink → CYNTH Analysis → Recommendation → User Approval → Article Link
```

Architecture and an approval workflow. No discovery engine, and no code path that writes a link into an article. An authority signal without a stated source is refused.

## Current Status

**Implemented (Milestone 14).** The engine is operational: deterministic analysis, AI-assisted analysis through the existing provider/model architecture, structured findings, the explainable score, the gate, internal/external link opportunities, image SEO requirements, structured-data eligibility, SEO metadata persistence, and the SEO view in the Article workflow.

Not implemented, deliberately: any crawler, backlink discovery, automatic link insertion, autonomous rewriting, an article editor, and any SEO-plugin integration.

**Extended in Milestone 18: product placement review.** A `product_placement` category joins the existing SEO categories, and the review runs through the same `seo_review` capability, spend gate and history as the AI SEO pass. It answers, per product, whether the surrounding content actually leads into it — reporting a good placement as good, not only flagging bad ones. It is advice: it writes verdicts and a suggested section into their own columns, and never moves a product, changes a placement, or edits the article. Weak and misplaced verdicts also become ordinary SEO findings, so they reach the findings list, the score and the gate; neither severity blocks, because the author's placement stands unless a human changes it.

## Future Expansion

The architecture is shaped so these are extensions rather than rewrites: an SEO field mapping registering in the empty mapping registry; a backlink discovery engine writing rows the approval workflow already governs; and autonomous editing using the approval record that already exists. (The empty web-retriever registry was filled in Milestone 17 — by a retriever that reads one authorised page, not a crawler.)

## TODO

- TODO: Obtain EveryFiveDays' chosen WordPress SEO plugin, then register one `SeoFieldMapping` for it.
- TODO: Decide whether the default gate criteria should tighten once the site has a body of published work.
- TODO: Define the authority signals a future backlink engine may publish, and where each comes from.
