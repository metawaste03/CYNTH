# Changelog

All notable changes to the Cynth project binder will be recorded in this file.

## [0.32.0] - 2026-09-08

### Added

- **`ai_search` — a new SEO dimension for AI search readiness.** Ported selectively from the Agentic-SEO skill after a gap analysis, not adopted wholesale. It exists as its own dimension because it rewards something classic SEO does not: a passage that survives being extracted from its own page. An article can score well on structure, readability and on-page and still be unquotable because every section leans on the one above it.

  **Four deterministic checks**, all `recommendation` severity because this is a judgement about reach, not correctness, and must never block a push: a section too thin to answer anything (under 60 words); a section so long the answer is buried (over 350); a section that opens by announcing itself rather than answering; a section that opens with a bare demonstrative, which reads fine on the page and points at nothing once quoted. Plus one article-level check: whether the article ever states plainly what its own target query *is*, since answer engines lift "X is ..." sentences almost verbatim.

  Two deliberate narrowings, both tested: the demonstrative rule requires a *bare* one ("This stiffness is..." is self-contained, "This is why..." is not), and the H1 and lead-in are skipped, or the article's own title gets reported as too short to answer anything.

  **Two AI categories**, `citability` and `experience_signals`, scoped so they do not repeat the deterministic checks — length and openings are explicitly excluded from the model's brief. The E-E-A-T rule carries an explicit prohibition: never reward citing sources for their own sake, never ask for credentials the author does not have, and never recommend claiming experience the article does not evidence. An honest "we have not tested this" is a trust signal; an invented one is the opposite.

**Weights rebalanced, not diluted.** The dimension weights sum to 100, so `ai_search` is funded at 6 by the four dimensions whose concerns it overlaps: topical coverage 15→13, on-page 15→13, structure 12→11, readability 10→9. A test asserts the total is still 100 — adding a dimension without funding it silently rescales every score already recorded.

**Verified live**: article 24 scored 88 on the new dimension with two genuine findings (an empty FAQ heading and a section opening with an upward reference).

**Tests**: 7 new, 439 total. One note worth recording — registering these first made an unrelated internal-links test fail, because they create several articles on one subject and link candidates are ranked across the whole database. The block is registered last now, with a comment saying the ordering is load-bearing.

### Assessed, not built

`fetch_page.py` and `parse_html.py` were reviewed against the planned crawling feature. `safe_http.py` beneath them is genuinely good (SSRF protection, response caps, redirect limits) and `parse_html.py` is an excellent extraction checklist — but both are Python/BeautifulSoup, and shelling out would make Python a hard runtime dependency of the Node server. The recommendation recorded in the milestone is to port the logic to TypeScript using them as the specification. **Neither reads robots.txt** — they read `meta robots` and `X-Robots-Tag`, which govern indexing rather than crawling. Cynth already has that half, though: `httpRetriever.ts` (Milestones 17-18) parses robots.txt, caches it per host, honours crawl-delay and treats an unreadable one as a refusal, and it follows redirects with per-hop authorisation, which is stricter than `safe_http.py`. The real remaining gap is narrower — private-IP rejection for user-supplied URLs, and HTML extraction beyond `<title>`.

## [0.31.0] - 2026-09-08

### Fixed

- **Product images appeared nowhere in Cynth, so they looked unused.** They were not: `renderProductCard` has always rendered the uploaded primary image, preferring it over the retailer's CDN. But the card is assembled at **CMS push time**, and the article view rendered the body as a single text node — so `[[product:14]]` showed as literal text and the first place an editor could see a card was the published post. `GET /articles/:id/products` now returns the article's products resolved exactly as the CMS card resolves them, and `ArticleContent.tsx` renders each marker as the card it becomes: image, title, brand, what it is for, features, and the affiliate link with the same `rel="sponsored nofollow noopener"`. A product with no affiliate link renders a stated warning instead of a silently linkless card; a marker whose product is no longer attached renders an explicit orphan notice.

  **The writer still never writes an image, a price or a URL.** It writes a marker and the card is built from stored records — a link the model never sees is a link it cannot alter, which is how the affiliate URL stays verbatim. The preview reads those same fields and writes nothing; `productCard.ts` remains the only thing that generates what WordPress receives.

- **The Quality Gate blocked articles for placing product cards.** `PLACEHOLDER_PATTERN` saw the inner `[product:14]` of a `[[product:14]]` marker, found no following `(`, and reported it as an unfilled placeholder — **blocking**. An article was therefore penalised for placing the products it was asked to place, and the more it placed the worse it scored. A marker is the opposite of an unfilled placeholder: it is a finished instruction the renderer acts on. Markers are now stripped before the scan rather than bolted on as a pattern exception, and a real placeholder sitting beside a card is still caught — with a test for exactly that, because a fix that blinded the check would be worse than the bug. Article 24 went from failed to passed on this check.

**Verified live on article 24**: four cards, all four images decoding at full resolution, three affiliate links byte-identical to the stored `amzn.to` strings, no raw marker text left on the page.

**Tests**: 3 new, 432 total. One asserts the preview's affiliate URL against the stored product row, so any future normalisation of that URL fails the build.

## [0.30.0] - 2026-09-08

### Fixed

- **The author's voice documents were named in the writer's prompt but never included in it.** The prompt read *"The author's full voice documents (Author Persona: Smart Pet Care, Shared Editorial Philosophy) govern tone, structure and vocabulary. Follow them exactly"* — and the model had never been shown either document. `briefStages.service.ts` called `listActiveSkillsForAuthor()`, which returns each document with its body, then kept only `skill.name`. Roughly 7,900 characters of written voice guidance were loaded from the database and discarded on every run. Since `authors.expertise` and `authors.perspective` are NULL for every author, the persona summary was empty too — so the writer received a name and two filenames. That is the whole reason the articles read like generic model output; it was never a tuning or model-quality problem. The manual New Article path was never affected: `promptBuilder.service.ts` has emitted the bodies since Milestone 16, and only the pipeline dropped them.

  `buildVoiceBlock()` now emits the documents verbatim, with the rule that where they conflict with any summary in the prompt the documents win. It reaches three stages: the **writer**, so there is a voice to write in; the **reviewer**, which has always listed "author voice" among the things it assesses and was judging it against a name; and the **reviser**, the one stage allowed to rewrite prose, which without it corrects sentences into its own register and quietly undoes the writer. Costs roughly +$0.028 per article in input tokens.

### Added

- **`topic_mode` — write about exactly this, or explore around it.** A supplied idea was always treated as a *direction*: the researcher was asked to propose distinct topics *within* it, so "the healthiest snacks for cats recovering from a health problem" produced a shortlist of adjacent articles rather than that one. `exact` is a different job rather than a stricter version of the same one — research this subject, return exactly one topic, do not propose alternatives, do not broaden or narrow it. Honest research is preserved deliberately ("being told to write something is not a reason to pretend it is a good idea"), and choosing the angle is still the model's job. The mode is stored on the run, so a resume days later is still faithful to it, and `startNewVersion` carries it forward.

  The UI asks only once there is an idea to be faithful to, and **defaults to exact** — someone who has typed out an idea has already decided what they want written. `exact` with a blank idea falls back to `explore`. An exact run researches one topic instead of two, so the gate figure scales down with it.

**Schema**: one column, `article_pipelines.topic_mode`, via the existing `addMissingColumns` path; existing rows default to `explore`, which is how they already behaved.

**Tests**: 6 new, 429 total. The voice tests assert on the document *text*, and one fails if the prompt ever returns to naming documents it has not supplied.

## [0.29.0] - 2026-09-08

### Fixed

- **An unfinished run could not be reached, so a stopped article looked like a dead draft.** Everything needed to continue one already worked — roles resolve at stage execution time (so a model changed in Settings applies from the next stage), completed stages are idempotent (so continuing never pays twice), `resumeAfterFailure()` reopens a FAILED run in place, and `/generate/:pipelineId` hydrates from the server. But **nothing linked to that URL**: the only navigation to it was the redirect that fired when a run started. Leaving the page — exactly what "go and change the model in Settings" means — stranded the run. Drafts listed the *article* and linked to a read-only viewer; and since title, topic and body are written by the writer stage, an in-progress run showed as "Untitled draft · Not generated yet". A live run holding paid research therefore presented itself as useless, and the only apparent way on was to start again and pay for the same research twice.

  Found in the live database: pipeline 16 had succeeded at topic research on Opus 5, failed keyword research, then **succeeded on the second attempt after the model was changed** — and was sitting at an open `keywords_title` checkpoint with six title candidates and **$0.1257 already spent**, unreachable.

### Added

- **`GET /pipeline/resumable`** — the runs with work left in them, carrying theme, mode, the open question, what continuing would run next, whether it stopped, and what has already been paid for it. Topic and title are read from the run's own stage output rather than the article row, because the article row genuinely has neither yet.
- **`isResumable(state)`**, beside `isTerminal` and deliberately not its inverse. Terminal asks whether anything continues on its own; resumable asks whether a person can still act on it. `FAILED` is both. `READY` is finished, and `NEEDS_EDITORIAL_ATTENTION` waits on a human editor rather than a stage.
- **Unfinished runs on Generate Article**, listed *above* the Start form so the cheaper option is seen before the one that would replace it.
- **Continue on Drafts**, with the run's real title, what it is waiting on and what has been spent. Finished articles are unchanged — still "Open", still opening the article.

**No schema change**; this milestone only reads fields that were already persisted.

**Not included: an article editor.** "I can't edit it" had two readings — continue the unfinished run (fixed) and edit the prose of a finished draft (Cynth has never had this). They are separate pieces of work, and conflating them would have shipped an unrequested text editor while leaving the actual complaint in place.

**Tests**: 3 new, 414 total. One asserts the article row still has no topic while the run does; one covers the three terminal states; one walks the reported case end to end and asserts the topic-research row is *the same row* after resuming, proving paid work is kept rather than repeated.

## [0.28.0] - 2026-09-05

### Changed

Milestone 30 (Cost Tuning). Not a feature — a deliberate reduction in what an article costs, after the first Production run showed the real figures.

- **The topic shortlist halved, 4 candidates to 2.** Topic research runs on the premium model and its cost is almost entirely output tokens, so the number of topics researched *is* the cost of that stage. Two is still a genuine choice, and the editor picks at a checkpoint either way. **$0.1088 -> $0.0588.**
- `TOPIC_CANDIDATES` is now one exported constant driving the prompt AND the assumed output budget together, so the figure the spend gate shows cannot drift away from what the prompt actually asks for — the drift that made the first estimate confusing.
- **Production roles settled**: Opus 5 writes and researches topics; Qwen 3.7 Flash does keywords, titles and classification; gpt-5.6-sol-pro reviews and revises; Nemotron 3 Super is parked on `title_selection`.
- **`title_selection` is assigned but inert** — no stage uses it, because the keyword stage returns keywords and title candidates in one call. Documented rather than left to be discovered.
- `nemotron-3-ultra` was deliberately not chosen: it returned empty responses three times consecutively on the keyword prompt in live testing.

**An article now estimates at $0.1964** ($0.2424 with the one revision), down from $0.2464 ($0.2924). Two Opus stages are 87% of it, both deliberately. Estimates assume each model writes its full output budget; the one measured generation on record cost $0.0376 against a higher estimate.

## [0.27.0] - 2026-09-05

### Fixed

- **The cost confirmation could not be answered.** The pipeline screen asked through `window.confirm`, which never showed the estimate — it said "confirm the estimated cost" and then stated no cost — and which a browser silently suppresses once the user has ticked "prevent this page from creating additional dialogs", leaving the message on screen with nowhere to click. Replaced with an in-page panel naming the stage, the model and the figure (e.g. *Topic Research runs on anthropic/claude-opus-5. Estimated cost for this stage: $0.1079*). The estimate was already computed by the spend gate and thrown away; `GenerationError` now carries it through the route to the browser. The panel also states that one click authorises the paid stages until the run next stops, rather than leaving that to be discovered.
- **Declining to pay ended the run.** A refused cost confirmation was handled as a failed stage, moving the pipeline to the terminal `FAILED` state — so answering "not now" killed the run and the only way on was a new version that pays for everything again. Four dead runs were found in the live database from real attempts, none having spent anything. `isSpendRefusal()` now separates the two: a failed stage is a broken run, while a stage that was never allowed to spend has not run at all — nothing called, nothing charged, pipeline unmoved. Applied in every stage service, including the revision stage, which was ending runs at `NEEDS_EDITORIAL_ATTENTION` for the same reason.
- **A waiting run reported itself as working.** Each stage sets its running state before calling the runner, so a refused gate left the pipeline reading `RESEARCHING` while it waited for an answer. The prior state is now captured and restored on a refusal.

Recovering the affected runs: **Try the failed stage again** reopens them in place and the cost panel now appears properly; they can equally be deleted, since nothing was spent.

**Tests**: 2 new, 410 total.

## [0.26.0] - 2026-09-05

### Summary

Milestone 28 (Product Opportunities). The reverse of the existing product workflow: Cynth reads the article skeleton and proposes the KINDS of product that would suit it, so the editor knows what to search for.

This is the half of the §18 spec that needs no Amazon API. `amazon_matching` still needs `searchItems`; the opportunity half needs only the article.

**Categories, never products**

- It proposes "clumping cat litter", not "Dr Elsey's Ultra Unscented". A model asked for specific products invents plausible ones — wrong model numbers, discontinued lines, prices that were never real — which is the failure Milestone 19 exists to prevent. A category cannot be hallucinated the same way: it describes a need, and the editor supplies the real product. The prompt forbids brands, model numbers, prices and availability, and a test asserts it.

**What a suggestion carries**

- The category, why a reader of THIS article would want it, which section of the article's own template it would serve, two to four click-to-copy search terms, and a priority.
- A section key the template does not have is recorded as **null** rather than coerced to the nearest one. A suggestion with no category is dropped as unusable.
- **An empty list is an explicit, valid answer** — plenty of articles should carry no products, and a model that always finds four is not answering the question.

**It never reaches the writer**

- The suggestions are a brief for the editor. The writer is only ever told about products that actually exist in Cynth; a category in its prompt is an invitation to describe a product nobody owns. A test asserts a suggested category the editor did not buy never appears in the writer's prompt.

**Asked only when someone will read it**

- Runs when the run is guided AND the template has product slots. An automatic run has nobody shopping; a trend analysis has nowhere to put a product. Both skip the stage, shown as `skipped` rather than `pending`.
- Shares the `keyword_research` role rather than adding a seventh, which would make every existing installation report itself unconfigured until the new role was assigned.

**Verified live** on the standing desk mats article against the free development model: four categories, each mapped to a real section key of the buying-guide template, with search terms, and no brand or model named in any of them.

**Supporting changes**

- No schema change. New stage `product_opportunity`, new state `IDENTIFYING_PRODUCTS`, completing at the existing `PRODUCTS_READY`.
- **Tests**: 4 new, 408 total.

## [0.25.0] - 2026-09-05

### Summary

Milestone 27 (The Products Checkpoint). Products can now be chosen for an article the pipeline is writing.

**The gap this closes**

- Everything needed to place a product well already existed — the writer is told what each product is FOR, that omission is a correct outcome, and which sections may carry one; the Milestone 18 review grades placements afterwards. What did not exist was any way to attach a product to a pipeline article: the products panel lived only in the manual wizard, so a pipeline article reached the writer with nothing attached.

**A fourth checkpoint, after the article type**

- Topic → Title and keywords → Article type → **Products** → write → Review. It sits after the type because whether products belong at all is a different question for a buying guide than for a trend analysis, and the panel states the template's real slot count (four for a buying guide, zero for a trend analysis) read from the template rather than typed into the UI.
- The only checkpoint whose options are not a stage's output: they are the product registry as it stands, rebuilt on every read, so a product added in another tab appears without restarting anything.
- The article's thematic area filters the list, as the media library does. Everything filed elsewhere or unfiled stays reachable in a second collapsed list. **Add a product** opens the form in a new tab; **Refresh the list** re-reads the checkpoint.

**Readiness, stated before the choice**

- Each product is marked `ready` (it has "what it is for" or "the problem it solves") or `thin`, with a note saying what is missing. A product Cynth knows nothing about can only be placed decoratively, and the editor should learn that while choosing rather than in the finished draft. The writer now gets the same warning inline.

**The fields the writer reads are now fillable by hand**

- `useCase`, `problemSolved`, `bestFor` and `keyFeatures` were writable only by product research — which needs a retrievable URL, and for Amazon the still-blocked Creators API. **A product added by hand reached the writer as a name and a brand**, enough to mention and not enough to place. They are now on the product form under their own heading. On an edit, an absent field leaves what research wrote alone; an empty string is a deliberate clear.
- The writer's product block also now passes the description, "best for" and editorial fit, so nothing an editor fills in is wasted.

**An exact decision, not an additive one**

- Applying attaches what was chosen and detaches what was not — removing a product means gone, not unticked. Only the link is touched; the product, its research and its images survive. Choosing none is a real answer, recorded rather than refused.

**Supporting changes**

- No schema change: the columns existed, only research could write them.
- **Tests**: 6 new, 404 total, including one asserting the chosen product reaches the writer's prompt with its use case and the "options, not requirements" framing intact.

### Fixed

- **The thematic area's name was derived from a product that matched it**, so an area with no products yet reported no area at all — rendered as "this article has no thematic area", the one thing it was not. It now reads the name from the area itself, and the panel distinguishes "no area" from "no products in this area".

## [0.24.0] - 2026-09-05

### Summary

Milestone 26 (Short-Form By Default). Articles are capped at 1,500 words.

**A band, not a floor**

- Every template stated only a MINIMUM, which gave the writer one direction to push in. `ContentSchema` now carries `maxWords`, and the writer, the reviewer and validation are all given the same band from one function — a writer told 1,500 and a validator checking 2,000 produces an article that is wrong whatever it does. The reviewer needed it too: it had been asking for depth in articles already at their ceiling, spending the one permitted revision on making them longer.

**Version 2 of all eight templates**

- Templates are versioned and never overwritten, so this is a new version, not an edit. v1 keeps the lengths it was published with, and an article that recorded v1 still resolves to the schema it was written to.
- New bands: How-To 800-1400, Ultimate Guide 900-1500, Comparison 850-1400, Product Review 800-1300, Buying Guide 900-1500, Evidence Analysis 850-1400, Listicle 800-1300, Trend Analysis 700-1200. Section minimums scaled down with them, and a test asserts a template's required sections cannot sum past its own ceiling.
- The floors are 700-900 because below roughly that an article cannot cover a subject and satisfy its sections. There is no official minimum length for a blog post and this does not pretend to be one.

**One ceiling, changeable without a deploy**

- `article.maxWords` (default 1,500), at **Settings -> Editorial**. The effective ceiling is the LOWER of it and the template's own, so lowering it shortens everything while raising it above 1,500 changes nothing on its own. Where the house limit is what binds, the validation finding says so.
- An over-length article is **reported, never truncated** — what to cut is an editorial decision.

**Supporting changes**

- No schema change: `maxWords` lives in the existing `content_schema` JSON. A v1 row has none, read as "no ceiling of its own" so the house limit applies rather than leaving it unbounded.
- **API**: `GET`/`PUT /api/generation/article-length`.
- **Tests**: 11 new, 398 total, including one asserting the writer's prompt actually contains the band.

### Fixed

- **A blank length setting capped every article at 400 words.** `getHouseMaxWords` treated only `null` as unset, and `Number('')` is 0, which clamped to the floor. Blank now reads as unset.

## [0.23.1] - 2026-09-05

### Fixed

- **Most image models were invisible to the registry.** OpenRouter's `GET /models` returns 431 models of which only eleven produce images; `GET /models?output_modalities=image` returns 52, and **41 of those are in neither list the adapter read** — Seedream, Recraft, MAI-Image, Muse, Grok Imagine. They could not be found, added or assigned, with no symptom a user could diagnose. `listModels` now reads both and merges by id; a failure on the second read degrades to fewer models rather than to no catalogue. The live catalogue went from 431 entries to 472. (The 0.23.0 note claiming Seedream was reachable was wrong — it came from OpenRouter's documentation example rather than from the catalogue.)
- **An image model could classify as FREE and defeat the spend gate.** `classifyModel` read only the per-token prices. OpenRouter lists Seedream 4.5 at prompt 0, completion 0, **image output $9.58/M tokens** — so a model that charges for every image classified as free, and would have run in Test mode with no cost confirmation. `image_output_price` is now stored on `ai_provider_models`, carried through the router and role registry, and read by `classifyModel`, where any non-zero extra charge makes a model paid. The featured-image path treats a NULL image price as *unknown* rather than free, because a model registered before the column existed has none on record. The catalogue card shows an **Image output** row, so "Paid" beside "Input Free / Output Free" is explained rather than baffling.
- **Featured Image Generation was missing from the screen where models are added.** The server published the capability and the provider detail screen read it, but Model Discovery derived its checkbox list from the client-side `PURPOSE_LABELS` fallback map. It now reads the server's list, as that map's own comment always claimed it did.

## [0.23.0] - 2026-09-04

### Summary

Milestone 25 (Featured Image Generation). Cynth can draw a featured image from the article, and the panel offers what it already owns before it offers to spend anything.

**No new provider account was needed**

- OpenRouter publishes a dedicated image endpoint — `POST /api/v1/images` with `model`, `prompt`, `n`, `aspect_ratio`, `output_format`, returning base64 images and a reported cost — and eleven image-output models. The existing OpenRouter provider record reaches all of them.
- `generateImages` is an **optional** adapter method. A provider without it cannot be asked for an image, and the caller is told so rather than silently routed elsewhere.

**Cost is reported, never estimated**

- Image models are priced per image, so there is no honest up-front estimate. The spend gate still runs: an image model is never free, so **Test mode refuses outright** and Production requires a confirmation that is never defaulted to true. The confirmation says what it knows — charged per image, exact figure unknown until the provider answers.
- The recorded figure is the provider's own `usage.cost`, tagged `costBasis: 'provider_reported'`. An unreported cost is recorded as `unreported` and stays null — unknown, not zero.

**What Cynth will not draw, and why**

- Three constraints live in the prompt builder rather than the UI, so no caller can bypass them: no real products, brands, logos or packaging; no recognisable real people; no text, lettering or numbers.
- The product rule is the important one. EveryFiveDays recommends real things people can buy, and a photorealistic drawing of a backpack that does not exist, with an invented logo, on a page that earns commission, is a misleading picture of a product rather than a stylistic choice. Featured images are conceptual; real products are photographed.
- Text is excluded because image models still garble lettering. A title over the image belongs in the page template, as real selectable text.
- The prompt is readable before paying for it (`GET /featured-image/:id/prompt`, free). An article with neither title nor topic is refused rather than handed to a model with an empty brief.

**A candidate is not a library image**

- Candidates wait in a pending folder; only the chosen one becomes a media asset, so rejecting all four leaves nothing behind in a hand-curated library. A new batch replaces the previous one.
- The chosen image is filed under the article's thematic area and marked `credit: AI-generated`, so it stays identifiable as machine-made.
- The candidate id is a filename Cynth generated and is still validated against a strict character set and the owning article — a path separator there would write outside the uploads folder.

**Supporting changes**

- **No schema change.** A chosen image is an ordinary `media_assets` row; the per-image charge lives in `generation_history.payload`, because the token columns cannot hold a charge that is not a token charge.
- New `image_generation` capability in `MODEL_PURPOSES`, assignable like any other.
- **API**: `/api/featured-image/:articleId` (GET), `/prompt` (GET), `/generate` (POST), `/select` (POST), `/candidates` (DELETE).
- **Tests**: 14 new, 381 total, all passing. No real provider contacted, no real image model paid.

## [0.22.0] - 2026-09-04

### Summary

Milestone 24 (Guided Generation). "Generate Article" can now stop and ask. The editor chooses the topic, the title, the keywords and the article type from options the pipeline actually produced, and decides whether to spend the one revision.

**A checkpoint is a persisted pause**

- A row, not a wizard step held in a component, so a guided run survives a closed tab or a restart. The URL carries the pipeline id (`/generate/:pipelineId`), so a paused run is resumable by opening it.
- The **options are not stored** — they already live in the stage run the checkpoint sits behind. A second copy could drift from the first.
- Four checkpoints, each **after** the stage that produced what is being decided: topic, title & keywords, article type, review. Research first, decide second.

**Topic research now returns a shortlist**

- The prompt asks for four genuinely distinct topics, ranked, with the one it would produce first named. The output is flattened so the recommendation is also readable at the top level — which is what leaves the automatic path and every downstream stage unchanged.
- A single-topic reply is read as a shortlist of one (a legitimate answer), but a topic missing a required field still fails the stage. A `recommended_index` outside the list is corrected rather than trusted.
- The assumed completion tokens rose 1,800 → 4,200, because under-assuming would understate the figure the spend gate asks the user to confirm.

**What an answer can and cannot do**

- Choose, override with your own, or accept the recommendation in one click — recorded as `accepted`, not as a choice.
- "Stop asking — finish it for me" switches to automatic and settles outstanding decisions as `automatic`, never `accepted`: the history must not claim a person approved something they only stopped objecting to.
- A decision cannot invent an option. Validation is strict and happens at decision time, while the person is still looking at the screen.
- An answered checkpoint is never re-answered — stages behind it may already have run on the first answer. Changing your mind is a new version.

**A custom topic is never presented as researched**

- The researched fields that cannot honestly carry over — sources, competing coverage, timing, the content gap — are cleared, and the research summary says plainly where the topic came from. Keyword research reads that summary, so the next model is told the truth too.

**Asking for different options costs money, and says so**

- A real second execution of a paid stage, through the ordinary stage runner, so it passes the same spend gate. Available only for model-produced options, and only while the checkpoint is open.
- The previous attempt is not deleted: money spent on options nobody chose was still spent.

**The cap is untouched**

- `MAX_AUTOMATIC_REVISIONS = 1` constrains revisions Cynth performs by itself. A person may decline the revision the reviewer asked for, or request the one it did not — neither path reaches a second.

**Supporting changes**

- **Schema**: `pipeline_checkpoints`; `article_pipelines.run_mode` defaulting to `automatic`, so no existing run changes character because the column arrived.
- **API**: `POST /api/pipeline/:id/checkpoints/:kind/decide`, `.../rerun`, `POST /api/pipeline/:id/run-mode`; `POST /api/pipeline` accepts `runMode`.
- Answering does not advance the run — the next stage costs money, and choosing a title is not agreeing to pay for the article.
- **Tests**: 18 new.

### Fixed

- **The review cap fired on a review that had already happened.** `canReview()` was checked before the idempotency gate, so re-entering `runArticleReview` — a resumed run, a refreshed page, a guided run continuing after a decision — turned a stored result into `generation_in_progress`. The gate now comes first: returning the review that already happened is not a second review. The revision stage was deliberately **not** given the same shortcut; asking for a second revision is refused outright rather than quietly answered with the first one.
- **Stage output was read from the earliest successful attempt rather than the latest.** Harmless until a checkpoint could re-run a stage; after a rerun it would have shown the editor one set of options while the pipeline consumed another.
- **A transient stage failure ended the run permanently, and the only way on was to pay for everything again.** A stage failure sets `FAILED`, which is terminal, so the only route forward was a new version — which re-runs every stage from the beginning. A free model returning an empty response therefore cost the topic research that had already succeeded, and the decision already made about it. `POST /api/pipeline/:id/retry` now reopens a failed run in place: it moves the state back to where the last successful stage left it and runs nothing. There is still no retry loop; completed stages are idempotent, so continuing re-runs only what actually failed.
- **The new panels were unreadable in dark mode.** The checkpoint and featured-image styles referenced `--surface`, `--border` and `--accent`, which this app does not define (it uses `--color-*`), so every one fell through to a hardcoded light-theme fallback — white cards under near-white text. They now use the real tokens, and `--color-warning` / `--color-warning-soft` were added to `tokens.css` in both the light and dark blocks.
- A literal NUL byte in `migrations.ts` (a composite map key written as a raw control character) replaced with its escape sequence. Identical behaviour; the file is no longer treated as binary by `grep`.

## [0.21.0] - 2026-09-03

### Summary

Milestone 23 (Media Library, The Orchestrator & Draft Deletion).

**The media library**

- Images for articles, as distinct from product images. Upload, describe, file under a thematic area, attach. In the main menu beside Thematic Areas and Authors, and on the Dashboard.
- **Matching is deterministic and explained.** Cynth does not look at pixels. The thematic area does most of the work; the rest is term overlap between what the editor wrote about the image and what the article is about. Every suggestion carries its reasons. Unfiled images are included rather than hidden.
- `/suggest` proposes and explains; attaching stays a separate, deliberate act.

**The orchestrator**

- `pipeline.orchestrator.ts` — the conductor that was missing. The stages existed but nothing ran them in order, and the wizard still asked a person to type what the pipeline was built to produce.
- `startArticlePipeline()` creates a near-empty draft; `advancePipeline()` calls every stage unconditionally and relies on stage-level idempotency, so it is safe to call repeatedly, safe after a restart, and free for work already done.
- The new Generate Article screen asks for a thematic area and, optionally, a steer. Nothing else.

**Deleting a draft**

- Irreversible with no undo, so the flow is: ask what would happen, show it, then destroy. A preflight names what goes and what survives.
- **Survives**: products, images and authors (shared), and the generation history including what each attempt cost — detached rather than deleted, so the record of what was spent is not erased along with the thing it was spent on.
- **One blocker, overridable rather than absolute.** An article pushed to a CMS refuses by default: Cynth cannot delete a remote post, so deleting here removes only the link, the post stays published, and a later push would create a duplicate. The override reads "Delete anyway, and break the CMS link", and `force` is never sent by default.

## [0.20.0] - 2026-09-03

### Summary

Milestone 22 (Generation, Review, One Revision, Validation).

- **Write → review → at most one revision → deterministic validation.** The reviewer is an independent critic that does not rewrite: it produces a structured assessment and a precise specification of changes. "Improve this section" is not a specification.
- `revision_required` is trusted **only when there is something to act on** — a reviewer that asks for a revision and specifies nothing would spend the one revision on nothing. An issue with no stated change is dropped, because it is not executable.
- **Validation replaces the second review.** Deterministic checks: required sections present and non-empty, minimum length, FAQ and sources where the template requires them, primary keyword actually used. No model is asked. This is what makes the one-revision cap safe — the last word belongs to code.
- Both representations are persisted: `structured_content` for validation and WordPress, rendered markdown for everything that already read `content`. Neither is derived from the other at read time.

## [0.19.0] - 2026-09-03

### Summary

Milestone 21 (Article Templates & The Research Stages).

- **Templates are two-layer and versioned.** A content schema says what an article must contain; a presentation schema says how EveryFiveDays lays it out. A published version is never overwritten — an article written to v1 still means what it meant. Eight seeded on startup; a type with no template of its own borrows a neighbour, recorded as `borrowed: true` rather than hidden.
- **Topic research → keyword & title research → classification**, each returning structured, persisted, validated data. Topic research is not discarded once the article exists: it is the record of why the article was worth producing.
- Three editorial rules live in the prompts: judge the opportunity honestly, do not invent statistics or keyword volumes, and only list a source you can actually name — an empty source list beats a fabricated URL.
- **The classifier cannot invent a type.** One outside the registered list fails the stage rather than being coerced. A human override is recorded as an override, so "the model said X, the editor chose Y" stays visible.
- Template selection and brief assembly make **no model call**, and tests assert it.

## [0.18.0] - 2026-09-03

### Summary

Milestone 20 (The Editorial Pipeline Spine). The multi-model editorial pipeline as a controlled state machine rather than an agent loop.

**The two numbers that make it controlled**

- `MAX_AUTOMATIC_REVISIONS = 1` and `MAX_AUTOMATIC_REVIEWS = 1`, enforced in backend code against counters on the pipeline row — not in a prompt, and not by a caller remembering to check. No path reaches a second revision or a second review.

**The vocabulary**

- 20 states persisted on every transition, so a run is resumable and its history answerable. `NEEDS_EDITORIAL_ATTENTION` is terminal but is **not** a failure: the automatic budget was spent and a human now decides.
- 10 stages, `paid` marking the ones that call a model. 6 roles, distinct from capabilities — a capability says what a model is able to do, a role says what it is doing in this pipeline, for this mode.

**Four gates, in one place**

- Idempotence → spend gate → the call → technical fallback, in `stageRunner.service.ts`, so no stage author can forget one.
- **A parse failure is deliberately not fallback-eligible**: a malformed reply is an editorial problem, not a transport one, and must never cause a second model to be paid for the same question. A poor result is likewise not a technical failure — that path is the revision, capped at one.
- The fallback passes the spend gate independently, so a free primary can never fall back to a paid model in Test mode.

**Cost accounting**

- Per-stage estimates and a total, with `hasUnknownCosts`. A model with no published pricing is reported as unknown, never as zero.

**Supporting changes**

- **Schema**: `article_pipelines`, `pipeline_stage_runs` (unique on `pipeline_id, pipeline_version, stage, attempt` — the idempotency key), `pipeline_transitions`, `pipeline_role_models`.
- Two documented model substitutions where the named models no longer exist or are strictly worse: `claude-opus-4.8 → claude-opus-5` (same price, newer) and `gpt-5.5 → gpt-5.6-sol-pro` ($2/$10 against $5/$30 — cheaper and newer).

## [0.17.0] - 2026-09-02

### Summary

Milestone 19 (Amazon Creators API Integration). Amazon product data now comes from Amazon's official API instead of from reading Amazon pages — which Milestone 18 established yields nothing usable.

**Two paths, and no fallback between them**

- Generic websites → the Web Source + `http` retriever from Milestone 17. Amazon products → the Creators API. The router is one branch in `retrieveProduct()`.
- **An Amazon URL never falls back to scraping.** Unconfigured, bad credentials, unknown ASIN, API down — all are reported as failures. Three tests assert it, including one asserting *zero* network calls when the API is unconfigured.
- The generic Web Source system is untouched. Authorising `amazon.com` there no longer affects products, and the preflight says so rather than sending the user to configure the wrong thing.

**The API, as Amazon specifies it**

- OAuth 2.0 `client_credentials`, scope `creatorsapi::default`, against the region's token host (`api.amazon.com` / `.co.uk` / `.co.jp` for credential versions 3.1 / 3.2 / 3.3).
- `POST https://creatorsapi.amazon/catalog/v1/getItems` with `Authorization: Bearer`, `x-marketplace`, and a body of `itemIds`, `itemIdType`, `marketplace`, `partnerTag`, `resources`.
- Tokens cached per credential version for their full hour, refreshed a minute early; a 401 drops the cached token; saving credentials clears the cache without a restart.
- Resources requested: `itemInfo.title`, `byLineInfo`, `features`, `productInfo`, `technicalInfo`, `classifications`, `images.primary.large`, `browseNodeInfo.browseNodes` — listed on the Settings screen so the integration's reach is inspectable. **Prices are deliberately not requested**; Cynth never publishes one.
- The mapper reads defensively — every field optional, `displayValue` wrappers and bare strings both accepted, PascalCase tolerated alongside lowerCamelCase. A sparse response yields a sparse product, never invented fields.

**The affiliate URL, unchanged**

- The API supplies product data and never a link. The client is never given an affiliate URL; `partnerTag` satisfies the API and is never used to build one.
- **Short links are resolved, not read.** `amzn.to` carries no ASIN, so it is followed and only the *final URL* is used to read the ASIN — the body is discarded. Identifier resolution, not content retrieval.

**Credentials**

- Stored through the existing secret store: the gitignored `.env.local`, **never SQLite**. The only fact any response states about them is `hasCredentials`. Non-secret configuration lives in `settings`.
- The partner tag is deliberately not a secret — it appears in every affiliate link on the site.
- `isConfigured` is one answer: credentials without a partner tag cannot call the API, so they are not reported as configured.
- **Test Connection** makes the smallest real call that exercises auth, partner tag and endpoint together, and discards the result.

**What you must supply** — Settings → Amazon Creators API: Credential ID, Credential Secret, Credential Version, Partner Tag, and a default Marketplace.

**Supporting changes**

- **No schema change.** The Amazon path writes the same rows as the web path; only `product_research.extraction_method` differs (`creators_api`), and `retrieval_id` is null there because nothing was crawled.
- **API**: `/api/amazon/config` (GET, PUT), `/api/amazon/test` (POST).
- **Still no per-article product cap** — every ASIN goes in one request; a test asserts 25 in a single call.
- **Tests**: 21 new, 290 total, all passing, with `fetch` stubbed so no real Amazon request is made.
- **No new dependencies.** The official SDK was not adopted for one token call and one getItems call.

### Fixed

- **A terminal window opening and closing once a minute.** The `CYNTH Server` scheduled task retries every minute after a failure; port 4100 was held by a manually started server left over from Milestone 18 verification, so every retry hit `EADDRINUSE`, exited 1, and flashed a window. `MultipleInstances: IgnoreNew` cannot help — it prevents a second *task* instance, not a process started outside Task Scheduler. Fixed by stopping the orphan and registering the task with `-Hidden`; `install-startup-task.ps1` updated so a reinstall does not reintroduce it. The operational rule — restart the task, never start a second server by hand — is now in `docs/14_LOCAL_SERVICE_MANAGEMENT.md`.

### Verified live (2026-09-02)

A real Test Connection with real credentials confirmed the OAuth token is issued (HTTP 200, `scope: creatorsapi::default`) and that `getItems` reaches the service and is parsed — Amazon returned a *semantic* refusal rather than a malformed-request error, so host, path, headers and body shape are correct. Amazon then refused with `403 AssociateNotEligible`: the documented 10-qualifying-sales-in-30-days requirement, which nothing in Cynth can change. **The response mapping remains unproven** — no real item has been returned yet.

**Fixed while diagnosing it:** the error reader understood only the per-item `errors: [{code, message}]` form, so a top-level `{message, reason, type}` fault was discarded and shown as a bare "HTTP 403" — advising the user to re-check credentials Amazon had already accepted. It now reads both shapes, gives eligibility its own code (`amazon_not_eligible`, distinct from an auth failure), and names the real blocker. A regression test carries the exact 403 body.

### Known limitations

The response mapping is unproven until the account becomes eligible and a real item comes back; only `getItems` is implemented (no search or variations); the API exposes features rather than a prose description, so `description` stays null on Amazon products; availability is never re-checked; no client-side rate limiting; and short-link resolution makes one plain HTTP request outside the Web Source permission system, reading only the final URL.

## [0.16.0] - 2026-09-02

### Summary

Milestone 18 (Product Placement Review, Durable Images & Product Themes). Three improvements requested after testing Milestone 17, plus a reported Amazon failure that turned out to be four defects — one of them a safety hole.

**The Amazon failure, reproduced rather than assumed**

- **The link was `amzn.to`, not `amazon.com`** — a different domain, correctly refused. Consent stays per-domain; the message now names the domain to authorise.
- **Fixed a safety hole:** the retriever used `redirect: 'follow'`, so authorisation was checked against the URL typed and never against the URL fetched. An authorised domain redirecting to an unauthorised one would have been read. Redirects are now followed by hand with **every hop re-authorised**, and provenance names the URL actually read.
- **Fixed: HTTP errors became products.** A 404 produced a product called "Page Not Found". A non-2xx response is now a refusal, and a title alone is no longer usable research — a page must publish a title *and* something else.
- **Amazon publishes no usable product metadata.** No JSON-LD; its OpenGraph is site-level boilerplate (`og:title` = "Amazon", image = the Amazon logo). Milestone 17 would have created a product named "Amazon" with the Amazon logo. Extraction now **detects and ignores a site-level OpenGraph block** — comparing og:title against og:site_name, og:description and the host's own name — and falls through to the document title with its site suffix stripped. No retailer is named anywhere in that logic.
- **Verified live after the fix:** a real product URL yields "2022 Echo Dot 5th Gen Smart Speaker | Charcoal" with a real description; the dead ASIN is refused with *"answered HTTP 404, so there is no product page to read."*
- **Honest limit:** Amazon retrieval yields a title and description but **no image and no specifications**, because Amazon publishes neither machine-readably. Upload an image for Amazon products. The sanctioned route for richer data is the Product Advertising API, which needs the operator's own credentials.
- **No safety or compliance rule was weakened.**

**1. Product placement is now reviewed**

- New **`product_placement`** SEO category and a per-product verdict on `article_products`, routed through the **`seo_review`** capability — same Model Router, spend gate, single-attempt rule and history. No second AI system.
- **A good placement is reported as good**, with its own explanation. A review that only complains cannot distinguish "checked and fine" from "not checked".
- **It reviews, it does not edit.** Only the review columns are written; `status`, `placement_section` and the article body are untouched. A better section is stored as `review_suggested_section` — a suggestion in its own column.
- Weak and misplaced verdicts also become SEO findings, reaching the existing findings list, score and gate. Neither blocks.
- A suggested section is discarded unless it names a heading the article actually has.
- Regenerating an article clears every verdict, because they described the old placements.
- Results appear on the SEO Review page.

**2. Product images are stored locally**

- Upload, `product_images`, the primary flag and `database/uploads/products/` already existed; the card already preferred an uploaded image. What was missing was a durable copy of a **retrieved** image.
- A researched image is now downloaded once and stored through the same path as an uploaded one — same folder, same UUID filenames, same rows, same serving path. No second image system.
- http(s) only, the same four types and 8 MB ceiling as upload, Cynth's own filename, folder created if absent. A failed download is a warning, not a failed retrieval. An editor's own primary image is never displaced.

**3. Products carry a thematic area**

- `products.theme_id`, nullable, `ON DELETE SET NULL` — retiring an area removes the association, never the product. Every picker is built from the `themes` table; the five current areas appear nowhere in the implementation.
- Assign on create, change later, or remove — via the form or `PATCH /api/products/:id/theme`, so clearing does not require resubmitting the product.
- Products list gains a Thematic Area column and filter, with a distinct **"No thematic area"** option.
- Generation is told the product's area and whether it differs from the article's — **as information, never a filter**. A mismatch is stated with "that is not a reason to exclude it". No mismatch is claimed when either side has no area.

**There is no product limit**

Confirmed rather than asserted: nothing in the schema, repository, prompt builder, context resolver or UI caps products per article. A test attaches **25 products** to one article and asserts every one reaches the prompt. The only real constraint is the model's context window, and nothing truncates silently.

**Supporting changes**

- **Database** (additive): `products.theme_id`; six review columns on `article_products`.
- **API**: `PATCH /api/products/:id/theme`; `themeId` filter on `GET /api/products` (accepts `none`); `GET|POST /api/product-research/articles/:id/placement-review`.
- **Tests**: 18 new, 269 total, all passing against a local mock retailer. **No real website is contacted and no model is called.**
- **No new dependencies. No article was generated and no model was called.**

### Known limitations

Amazon yields no image or specifications; JavaScript-rendered metadata still yields nothing; the placement review reads the marker's surroundings rather than the whole article; it routes to `seo_review` rather than the still-unrouted `quality_review`; it is manual and per-article; a product has one thematic area rather than several; and stored images are never re-fetched.

## [0.15.0] - 2026-09-02

### Summary

Milestone 17 (Product Research & Contextual Insertion). The editor supplies product URLs they have already chosen; Cynth reads what each page publishes about itself, works out what the product is for, and the author places it where it is genuinely relevant — or leaves it out.

**The affiliate URL is authoritative**

- Stored once, verbatim, and emitted into the rendered card verbatim. Nothing normalises it, strips parameters, canonicalises it, or derives a replacement from the page that was read.
- The page Cynth read is stored in a **separate column** (`products.source_url`) so the link Cynth publishes and the page Cynth read can never be confused.
- **The model never sees the affiliate URL**, so it cannot reproduce, mangle, or invent a variation of it. All three properties are tested.

**Web Sources extended, not replaced**

- The retriever registry — empty by construction since Milestone 14 — now holds one `http` retriever implementing the obligations that were written down for whatever was registered first: it takes a `WebSource` and never a bare URL, refuses a source whose crawl permission is off, obeys robots.txt when the source says to (and treats an unreadable robots.txt as a refusal), honours the stricter of the source's rate limit and the site's `Crawl-delay`, and writes a `web_retrievals` row with a content hash for every fetch.
- It reads **one named page**. No `discover()`, no link following: registering it did not make Cynth a crawler.
- An authorisation for one domain cannot be spent on another. The retriever identifies itself honestly rather than as a browser.

**Retrieval is not ingestion**

- Extraction reads only what a page publishes for machines: schema.org `Product` JSON-LD, OpenGraph, meta description. Page copy is never returned, and the retrieved HTML never reaches a model.
- Nothing is vendor-specific — no Amazon parser, no per-site branch. `vendor` is derived from the host as data.
- A page publishing no usable metadata is **refused, not guessed at**, with manual entry offered. Manual entry remains fully supported throughout.

**`research` is now a routed capability**

- The understanding step answers one question — what is this product *for* — because that is what a placement decision turns on. Assignable since Milestone 15 and routed to by nothing until now.
- Routes through the Model Router, passes the same spend gate as article generation and SEO analysis (`confirmedCost` is never defaulted to true), never substitutes a model, never retries, and records every attempt in generation history. It is given the extracted fields only.
- `generation_history.article_id` now accepts null, for the first task that is not about one article.

**Placement is the author's decision**

- An article can carry several products (`article_products`). `articles.product_id` is deprecated-but-preserved and still read, so older drafts keep their single product.
- The prompt offers products as an **inventory, not a requirement**, each led by what it is for, and states plainly that leaving one out is a correct outcome.
- The author writes `[[product:12]]` on its own line where a product belongs. The prose stays the author's; the card stays Cynth's, built from stored records. Markers naming an unoffered product, or repeating one, are discarded before the draft is saved.
- Where each product landed is recorded afterwards, including `omitted`.

**The product card**

- Rendered on the WordPress push: semantic HTML with stable `efd-product-card` class hooks, no styling, no `<script>`, no inline CSS, no external asset beyond the image — so it survives a static export. Cynth does not guess what an EveryFiveDays card looks like.
- Every affiliate link carries `rel="sponsored nofollow noopener"`. A product with no affiliate link renders without a link rather than pointing elsewhere. Only http(s) URLs become an `href` or image `src`.

**Amazon, checked rather than assumed**

Verified with the parser that was built, against the live robots.txt: `/dp/<ASIN>`, `/Title/dp/<ASIN>?tag=…` and `/gp/product/<ASIN>` are **allowed**; `/dp/shipping/…` and `/gp/cart/…` are correctly refused. Authorising `amazon.com` remains the user's explicit decision.

**Supporting changes**

- **Database** (additive): `article_products`, `product_research`, and nine research columns on `products`. `affiliate_link` was not touched.
- **API**: `/api/product-research` — `POST /check`, `POST /retrieve`, `GET|POST /:id/research`, `GET /:id/research/preflight`, `GET|POST|DELETE /articles/:articleId/products`.
- **Prompt**: `PROMPT_VERSION` `3` → `4`; new `PRODUCTS AVAILABLE` and `PRODUCT PLACEMENT` sections superseding the single `PRODUCT` block.
- **Tests**: 22 new, 251 total, all passing, against a local mock retailer on 127.0.0.1. **No real website is contacted and no model is called.**
- **No new dependencies. No article was generated and no model was called.**

### Known limitations

Placement quality is unmeasured; a page that renders its metadata with JavaScript yields nothing (reported honestly rather than guessed at); product images are referenced rather than stored, so an uploaded image is the durable path; prices and availability are extracted but never published; there is no `discover()`, so a product must be named by URL; the rate limiter is process-local; and placement rationale is never populated.

## [0.14.0] - 2026-09-01

### Summary

Milestone 16 (Author Skills). An author's identity can now be supplied as a **document** rather than as a set of fields, and that document reaches the model unchanged.

**Author skills**

- **A skill is markdown, stored verbatim and sent verbatim.** Nothing parses, summarises, extracts from, reflows or escapes it — em dashes, curly quotes and markdown tables arrive at the model exactly as written. Tested through to the assembled prompt, not assumed.
- **Skills sit beside the structured persona fields rather than replacing them.** Both are sent; the prompt states that the skill wins where they disagree, and the `AUTHOR SKILL` section follows the summarised `AUTHOR` section so that instruction refers to something visible.
- **A skill is scoped to one author or shared across all of them.** A shared editorial philosophy is one row, not five copies. Shared guidance is emitted before the individual voice.
- **Nothing reaches the model that the user did not put there.** A skill must be active *and* assigned. An author with no skill produces no section at all, so every author created before this milestone generates identically.
- `PROMPT_VERSION` `2` → `3`. Articles record the version they were generated under; nothing already produced was rewritten.

**Theme → author, using what was already there**

- `author_themes` (Milestone 10) already mapped thematic areas to authors, many-to-many, editable from either end. This milestone populated it rather than changing it.
- The New Article wizard already narrowed the author list to the chosen area. It now **selects the author automatically when the area has exactly one active author** — only exactly one, because choosing between several is an editorial decision Cynth does not make. The choice stays overridable.
- Changing the thematic area clears the author, so the new area's author is the one resolved.

**The Author folder**

- The database is the source of truth; `CYNTH/Author/` is the exchange format. Generation never reads the folder — Cynth works with it absent, renamed or emptied.
- **Import** reads one file or the whole folder, matched to its row by `source_filename`, so re-importing an edited file updates rather than duplicates.
- **Export** writes a skill back to the file it came from, so folder and database converge instead of drifting.
- **Import All** creates the author each document names and links them to the thematic area its H1 names, reporting every decision file by file.
- Filenames are checked twice — the name must be a bare `.md`, and the resolved path must remain a direct child of the folder.

**What import refuses to guess**

- A document naming no author is imported **inactive and unassigned**. On the EveryFiveDays folder that held back `shared-philosophy.md` and `system-prompt-template.md`; the philosophy was then set to shared scope deliberately, and the template — a specification of this milestone's own behaviour — was left switched off.
- An author created by import gets a name and the document. Every structured persona field is left null.
- A document naming a thematic area the project has not configured is reported as unlinked. No area is invented.

**Management**

- New **Author Skills** screen (`/author-skills`): add, edit, reassign, activate/deactivate, delete, import, export, and a table of skill → scope → author → thematic areas → size → status.
- An author's own page shows their skills read-only and names the shared skills that also apply.
- Assigning authors to thematic areas stays on the Thematic Areas page and the author's own page; the skills table shows the result rather than duplicating the control.

**Supporting changes**

- **Database** (additive, one new table): `author_skills`. No migration needed.
- **API**: `/api/author-skills` — list, get, create, update, delete, `PATCH :id/author`, `PATCH :id/status`, `GET /library`, `POST /library/import`, `POST /library/import-all`, `POST :id/export`, `GET /meta/scopes`.
- **CLI**: `npm --prefix app/server run import:skills`.
- **Fixed**: the library listing reported every file as changed since its import. SQLite writes timestamps as `YYYY-MM-DD HH:MM:SS` and the filesystem reports ISO 8601; compared as strings, `T` sorts above the space, so the answer was always wrong in the same direction. Both are now parsed to epoch milliseconds.
- **Tests**: 22 new, 229 total, all passing. **No new dependencies. No model was called and no article was generated.**

### Verified

The five persona documents were imported into the live database: five authors created (Mara Kessler, Devon Cho, Priya Anand, Theo Lindqvist, Naomi Alvarez), each linked to the thematic area their document names. Each of the five areas resolves to the right author and skill in the New Article wizard. A prompt built for Sleep & Recovery came to 9,977 characters across eight sections, carrying the persona and the shared philosophy intact and the template document absent.

### Known limitations

Skill content is not validated as editorial guidance; the Quality Gate does not check an article against its skill; `position` ordering is unused with one document per author; import matches an author by exact name; `changedSinceImport` is accurate to one second; and the UI reports that a file and its skill have diverged, not how.

## [0.13.0] - 2026-08-30

### Summary

Milestone 15 (Model Management, EFD Verification, Quality Gate & SEO Status). A verification milestone: existing infrastructure made usable, and the parts that only appeared to work identified and dealt with honestly.

**AI model management**

- **A model holds a SET of capabilities.** `ai_model_capabilities` replaces the single `purpose` column, so Provider → Model → Capability no longer forces one row per job. The migration merged the duplicate rows this had produced, carrying every capability and default flag across. `ai_provider_models.purpose` is deprecated-but-preserved and no longer read.
- **`research` added as a capability.** Every capability is published with a label, a description, and whether any workflow routes to it yet — assignable-but-unrouted is stated rather than hidden.
- **Defaults are per capability**, so "default article model" and "default SEO model" are independent and one model can be both. Removing a capability that was a default leaves that purpose unset rather than promoting a substitute.

**Model validation — the reported bug, diagnosed**

- Root cause of *"The provider returned a response Cynth could not read"*: a Base URL pointing at `https://openrouter.ai/` (the website) instead of `https://openrouter.ai/api/v1` (the API root). The website answers HTTP 200 with `text/html`, so the request succeeded and only the parse failed.
- **`providers/baseUrl.ts`** refuses a recognisably-wrong Base URL before it is used, quoting the correction rather than applying it. An unparseable response now names what arrived and from where.
- **`modelValidation.service.ts`** runs `configuration → endpoint → credential → catalogue → live probe → normalisation`, reporting every stage. Whichever fails names the real problem. A model is saved only after validation passes.

**Test Model**

- The smallest request that proves the endpoint, key, model and response format work. Four-word prompt, 16-token cap, response discarded — **it never creates an article**.
- A free model is tested outright. A paid or unpriced one returns 402 with an estimated cost until explicitly confirmed. Unknown pricing counts as paid.

**Purpose filtering**

- `selectable-models?purpose=…` and the Model Router both enforce it, so article models and SEO models are distinguished by the system rather than by one screen.

**Quality Gate (new)**

- `app/server/src/features/quality-gate/` — fifteen deterministic checks in three groups, each with its own verdict and its own sentence explaining it. Statuses: Not Evaluated, Passed, Passed with Warnings, Failed. Blocking failures decide Failed; warnings never do; advisories are reported and never counted.
- Free, calls no model, and writes nothing to the `articles` table. A result that predates an edit is reported as stale, not silently recomputed.

**SEO Status (new)**

- `seoStatus.service.ts` derives Not Evaluated / In Progress / Passed / Needs Attention / Failed entirely from what the Milestone 14 engine already stored. No second SEO system, no analysis triggered by reading a status.
- `getLatestAnalysisAttempt()` added so a failed run is distinguishable from never having tried.

**EveryFiveDays WordPress — verified**

- Connection test passed against the live site across all four stages; article 3 pushed as **WordPress post 277, status `draft`**, verified independently via the WordPress REST API; post id persisted; a second `create` refused and `update` applied in place — three attempts, one post.

**Web Crawl — DEFERRED TO PHASE 2**

- Verified not operational: empty retriever registry, no URL-fetching endpoint, nothing ever retrieved. The Web Sources panel is labelled **Deferred to Phase 2** and states what was checked. Web intelligence and backlink discovery follow it.

### Cost

No article generated, no paid model called. Live model requests were probes against a free model only.

## [0.12.0] - 2026-08-27

### Summary

Milestone 14 (SEO Engine). Cynth now has an SEO intelligence layer between article generation and WordPress: it analyses an article against the editorial configuration it was written from, produces structured passage-level findings, scores SEO readiness in a way that explains itself, and gates the hand-off to the CMS.

**The engine**

- **`app/server/src/features/seo/`** (new) — the path from an Article to a gate decision: editorial context + SEO configuration → deterministic analysis → optional AI-assisted analysis → merged findings → score → gate, all persisted beside the article.
- **SEO reads the editorial context.** Project, Theme, Topic, Author persona, Article Type and content brief reach the reviewing model through the same `generationContext.service.ts` that feeds the writing model. Nothing is analysed as a generic block of text.
- **`article_seo`** — per-article SEO configuration and metadata. Target query, search intent (with `hybrid` and named secondary intents), supporting queries, concepts to cover, audience, geographic target, objectives, notes; and SEO title, meta description, SEO slug, canonical URL and accepted structured data. **Every field is optional, including the target query** — a topic-oriented article with no exact-match keyword is analysed semantically rather than refused.
- **The SEO title is distinct from the article title, and the SEO slug from the article slug.** A SERP headline and a page headline are different jobs, and a published URL has to stay stable while an editorial title is still being revised.

**Deterministic vs AI analysis, kept separate**

- **`seoDeterministic.service.ts`** — free, always runs first, contacts nothing: titles, meta description, slug, heading hierarchy, empty and unscannable sections, missing introduction, keyword usage, readability extremes, links and image alt text, plus cross-article duplicate metadata detection.
- **`seoAi.service.ts` / `seoPrompt.service.ts` / `seoAi.parse.ts`** — search intent alignment, topical completeness, missing concepts, questions and entities, usefulness, metadata proposals and authority opportunities. It routes through the existing Model Router (`seo_review` purpose) and the existing provider adapters; the SEO feature names no provider, endpoint or key.
- The line is drawn on reliability: a model asked whether two slugs are identical will sometimes be wrong about it.

**The model's output is treated as untrusted**

- A finding with an unknown category, dimension or severity is **discarded, not repaired**, and the discard is reported rather than hidden.
- An internal link suggestion referencing an article id that was not offered is discarded — Cynth cannot be talked into linking to something that does not exist.
- A quoted passage is **verified against the article** before it is shown; an invented quote is dropped and the finding says so.
- A response that cannot be parsed is recorded as a failure rather than salvaged into findings the model may never have made.
- A missing confidence becomes 0.5 (uncertain), never 1.

**Findings and passage-level locators**

- **`seoDocument.ts`** (new) — the article body parsed into headings with ancestry, sections, addressable paragraphs, links and images, with character offsets. This is what lets a finding say *this paragraph, under this heading*, and quote it.
- Every finding carries a code, category, dimension, severity (`blocking` / `warning` / `recommendation` / `info`), origin (`deterministic` / `ai`), summary, explanation, recommendation, element, locator and confidence.

**The score**

- 0-100 across nine weighted dimensions, each scored and explained on its own.
- **Nothing is scored that was not examined.** A dimension only a model can judge, in an analysis where no model ran, is reported as *not evaluated* and excluded from the average — neither credited with 100 nor punished with 0 — and `coverage` states what fraction of the weighting was assessed. A diagnostic finding alone does not make a dimension count as examined.
- **`info` findings cost nothing.** Keyword density is reported so it can be read, never so it can be hit; there is no target density in Cynth and the only density rule that moves the score fires on *overuse*.
- AI penalties are weighted by the model's own stated confidence; a reviewed-and-dismissed finding stops costing points.
- The explanation states, in words, that the score measures SEO readiness and not article quality.

**Recommendation → Proposed Change → Approved Change**

- Three distinct records in `seo_recommendations`. Approving a metadata proposal writes the field; approving advice about the article body records the decision and changes **no prose**, enforced in the repository where only metadata fields have a column to write to.
- Re-analysing replaces open proposals but never a human decision, and a proposal already rejected is not offered again.
- **Cynth does not rewrite articles.** Body-level recommendations deliberately carry no proposed replacement text.

**The SEO gate**

- `CYNTH Draft → SEO Analysis → SEO Findings → User Review → SEO Ready → WordPress Draft`, enforced in `cmsPublish.service.ts` — the one path out of Cynth — before any network call, with refusals recorded in the push history like any other.
- Configurable, and a **perfect score is never required**: by default there is no minimum score and no warning limit. Blocking findings stop a push; dismissing one is a way through. A stale analysis (the article changed since it was run) is refused.
- Every criterion reports its own verdict and reason, so "not ready" is always actionable. Switching enforcement off still evaluates and shows the decision.

**WordPress, without naming an SEO plugin**

- `CYNTH SEO Metadata → CMS SEO Adapter → WordPress SEO Plugin`. Milestone 13's deliberately-null `buildSeoMetadata()` now returns real metadata — from human-owned values only. A proposal nobody accepted is not metadata, and unapproved links do not travel.
- **`cms/seoAdapter.ts`'s mapping registry is empty on purpose.** EveryFiveDays' SEO plugin has not been chosen, and writing post-meta keys for a plugin that may not be installed would create orphaned data. When it is chosen, one `SeoFieldMapping` is registered and nothing else changes.

**Web intelligence foundation — architecture, and no crawler**

- `web_sources`, `web_retrievals`, `web_findings` and the `WebRetriever` / `WebResearchService` contracts.
- **`web-intelligence/retrievers/index.ts` is an empty registry**, so there is no code path in Cynth that can fetch a web page. `/api/web-intelligence/capabilities` reports that plainly rather than leaving it to be discovered.
- **Provenance is structural.** A finding requires a retrieval; a retrieval requires a user-created source; and a finding's source and URL are read from its retrieval rather than accepted from the caller. Both source permissions (crawl, search) default to off — appearing in a list is not consent — a URL is reduced to a bare host so a permission means what it appears to mean, and `robotsAllowed` is nullable so "not checked" is visible.
- `WebResearchService` returns selected, cited findings rather than page text: future generation gains an attributed research section, never a dump of scraped websites.

**Backlink foundation**

- `backlink_opportunities` with the `discovered → recommended → approved / rejected → placed` workflow. Manual entry only — there is no discovery engine — and an authority signal without a stated source is refused. Nothing writes a link into an article.

**Cost control**

- Deterministic analysis is free and always runs first. The AI pass needs an explicit `includeAi`; a paid model needs an explicit `confirmedCost` on top. Neither is ever defaulted to true, and Test mode refuses a paid model outright.
- An AI analysis whose content and configuration fingerprints match an existing one is **reused rather than paid for again**, with an explicit Force option; editing the article invalidates the reuse.
- A failed AI pass keeps the deterministic analysis and is recorded as `partial` rather than reported as complete.
- **No real AI spend was incurred.** Every AI path was exercised against a local mock provider priced at zero.

**Supporting changes**

- **`generation/providerTarget.service.ts`** (new) — provider/model resolution extracted from the generation service so article generation and SEO analysis resolve identically. Generation behaviour is unchanged.
- **Database** — eleven new tables, all additive via the existing idempotent pattern. **No existing table was altered and no existing row was touched.**
- **API** — `/api/seo/*` and `/api/web-intelligence/*`; `cms.errors.ts` gained `seo_gate_blocked`.
- **UI** — an SEO panel on the Article view (score with per-dimension explanation, findings with passage locators and dismissal, configuration, metadata with proposal approval, opportunities and diagnostics, gate checks); a rebuilt cross-article SEO Review page with gate criteria and web-source management; and the gate decision stated on the WordPress push panel.
- **Tests** — `app/server/test/seo.test.ts` (58 tests). 155 tests pass in total. The WordPress suite now runs the real flow — analyse, then push — rather than around the gate.
- **No new dependencies.**

### Fixed

- **`app/server/src/features/seo/seoScore.service.ts`** — a lone diagnostic finding made an AI-only dimension count as fully evaluated at 100 in an analysis where no model had run. Diagnostics no longer count as assessments; the score on the live article moved from 96 at 73% coverage to 95 at 58%, which is the honest figure.
- **`app/server/src/features/seo/seoStructuredData.service.ts`** — a bullet listicle qualified for HowTo structured data because unordered list items were counted as procedure steps, and section headings opening with "How" or "What" were counted as FAQ questions. Both now require what the markup actually describes: genuinely ordered steps, and an explicit question mark.
- **`app/server/src/features/seo/seoAnalysis.service.ts`** — re-analysing an article accumulated duplicate proposals. Open proposals are now replaced on a re-run while every human decision survives.

## [0.11.0] - 2026-08-27

### Summary

Milestone 13 (Content Production System). Cynth can now be told which models exist and what they cost, be pointed at a specific model per generation, and hand finished drafts to WordPress — and it runs as a single process that starts with Windows.

**OpenRouter model management**

- **`app/server/src/features/ai-providers/modelCatalog.service.ts`** — model discovery. Reads a provider's live catalogue (417 models from OpenRouter at time of writing), classifies every entry, and filters by free / paid / unpriced. Cached for 15 minutes; any refresh bypasses the cache. **Cynth contains no hardcoded model list.**
- **Catalogue metadata** — the `ProviderModelInfo` contract now carries vendor, description, per-request price, availability, publication date, and capability metadata (input/output modalities, tokenizer, max output tokens, supported parameters, moderation). All provider-published; none inferred.
- **Free/paid classification by price, never by name** — `classifyModel()` reads only pricing. A model is free when its input and output prices are both known and both zero and any flat per-request charge is zero. It never reads the model id, which matters because OpenRouter lists ids ending in `:free`, paid models with "free" in their names, and genuinely-free models with no marker at all.
- **Negative prices are a sentinel, not a price** — OpenRouter publishes `-1` for models whose cost depends on where they route (`openrouter/auto` and four others in the live catalogue). Previously these would have classified as "paid" with a negative price and produced a *negative* estimated cost. They now normalise to `unknown`, which is treated as paid.
- **Model registry** — `ai_provider_models` gained `vendor`, `request_price`, `catalog_status`, `capabilities` (JSON) and `in_catalog`. Adding a model from the catalogue stores the provider's own metadata; the request names a model and nothing more, so a browser cannot assert what a model costs.
- **Duplicate protection, purpose-aware** — re-adding a model already registered for the same purpose refreshes it in place. Registering one model under two *different* purposes stays a legitimate configuration (the registry has always allowed it), which a purpose-blind upsert would have silently broken.
- **Catalogue refresh preserves user configuration** — `POST /api/ai-providers/:id/sync-models` updates provider-owned metadata on every registered model and never touches display name, purpose, enabled state or default-for-purpose. A model missing from the catalogue keeps its last known pricing and is flagged `in_catalog = 0`; blanking it would turn "we no longer know what this costs" into "this is free".
- **Provider Test Connection is now real** — it reads the catalogue (a free metadata call) and reports how many models are free, paid and unpriced. Deliberately not a test generation, which would be billable.
- **UI** — a Discover Models browser on the AI Provider screen: free/paid/unpriced filters with live counts, search across id, name and vendor, an Inspect view of full capability metadata, per-model purpose assignment, and Add to Registry. Registry cards now show cost class, input/output pricing per million tokens, context length, vendor and when metadata was last refreshed.

**Model selection and cost safety**

- **`GET /api/ai-providers/selectable-models`** and a model picker in the New Article workflow, grouped by cost class, with provider and per-million-token pricing on every option.
- **`routeForModel()`** — the Model Router resolves an explicitly chosen registry entry. The picker names a registry entry only; the browser never selects a provider, an endpoint or a credential.
- **A selected model is the model that runs.** No code path substitutes another — not the purpose default, not a cheaper one, not a working one. A selection that cannot run is an error, and a free model that fails never becomes a paid one.
- **Selection does not bypass the spend gate** — Test mode still refuses paid models outright; Production mode still requires explicit per-request confirmation, and the confirmation resets whenever the selected model changes.
- Cost estimates now include a flat per-request charge where a catalogue publishes one, and generation history records whether the model came from an explicit choice or the purpose default.

**WordPress**

- **`app/server/src/features/cms/`** (new) — a CMS connector layer: `CYNTH → CMS Connector → WordPress`. Nothing above the connector knows WordPress exists.
- **The connector contract has no publish operation.** No `publish()`, no `setStatus()`. Draft-only is structural rather than procedural. Every write sends a literal `draft` constant, and an update to a post whose remote status is no longer `draft` is refused outright — overwriting live content is not Cynth's decision, and asking for draft status on a published post would silently unpublish it.
- **Connection settings** — site URL, authentication method, username, credential, connection status, test, active/inactive, default, and an optional author mapping chosen from the site's real users. The site URL is always configurable and never assumed, so the same record works against the local install now and a live domain later.
- **Test Connection** distinguishes four failures — unreachable site, unavailable REST API, rejected credentials, account that cannot post — because they have four different fixes. It performs two reads and creates nothing.
- **Article → WordPress Draft** — title, body, slug and status mapped; author mapped only when configured; excerpt deliberately not sent, because Cynth has no authoritative excerpt and the list preview is a display truncation, not editorial content.
- **Markup translation** — `articleMarkup.ts` renders the generated Markdown body to HTML (headings, paragraphs, lists, blockquotes, code, emphasis, links). Source is escaped before markup is introduced and only `http(s)`/root-relative link targets are linkified, so a body cannot inject markup or a `javascript:` URL into a post.
- **Post identity and duplicate protection** — `article_cms_links` records the remote post id, status, URL, site and push timestamps. The preflight states whether the button creates or updates; `mode` is required and verified against reality rather than trusted; a deleted remote post is reported and then re-creatable; an in-flight guard stops a double-click producing two posts.
- **Synchronisation history** — `cms_push_history` records every create, update, refresh and test, including refusals, and survives deletion of the connection that produced it. No credential is recorded.
- **UI** — a WordPress settings screen with per-stage test diagnostics and recent synchronisation activity; a push panel on the article view showing the existing post, its remote status, exactly what will be sent, and either **Push to WordPress as Draft** or **Update WordPress Draft**.

**Server architecture**

- **`shared/static/clientStatic.ts`** — Express serves the built client from the same process as the API. One process, one port, no proxy, and `node dist/index.js` has no watch child, so no orphaned Node process can hold the port. Mode is detected from the running file's extension, overridable with `CYNTH_SERVE_CLIENT`; development still uses Vite and is unchanged.
- **Root `package.json`** — `npm run build` (client then server), `npm start`, `npm test`.
- **`scripts/`** (new) — `install-startup-task.ps1` registers a Windows scheduled task with crash recovery (logon trigger by default, `-AtStartup` for pre-login), `uninstall-startup-task.ps1` removes it, `status.ps1` reports both the task state and `/api/health`.
- **Health** — `/api/health` now reports uptime, start time, mode and whether this process serves the client. A persistent indicator in the app shell polls it every 20 seconds and on focus, showing **Backend Running** or **Backend Unavailable** with the command that starts it. This reverses the binder's earlier deferral, which had missed the case of a page already open when the backend dies.
- **`notFound`** now returns the same `errors: string[]` shape as every other endpoint, so a mistyped API path reports itself properly instead of falling back to a generic message.

**Database** (additive, idempotent migrations, nothing destroyed): `ai_provider_models` gained `vendor`, `request_price`, `catalog_status`, `capabilities`, `in_catalog`. New tables `cms_connections`, `article_cms_links`, `cms_push_history`.

**Security**

- The secret store was generalised from AI provider keys to all credentials (`shared/secrets/secretStore.ts`). WordPress credentials use the identical mechanism: only the env var *name* reaches SQLite, only `hasCredential` reaches the browser, exactly one server-side function returns a value, and deleting a connection deletes its credential.
- CMS error wording is redacted before display or storage, covering WordPress's application-password format and `Basic` headers alongside the existing bearer-token patterns.
- Verified: no credential in any table, DTO, preflight, push result, push history record, or health payload.

**Tests** — 95 automated tests across four suites (`pipeline`, `models`, `wordpress`, `server`), all against local mocks. No test spends money, and no test publishes to WordPress; the mock CMS asserts per request that every write it receives asks for a draft.

### Known limitations

1. **No live WordPress push was performed.** The connector was verified against the real `everyfivedays.local` site through the reachability and REST-API stages, and correctly reported a deliberately-wrong credential as an *authentication* failure. Creating a real draft needs a WordPress Application Password, which is the user's to generate — no credential was created on their behalf. Push, update and duplicate protection are covered end to end against a mock CMS.
2. **Milestones 10–12 remain unrecorded** in this changelog and in [13_MILESTONES.md](13_MILESTONES.md). The work exists in the codebase; the entries were never written, and have been noted as a gap rather than reconstructed after the fact.

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
