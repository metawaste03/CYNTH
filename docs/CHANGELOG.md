# Changelog

All notable changes to the Cynth project binder will be recorded in this file.

## [0.56.0] - 2026-10-08

### Fixed

- **The product you just added now leads the products step.** Reported plainly: the newest product should come first, then only that category's, then the option to open the full library. Instead, a desk lamp added for article 49 mid-checkpoint was filed under another area, so it appeared nowhere near the top — reachable only by opening every other category's products. The step now lists, in order: **Just added** (anything added to the library since this run started, whatever its area, marked with its area), **this area** (newest added first), and **Show the full library** behind a button.

- **"Newest" means date added, not date last edited.** The list followed the repository's `updated_at` order, so a product touched by a bulk tidy-up sat above one added a minute ago.

- **The full library no longer opens itself.** It used to open whenever the article's area had no products, filling the step with other categories. It now opens on its own only when a product already chosen for this article is in it, so nothing ticked is hidden.

- **Product thumbnails in this step never loaded.** The image address was built as `/` + `/uploads/…`, which the browser read as a host called "uploads". Retailer image URLs are now used as they are.

**Verified**: 1 new test. On a copy of the real database, article 49's step lists the lamp first, then the five Cognitive Performance products, with 43 behind the button. **553 tests pass.**

## [0.55.0] - 2026-10-08

### Security

- **Cynth listens on 127.0.0.1 only.** `app.listen` had no host, so it bound to every interface. Cynth has no login, Windows had an inbound Allow rule for node.exe on the Public profile, and the laptop's Wi-Fi was classed Public — anyone on the same network could read every draft, replace live articles and spend provider credit. `CYNTH_SERVER_HOST` overrides it deliberately; `CYNTH_ALLOWED_HOSTS` must then name the hostnames.

- **A request guard refuses DNS rebinding and cross-site writes.** Binding to loopback keeps other machines out but not other websites in this machine's browser. Requests whose `Host` is not this machine are refused (rebinding), and non-GET requests whose `Origin` names another site are refused (CSRF — `push-seo`, `push-featured-image` and `refresh` needed no body and fell back to the Live connection). Scripts sending no Origin, and the Vite proxy, are unaffected.

- **A saved credential no longer follows a changed site address.** Editing a connection's URL kept the stored WordPress password, and the next Test sent it to the new host — the simplest way to steal it. Changing the destination (or the connector/provider type) without entering a new secret now clears the stored one. AI provider keys get the same rule.

- **Secrets cannot contain line breaks.** A newline in a credential wrote an extra `KEY=value` line into `.env.local`, which was loaded into `process.env` on the next start. Refused by both validators and by `setSecret` itself.

### Fixed

- **"Update the live article" unpublished every article with a featured image.** The body update correctly omitted `status`, then the image step sent `status: draft`. The UI said readers saw the new version; the post had gone. It happened to posts 365, 394 and 338 on 2026-10-01, each re-published by hand. The image step now leaves a live post's status alone.

- **Articles published in WordPress showed as drafts in Cynth.** A link's status was only read at push time or on a per-article Refresh, and publishing happens in WordPress where Cynth cannot see it — five live articles still said draft. Every pushed post is now re-read shortly after start and every 15 minutes, and on demand from **Sync from WordPress** on the Articles page. A post published on the default site also marks the article published; it never demotes one.

- **`wordpress.test.ts` wrote test credentials into the real `.env.local`.** It never set `CYNTH_SECRETS_FILE`, and the scratch database's connection ids overlap the real ones, so a test could overwrite or delete a real site's password. The stray `CYNTH_CMS_1_CREDENTIAL` came from here.

- **The mock WordPress ignored the `status` it was sent**, which is how the unpublish passed every test. It now applies it, as WordPress does.

**Verified**: 10 new tests; the live-update regression test fails with the fix removed. Run against a copy of the real database, the sync marked articles 27, 41, 42, 43 and 44 published and left 45–47 as drafts. **552 tests pass.**

## [0.54.0] - 2026-10-03

### Added

- **The Dashboard's Articles card opens the catalogue, grouped by area.** It was the only counting card with no destination: it reported a total and went nowhere. A total answers "how much have I made"; the question behind the click is "what have I made, and where are the holes", and that one is per area.

  Each area shows what it holds and how it stands — written, live, never pushed, words — and each row carries the article number, title, word count, SEO score, where it is on the site, author and last update. All of it read from the database; nothing inferred and no model asked, because how many articles exist and how long they are are questions about stored data.

- **The whole card is the click target.** Reported plainly: "I want it to be clickable when I click on it." The cards looked like buttons and behaved like paragraphs with a small link in the corner, so the obvious click did nothing. A card with nowhere to go stays a plain element — making a dead card look clickable would be the same mistake in reverse.

- **A stale SEO score is labelled, not hidden.** A score measured against a body that has since changed is not a lower score, it is a score for a different article. It is shown greyed with "stale" beside it, and it agrees with the SEO gate because both now call the same fingerprint function.

### Changed

- **`fingerprintOf` is extracted from `contentFingerprint`** so a caller holding database columns can ask "does this stored analysis still describe this article?" without reimplementing the hash. A second copy of that formula would agree until the day somebody changed one of them and then disagree silently, which is the worst way for a staleness check to fail. Its NUL separators are preserved exactly — they are why the file reads as binary to grep.

### Fixed

- **The score column showed a dash for every article while thirty-two real scores sat in the table.** The query filtered on `status = 'succeeded'`; the analysis service writes `'success'` and `'partial'`. Guessing at another module's vocabulary rather than reading it cost the entire column. `partial` is included: that is a run where the AI pass failed and the deterministic analysis stood, so its score is real, and hiding it would report an analysed article as never analysed.

- **"On the site" could report the wrong site.** An article pushed to both the local install and production has two link rows, and the query took whichever came back first — which on a recent local push would have shown "draft on site" for something live on everyfivedays.com. It now prefers the https connection.

**Verified**: 7 new tests, including word-count parity with the Drafts list and the live-site preference. **542 tests pass.**

## [0.53.0] - 2026-10-01

### Added

- **A way to check whether an area covers what its brief says it covers.** Asked plainly: can we confirm Smart Pet Care is not skewing toward cats? The brief already said it must not — *"DOGS AND CATS BOTH. The back catalogue skews heavily to cats and to devices; correct for that rather than continuing it"* — sitting in the one place topic research reads. **Nothing anywhere could say whether it was working.** It was not: seven of the nine species-specific products in the area were cat-specific, five of those litter boxes, and the one article with a species was a litter-box guide carrying 104 cat mentions against 12 dog.

  `npm run balance` reports the composition of articles, mentions and the product library, and the same numbers now reach the topic research stage as a fact. The coverage block already asked the model to notice when an area "clusters on one sub-subject, one product category or one species" — but it could only infer that from a list of titles, and the skew it was meant to catch lived in the product library, which it cannot see at all.

  **A tally, not a verdict.** It counts words against a declared vocabulary; it cannot read an article, and a dental-care piece that happens to use a dog in its examples is not thereby a dog article. Focus is decided by dominance — twice the mentions and at least two — so a single aside does not flip it. Nothing is ever blocked on this basis.

  Only areas that declare facets are measured. There is no general theory of editorial balance here: one area has a stated requirement that two things be covered, and now there is a way to see whether they are.

### Fixed

- **The first version of the report reassured about the exact thing it was built to watch.** It judged on article counts alone, and over a library of seven cat products and one dog product it printed "No clear skew between the declared facets" — because the two articles happened to be one each. It now reads articles, mention weight and products separately, and a sample too small to mean anything says so rather than returning a verdict.

- **The area lookup could resolve a name non-deterministically.** Themes are scoped per project, so two projects may legally hold an area with the same name; the query took whichever row came back first. Found through a test whose article counts came back 0 while its product counts were right — the fixtures had hung off a duplicate theme while the service resolved the seeded one.

**Verified**: 5 new tests, covering dominance over presence, a single passing mention counting as neither, the product library being measured, and the prompt block stating counts rather than judgements. **535 tests pass.**

## [0.52.0] - 2026-10-01

### Added

- **Every article row shows its number.** Reported plainly: "you keep numbering articles 28 & 36 — there's no way for me to know which is which once they're in draft." True, and it was a gap on my side, not the user's: every report, script and log in this project refers to an article by its id, and that id appeared nowhere a person could see while browsing drafts. The list now carries it, in tabular figures so a column lines up, muted so it does not compete with the headline, and selectable so it can be copied into a command. The WordPress panel shows it beside the WordPress post id, because that panel is the one place both numbering systems are in play and confusing them sends an edit to the wrong article.

- **Cynth files an article under its own thematic area on push.** It used to send no category at all, so every article arrived uncategorised and was filed by hand. One was filed wrong — a Sleep & Recovery piece published under Smart Pet Care — which kept it off its own category page, put it on somebody else's, and was invisible until a reader went looking for it. Cynth already holds the area; it is the field the article was commissioned under.

  **It will never create a category.** A name that matches nothing sends no `categories` field, and the mismatch is reported. A category created from a typo is invisible until somebody notices two near-identical ones in the sidebar — which has already happened on the product side, where "Sleeping Gadget" sat beside "Sleeping Gadgets".

  **An unresolvable name sends no field rather than an empty array.** An empty array would have stripped the post of every category it had, turning "I could not find yours" into "I removed the one you were using".

  Matching reads the whole category list and compares here, rather than asking the CMS to `search`. Search is the CMS's own tokenising, and the name Cynth holds does not have to match the way the CMS indexes the one it stores. Names are decoded first — WordPress returns "Sleep &amp; Recovery" while Cynth holds the plain characters, the same trap the picks shortcode hit on the site side.

- **`[efd_latest_by_area]` and `[efd_area_explorer]`** replace the last two hardcoded sections on the EveryFiveDays homepage. Both carried five invented articles with invented dates, and **nine of the ten article links on the homepage answered 404** — the posts had never existed. They were mockup furniture from the original build, exactly like the fifteen product cards.

  An area with nothing published is left out rather than padded with a placeholder, which is how the old rows came to exist in the first place. The explorer's tabs are real category links before any JavaScript runs, so a reader without it sees every panel stacked rather than an empty box.

  After the swap, all twenty article links on the homepage resolve.

**Verified**: 22 checks against a stubbed WordPress for the two new components, five new tests for the category on push, and **530 tests pass** on the Cynth side.

## [0.51.0] - 2026-10-01

### Added

- **Cynth can replace an article that is already published.** It used to refuse, and the refusal gave two reasons — but only one of them was a policy. The other was mechanical, and it was the more dangerous of the two: `updateDraft` sends `status: draft` unconditionally, so "updating" a live post would not have updated it, it would have **unpublished** it. The article would have dropped off the site mid-request while the caller was shown a success.

  The connector now has `updatePublished`, which sends **no `status`** — so WordPress keeps whatever the post already is, and a published post stays published — and **no `slug`**, because the slug is the live URL that every inbound link, share and indexed result points at, and moving it is not part of "fix a paragraph".

  The policy reason stands and is enforced here instead:

  - `update_published` is a **third push mode**, not a flag, so no existing call site can reach it by accident and no default can drift into it.
  - It needs an **explicit yes every time**, never defaulted — the route treats anything but a literal `true` as no, the same rule the spend gate uses.
  - If somebody **edited the post in WordPress** after Cynth last pushed it, it refuses again with `remote_edited_since_push` and names the two timestamps. One blanket "yes" must not cover both risks: a person confirming "replace the live article" has not been told there is unmerged work on the other side. A missing timestamp on either side counts as edited — not knowing is not the same as knowing it was untouched.
  - The push **history records it distinctly**, because the audit trail for "who replaced what a reader was seeing" is exactly what someone would come looking for, and hiding it inside `update` would bury it.
  - The success message says *"readers see the new version now"* rather than the old *"nothing has been published"*, which would have been a lie in the one place it matters most.

  The ordinary `update` still refuses on a published post, and now says which button to use instead of sending the editor to WordPress.

### Changed

- **`SAFETY: every write asked for a draft` is restated, not relaxed.** It asserted `status === 'draft'` on every write, which was right while every write announced a status. A live update must announce none. The invariant is now the one that was always meant: a write either asks for a draft or says nothing about status at all — neither can publish — plus a positive check that the no-status path really ran rather than never being exercised.

**Verified**: six new tests covering the unconfirmed refusal, the draft misfire, the remote-edit stop and its override, the payload carrying no status and no slug, and the distinct history entry. **525 tests pass.**

## [0.50.0] - 2026-09-30

### Added

- **An approved internal link is now actually a link.** Reported plainly: the Opportunities panel offers internal links between related articles, and approving one did nothing. That was true, it was written down in two places — `seoAdapter.ts` said "Nothing downstream inserts these into the article body", and the table's own schema said the status could never be `inserted` because no code wrote a link — and the evidence was unambiguous: **ten approved links across six articles, and zero `href`s in those six bodies.**

  `internalLinks.service.ts` places them, one model call per ARTICLE rather than per link, because each successive call would see a body the last one had already changed.

  **Placement is the model's job, and measuring proved it had to be.** The obvious implementation is to find the stored anchor text in the body and wrap it. Against the real backlog that would have placed ONE of the ten: the anchor suggestions are target article *titles*, which do not appear in the source prose. Two of the accidental matches were fragments sitting inside headings, where a link has no business being. So the prompt asks the model to find the sentence already about the target and link words that are **already there** — it may not write a new sentence, because a new sentence is an unreviewed claim.

  **It refuses to link to a page a reader cannot open.** A draft's URL is a `?p=340` query permalink that 404s for anyone not logged in, so linking to one would manufacture broken links inside finished articles. The URL comes from `article_cms_links.external_url` — what WordPress answered with — never from a permalink structure Cynth guessed at. `is_default` is deliberately ignored when choosing among a target's links: the default connection here is a dead local install, so trusting that flag would have pointed every link at `everyfivedays.local`.

  **Three guards, because the expected change is a handful of characters.** A pass that returns a shorter article, or loses a `[[product:id]]` marker, is refused and nothing is saved. And a link is marked `inserted` only after the saved body has been read back and found to contain the URL — a link recorded as placed against an article that never got it is the exact failure this closes.

- **`npm run apply:links`**, with `--refresh` and a free dry run that says which targets are live, which are still drafts, and how many model calls a real run would cost.

  `--refresh` exists because of a trap found on the first real run: Cynth only learns a post's status when it pushes it, so an article published in WordPress afterwards is still recorded here as a draft — and a draft is what this refuses to link to. Three of the five "not published yet" targets were in fact live on the site. `--refresh` asks the CMS before deciding anything.

- **"Place approved links" in the Opportunities panel**, with the count of what is waiting. The hint beside it no longer says nothing is inserted into the article, because now something is.

### Fixed

- **Not placing a link is a legitimate answer, and no longer reads as a failure.** Two of the first five attempts came back with no link and both were right to: the opportunity finder had matched those pairs on shared thematic vocabulary and said so in its own reason — *"No matching phrase exists in this article yet, so the anchor text would need to be written in."* The pass forbids writing text in, so the model correctly declined. Those now return as `held` with that explanation instead of a `provider_error`.

  The alternative — appending a "Related reading" list — was rejected because the site already renders exactly that automatically from the post's category, through `[efd_related_articles]`. A second, worse copy inside the body is not an improvement.

- **A script that makes model calls must load the secret store.** `apply-internal-links.ts` reached the spend gate and failed with "No API key is stored", which reads like a missing key rather than an unloaded one — the key lives in `.env.local` and only the server was calling `loadSecrets()`. It cost a run of five articles to find out.

**Result**: 6 links placed across 4 articles, every one on words already in the prose and mid-article — `laptop-only setups`, `Creatine monohydrate`, `a box and a raised seat`, `around eye level`, `paid subscription`, `caffeine and L-theanine combination`. 2 links held on a target that has never been pushed to the site; 2 declined because the article genuinely never discusses the target. **519 tests pass**, 10 of them new.

## [0.49.0] - 2026-09-30

### Changed

- **EveryFiveDays' category names are now the single vocabulary.** Cynth and the site had drifted and only two of the five matched — `Cognitive Performance` against `Cognitive Performance & Nootropics`, `Fitness Technology` against `Fitness Tech & Biohacking`, `Productive Workspaces` against `Productive Workspace Setups`. The site's names are the ones a reader sees, so they win. `npm run align:themes` renamed the three thematic areas, and `normalise:categories` moved all 34 products with them — which is exactly the behaviour that script was built for.

  **This replaced a translation table I had already written.** Mapping WP category slugs to Cynth category names would have worked until somebody renamed one side, and then rendered nothing on the pages it no longer matched — an empty section reads as a section nobody filled in, not as a bug. One vocabulary cannot drift from itself.

  Renaming is safe referentially: articles, products and themes are joined by id, never by name. Cynth does not set WordPress categories on push, so nothing in the CMS path depends on the old names.

### Added

- **`[efd_picks]` reads its own category.** On a category archive it shows that area's picks; on the home page or blog index it shows every area's. One shortcode serves all seven pages, so nothing has to be kept in step by hand. `category="all"` forces the combined row on a category page, and a named `category` still wins anywhere.

  An entity-encoded category name is decoded before matching — WordPress stores "Sleep &amp; Recovery" and the product meta holds the plain characters, so comparing them raw would match nothing.

**Verified**: 16 checks against a stubbed WordPress, covering the row/scroll switch, category filtering, context detection, the entity decode, the `all` override, the limit, unticked products never appearing, and `rel="sponsored nofollow"` surviving. **509 tests pass** on the Cynth side.

## [0.48.0] - 2026-09-30

### Added

- **Editor's picks are chosen in Cynth and rendered by the site.** The category pages carried fifteen hardcoded product cards — five groups of three, one per thematic area, every one of them rendered on every category page, so Smart Pet Care showed a rowing machine and an office chair. None carried an `id`, so none resolved against the registry: no image, no affiliate link, no button. They were mockup furniture from the original build.

  A **Editor's pick** checkbox on the product form sets a flag that rides along on the registry push. `[efd_picks]` reads it: with a `category` it renders that area's picks, without one it renders every area's for the home and blog pages. The decision lives in Cynth because it is editorial and made while looking at the product — and because a flag held only in WordPress would be overwritten by the next push.

  **No cap.** The three in the original design was a layout decision, from the build spec: *"the picks rows put three cards side by side at roughly 370px each."* Not an SEO rule — there is no such rule. Three or fewer lay out as the row the design was drawn for; four or more scroll horizontally, so ticking a fourth widens the row instead of stranding one card on a second line.

  An area with nothing ticked renders **nothing**, not an empty row: a blank section on a live page reads as broken.

  Verified against a stubbed WordPress with `php -l` and a fixture harness — 11 checks covering the row/scroll switch, category filtering, the limit, unticked products never appearing, and `rel="sponsored nofollow"` surviving.

- A save that does not mention the flag **leaves it alone**, so any other form or script cannot silently unpick a product and empty the row over time.

### Fixed

- **Four test files pointed at the wrong environment variable and wrote to the real database.** `CYNTH_DB_PATH` is silently ignored — the variable is `CYNTH_DB_DIR` — so `featuredPick.test.ts` created **20 fixture products** (#45–#64: "Litter Box", "Pet thing a"…) in the live library across two runs, and `publicationMarket.test.ts` left two empty settings rows behind.

  Caught because the registry export suddenly reported 54 products and 16 editor's picks against a library of 34 with none ticked. Removed, with a snapshot taken first; none of the fixtures had been linked to an article. All four files now set `CYNTH_DB_DIR`.

**Tests**: 509 pass, 6 new.

## [0.47.0] - 2026-09-30

### Changed

- **Product categories are the five thematic areas, and the form fills them in.** The Category field was a free-text box sitting beside a Thematic Area dropdown, and the two said the same thing — so the box collected variants of the dropdown's own answer: "Pet Product", "Pet Products", "Pet Device", "Pet device", "Pet Treats", "Pet treats", "Sleep Gadget", "Sleep Gadgets", "Cognitive Performance", "Cognitive Permance". **Seventeen categories for thirty-four products**, all of them listed in the filter.

  Category is now a select of the thematic areas, placed below the thematic area because it follows from it, and choosing an area sets it. It does not overwrite a category deliberately made different — only one that is empty or still matches the area it was following, because changing the theme should not quietly undo a considered choice. A value from before the list settled stays selectable, so editing an old product does not silently re-file it.

  `npm run normalise:categories` collapsed the existing thirty-four: **32 changed, 17 categories down to 5.** Every one derived from the product's thematic area rather than by matching the old text, because the area is a real reference to a real row and the text was always a paraphrase of it. Unthemed products fall back to matching the old text against the area names; anything still unresolved is left exactly as it is. The names are read from the themes table, so renaming an area and re-running moves its products with it.

### Note

Two rows the migration deliberately did not decide for anybody:

- **#16 "Petmate Basic Open Plastic Cat Litter Pan"** has its thematic area set to **Sleep & Recovery**, so the rule gave it that category. The category now matches the area; the area itself looks wrong.
- **#22 "RingConn Gen 2 Smart Ring"** has no thematic area and its old category "Fitness Tech" is not an area name, so it was left untouched and is the one value outside the five.

Fixing either means setting the thematic area and re-running, which is one command.

**Tests**: 503 pass.

## [0.46.0] - 2026-09-28

### Added

- **SEO findings can now be applied to the article.** Reported plainly: the Findings panel lists warnings and recommendations and there is no way to correct any of them. That was true, and deliberate — approving a finding recorded a decision and changed nothing, because nothing in Cynth could edit a written article. `PUT /articles/:id` edits the brief, never the prose, and the only thing that had ever rewritten a body was the pipeline's single automatic revision.

  On one real article, **13 of 17 findings needed body edits**: seven FAQ answers too thin to be quoted, an answer buried in a 631-word section, an empty FAQ heading, a missing definition sentence, and a target query that never appeared in the prose. Every one was unactionable.

  **All of them are applied in ONE model call.** Sent one at a time they would cost thirteen times as much, and — worse — each call after the first would be editing an article the previous one had already changed, so a later fix could quietly undo an earlier one. The findings go over as a single specification, the same shape the reviewer's specification uses.

  Deliberately excluded: metadata findings, which already have a path that writes the field directly, and findings Cynth itself answers with "no action required" — sending those would ask a model to fix something nobody thinks is broken.

  One instruction earns its place. Several findings ask for a passage to be *longer*, and a model told only that will restate what is already there — satisfying the word count and making the article worse. So it is told what "longer" must consist of (a reason, a number, a worked example, a caveat) and reminded that merging into a neighbour is the alternative the finding itself offers.

  Paid, editor-triggered, and outside the pipeline's one-revision cap — which governs what Cynth does on its own, not what an editor asks for. Product markers are preserved, and the rewrite is held to the author's voice for the same reason the editorial revision is.

### Note

Article length is not an SEO factor, so the templates' "hard ceiling" stays advisory. Worth knowing what it currently means in practice: every article in the library exceeds its template's stated maximum, by 4% on the newest and up to 87% on the longest.

**Tests**: 503 pass, 4 new.

## [0.45.0] - 2026-09-28

### Fixed

- **A writer that skipped the article was recorded as a success.** Opus 5.5 returned ONE section of the nine its template requires — syntactically perfect JSON, correct title, correct excerpt, `faq: []`, `sources: []`, a single hero paragraph — and the stage passed. **2,028 output tokens in 30 seconds, where the same template draws 7,000–10,700 in 110–156 seconds on Opus 5.** Nothing was truncated; the model closed the object properly and stopped.

  It surfaced only downstream, as a reviewer producing an unusual volume of corrections, and an editor noticing the reviewer was working too hard. Templates have always carried a `required` flag per section. Nothing read it, and the only check was that at least ONE section came back — which one did.

  The writer stage now fails a reply that omits required sections, naming them, so the run stops cheaply instead of carrying a one-paragraph article through a full review.

  **The first version of this check would have rejected every good article in the library.** Run against articles 33, 35 and 36 before shipping, it flagged all three for a missing `faq` section: they deliver the FAQ as a top-level `faq` list, which is the correct shape and always has been. A required section is now satisfied by its own field where it has one. Found by checking real data, not by a test.

### Changed

- **`article_writer` and `topic_research` reverted to `claude-opus-5`.** Opus 5.5 is newer and 20% cheaper, and on the one article it wrote it produced a quarter of the expected output. One sample is not a verdict on the model, but it is enough to stop using it on articles: Opus 5 has six clean runs behind it.

- The `article_generation` and `seo_review` capability defaults stay on Sonnet 5 — those feed manual generation and the SEO audit, not the pipeline.

### Note

Three existing tests planted damage by removing a section from the writer's reply, then checked final validation blocked it at the end — the same path production took. Two were rewritten to plant the damage on the stored article instead, which is how it can still happen (the revision stage parses without a template, and a human can edit in the app); the third now uses an unresolved placeholder, which is damage that genuinely survives to validation. The guarantees were restated, not dropped, and two new tests cover the writer's refusal.

**Tests**: 499 pass, 7 new.

## [0.44.1] - 2026-09-28

### Fixed

- **The model changes in 0.44.0 were being made to the wrong system.** Cynth resolves models two ways: the `article_generation` capability, used by the standalone generation path, and `pipeline_role_models`, used by the pipeline that actually writes the articles. Three successive reassignments of the `article_generation` default — Sonnet 4.6 to Opus 5.5 to Sonnet 5 — never touched what writes an article. The writer had been `claude-opus-5` throughout.

  This is the capability/default trap from Milestone 15 in a new place: holding a capability, and being *the model a stage runs on*, are different facts, and a reassignment that looks like it landed can land somewhere else entirely. Worth stating in full because three changes were reported as done and none did what was intended.

### Changed

- **`article_writer` and `topic_research` moved from `claude-opus-5` to `claude-opus-5.5`** — $4/$20 against $5/$25, so newer and 20% cheaper than what was running. These are the two roles Cynth's own metadata marks "Highest quality": the writer produces the prose, and topic research decides what gets written at all.

- **The reviewer and revision roles are deliberately left on `gpt-5.6-sol-pro`.** The role definition asks for "preferably a different model family from the writer", and a same-family reviewer rationalises the blind spots it wrote with. Reviewing Claude's prose with GPT is the design, not an oversight.

- The 0.44.0 reassignments stand where they land: manual generation and SEO analysis both run Sonnet 5 at $2/$10, against Sonnet 4.6's $3/$15.

## [0.44.0] - 2026-09-28

### Changed

- **The writer is now `anthropic/claude-sonnet-5`**, replacing `claude-sonnet-4.6`. Opus 5.5 was assigned first and then reversed on the numbers. Worth stating plainly, because the reason given for the switch was efficiency: Opus 5.5 is **cheaper than previous Opus releases** ($4/$20 per million against Opus 5's $5/$25) but **33% more expensive than the Sonnet 4.6 it replaces** ($3/$15). Articles have a length band, so output tokens are roughly fixed and the bill rises with the price. The trade is quality for cost, not cost for cost. `claude-sonnet-5` sits at $2/$10 — newer AND a third cheaper than 4.6 — and that is what the writer runs on: **a third cheaper than the model it replaced, not a third dearer.** Opus 5.5 stays registered and unassigned, one click away. **SEO review moved to Sonnet 5 as well**, so every paid text stage is now a third cheaper than it was this morning; Sonnet 4.6 is no longer assigned to anything.

### Added

- **Words can be allowed into an image.** The no-lettering rules were written for models that cannot spell, and they cost far more than the clause they enforce: no book facing the camera, no labelled packaging, no paper in frame at all, no marked casing on any device — most of what a product publication would naturally photograph. `allowText` lifts the image model's clause and the director's scene rules **together**, since lifting one without the other changes nothing. The printed-matter guard stands down too, rather than re-rolling a scene for saying "label". Off by default.

  One rule does not lift: a real brand name or logo. That is a claim about a product, not a rendering problem, and no model's competence excuses it. A test asserts it survives.

- **The image model is choosable per article.** A picker on the Featured Image panel lists every model with the image-generation capability, defaulting to the assigned one. Previously the only way to try another model was to reassign the global default.

- **Nano Banana Pro and GPT-5 Image are registered**, disabled as defaults. Bake-off on one scene: Seedream 4.5 $0.04 at 3642×2048; Nano Banana Pro $0.135 at 1376×768 — better atmosphere, 2.6× fewer pixels, 3.4× the price. **GPT-5 Image cannot produce 16:9 at all** (1:1, 3:2, 2:3 only) and rejected the request outright.

**Tests**: 492 pass, 3 new.

## [0.43.0] - 2026-09-28

### Fixed

- **An article priced an entire buyer's guide in pounds.** "£300–£600" in the headline and 67 more pound figures through the body, for a publication whose readers are in the United States. Nothing had ever told the writer where its readers live: the brief carried an audience, a theme and a topic, the topic happened to be typed with a pound sign, and every stage downstream followed it without question. A scan of all eleven articles found it in exactly one — the rest already used dollars — so this was one topic's phrasing propagating, not a systemic default.

  **Re-denominated one-for-one, not converted.** The article is built on round figures and a running total that has to keep adding up; a real exchange rate would have produced $380–$760 and destroyed both. The database was snapshotted first (`cynth-backup-2026-09-28-pre-currency.db`).

### Added

- **The publication's market and currency are now stated to every stage that writes prose.** `publication.market` and `publication.currency` are settings, defaulting to the United States and US dollars, injected into the writer's and reviewer's briefs. Written as a positive instruction with its exception spelled out — a product sold only outside the market keeps its own currency and is named as such, rather than being silently relabelled — because "do not use pounds" invites a model to think about pounds and says nothing about euros.

**Tests**: 489 pass, 3 new.

## [0.42.0] - 2026-09-28

### Added

- **`npm run export:registry` writes the EveryFiveDays product registry from Cynth.** The site's registry wins over an article placement for the affiliate URL and the image — deliberately, so a changed link is fixable in one place — but the only thing that could fill it was a script that reads a WordPress install. Nothing created entries from Cynth, where products are actually maintained, so **11 of 22 products had no registry entry** and their cards published with no picture. The exporter writes `products/registry.json` and stages the image files; `deploy.mjs products` remains the only thing that talks to the server.

  Two deliberate behaviours: it **omits empty values**, because the importer writes every key it is handed and blank `efd_image_url`/`efd_image_id` would erase the picture from every product already live; and its dry run **compares only the keys it sends**, because comparing whole objects called all twelve existing products "changed" over a difference that writes nothing.

- **PHP 8.3.35 installed** at `C:\tools\php` from the official Windows zip, SHA-256 verified against the vendor's published checksum. No installer, no PATH entry, no admin rights. `efd-site.php` now lints clean, and a reflection harness exercises its vendor derivation against 13 real cases — verification rather than inference.

### Fixed

- **`import-product-images.php` pointed at a path that no longer exists** — `C:/Users/MetaWaste/Desktop/CLAUDE/CYNTH/database/`, from before OneDrive's Known Folder Move. It would have reported "no images" rather than failing, so the staleness was invisible.

- **`deploy.mjs` looked for manifest images only in the local WordPress uploads folder**, which is the wrong place for images that come from Cynth. It now prefers `products/media` beside the manifest, so a repo-only export never writes into a running install.

**Tests**: 486 pass.

## [0.41.1] - 2026-09-28

### Fixed

- **Cynth's own preview card said "Check price" for every product**, unconditionally, while the published card names the retailer. A preview that behaves differently from the thing it previews teaches the editor the wrong expectation. It now uses the same rule, from a small client-side copy of the vendor logic — deliberately duplicated rather than shared, because the two builds have no module boundary today and the cost of drift is a label in a preview, never a wrong link.

## [0.41.0] - 2026-09-28

### Fixed

- **Every product button on the site read "Check price" instead of naming the shop.** Nothing was wrong on the site: its shortcode maps `vendor="amazon"` to "Shop on Amazon" and falls back to a neutral label for a retailer it cannot name, which is correct in both directions. **Cynth never sent a vendor.** The `products.vendor` column existed, the card renderer read it, and a comment there claimed the value was "derived from a URL host" — but nothing had ever written to it. All 22 rows were NULL, so no card carried the attribute and every button took the fallback.

  The retailer is now read from the host of the affiliate URL, which is the one authoritative statement of where a reader is being sent. The URL is parsed and nothing else — not rewritten, not canonicalised, not appended to. A host that identifies no shop (a shortener, an affiliate network, an IP) yields nothing and the card carries no vendor, because a wrong shop name on an affiliate button is worse than a neutral one.

### Added

- **Cards name any retailer, not just the ones the site knows.** Two attributes go out: `vendor`, the slug the site's map is keyed by, which brings the retailer's styling; and `cta`, the exact wording — *Shop on Argos* — so a shop the site has never heard of is still named on the button without anybody editing a map first. Display names come from the domain, with a short correction map for the ones title-casing gets wrong (Best Buy, eBay, AliExpress, B&H Photo, John Lewis).

- **The site derives the vendor too, for articles already published.** New pushes carry the attributes; already-published articles cannot, because their shortcodes predate the fix and Cynth refuses to rewrite the body of a published post. `efd-site.php` now falls back to the host of the `url` attribute it already receives, so live cards start naming their shop with nothing re-pushed. **This file needs uploading to Hostinger** — until then the live buttons are unchanged.

- **Startup backfill.** 21 of 22 products filled; the one with no affiliate link correctly stays null.

**Tests**: 486 pass, 9 new. One test was restated rather than deleted — it asserted that a null vendor produces no attribute, which was the defect itself.

## [0.40.1] - 2026-09-27

### Fixed

- **Generating again destroyed the previous candidate.** Asked to see the earlier suggestion for an article to compare the two, it no longer existed anywhere on disk — `generateFeaturedImages` deleted the last batch before writing the new one. That was right when a batch meant three renderings of one idea, and wrong the moment each generation became a deliberate, paid attempt at a *different* idea, which is exactly what the new free-preview loop encourages. Exactly one batch back is now kept and shown as **Previous suggestion**, with its own *Use this one instead*. A kept image is selectable, so preferring the earlier idea costs nothing; *Discard all* takes it too, because discarding should mean discarding.

**Tests**: 477 pass, 2 new.

## [0.40.0] - 2026-09-27

### Fixed

- **The art director was photographing the topic, not the argument.** Reported after three paid generations for an article about three years of subscription fees and what stops working when you cancel. Sampled three more times through the free preview, it returned the same picture each time: *a pet feeder beside a ceramic bowl, a phone face-down*. Nothing random about it — there is no object that means "thirty-six monthly payments", and a director told to choose one real physical scene can only point at the nearest thing. Retrying could never have fixed it.

  It is now told what to do when an argument has no physical form — a cost mounting, two options compared, a service that degrades — which is to show the **consequence**: the moment it reaches a person or an animal, the waiting, the going-without. Plus the tell: *if you find yourself placing the subject on a table because nothing else comes to mind, you are photographing the topic rather than the argument.* Re-sampled afterwards, all three scenes found the article's own strongest line — "a feeder going dark is a dog who didn't eat" — and put the dog in frame.

- **The publication had developed its own cliché.** Across eight articles in one day: a backpack on a kitchen table, a wristband on a nightstand, powder on a counter, a feeder on a counter, a tracker on a counter. Each defensible alone; together, one photograph printed five times. Now named in the banned list.

### Added

- **Suggest a scene (free), then draw the one you chose.** `GET /prompt` and `POST /generate` each ran the director, so the scene an editor read was never the scene drawn — which is what made "try again" a four-cent lottery. Generation now accepts a `scene`, and given one the director does not run at all. The panel offers **Suggest a scene (free)**, **Draw this scene** and **Suggest another**: ask as many times as you like for nothing, pay once for the one you picked. The printed-text check still runs on a supplied scene — skipping the director must not skip the guard.

**Cost**: $0.08 for two images. **Tests**: 475 pass, 3 new.

## [0.39.1] - 2026-09-26

### Fixed

- **Marking an article published removed it from Cynth.** Reported as an article that "isn't present on CYNTH" — it was there the whole time: 9,514 characters, written on 2026-09-14, with a featured image attached. `DraftsPage` is the only page that lists articles and it asked for `status: 'draft'` and nothing else, so with exactly two statuses in the system, publishing an article made it unreachable except by typing its URL. The page now offers **Drafts / Published / All** and is titled Articles; the server already supported the filter.

**Not a bug**: a published post that went back to draft on the live site did so because it was switched to Draft in WordPress, not by Cynth. The push history shows Cynth refusing the update first (`remote_post_published`), which is the guard working — it has no publish or unpublish operation at all.

**Not a bug**: a title reading `Â£300â€"Â£600` through `curl` is clean UTF-8 in the database (`£` U+00A3, `–` U+2013). Terminal encoding, checked by codepoint before reporting.

## [0.39.0] - 2026-09-25

### Added

- **A featured image can now be sent to an article already published.** Reported as "there's no image for the laptop ergonomics article" — and in Cynth there plainly was one. On the live site, `featured_media: 0`. Nothing was broken: the article was pushed, the image was chosen afterwards, and **there was no path**. Every write the WordPress connector makes to a post restates `status: draft`, the invariant the module is built around, so a published article could only have been given its picture by being unpublished first. Four live posts were in that state — three with no image, two still carrying pre-Milestone-40 images including the floating brain.

  `pushFeaturedImage()` follows `pushSeoMetadata()` exactly, for the same reason: **a featured image is not the article's content** — it changes no word a reader reads. It uploads the file, points `featured_media` at it, and sends **no status at all**, which is precisely what makes it safe: WordPress then leaves the post's own status alone. A test asserts that no status, title, body, slug, excerpt or author is ever sent on this path. A *Send this image to the site* button sits under the attached image.

- **Illustration mode.** `style` is now `photograph` (default) or `illustration`, with a switch on the Featured Image panel. Illustration swaps the camera clause for a drawing clause and tells the director that thought bubbles, cutaways and comparisons are available — the things a camera cannot photograph.

### Fixed

- **The director was quietly overruling the editor.** Asked for a person with a thought bubble above their head, it produced "their gaze raised toward a band resting on the windowsill" — its own preference for the photographable, over the instruction it was given. The steer is now stated as binding, and a test asserts it reaches the prompt with that wording.

- **An empty answer from the director cost four cents.** The free model returned an empty body, the director threw, and the article fell through to the deterministic fallback — which spent $0.04 on "a quiet environmental photograph suggesting the setting of…", with "no people in focus" contradicting the editor's request for a person. Retrying costs nothing, so it now retries, and falls back only if three attempts come back empty.

- **The WordPress test harness asserted the wrong invariant.** Its fake server demanded `status === 'draft'` on every post write, which would have rejected the metadata-only paths for doing the one thing that makes them safe. The rule is that Cynth never writes a status *other than* draft, and may write none.

**Correction**: an earlier note here claimed a photograph cannot carry a thought bubble. It can — a photo-illustration with a drawn bubble is ordinary editorial practice. Both styles now produce that composition; illustration mode is for ideas with no physical referent at all.

**Cost**: $0.12 for three images. **Tests**: 472 pass, 6 new.

## [0.38.1] - 2026-09-25

### Fixed

- **Twelve real images found five faults the prompt review could not.** Milestone 40 shipped with "no image has been generated with the new prompt yet" as a stated limitation. Generating them produced: gibberish lettering on book spines (a scene built from text-bearing objects, which `NO_TEXT` cannot save); "a thin silver ring" drawn twice as a **wedding band on a pillow beside a sleeping person**, which as a photograph is an article about a marriage ending; then, after the fix for that, a studio-lit smartwatch beside a phone on a bare nightstand — no logo, and unmistakably one company's hardware shot the way that company shoots it; and an appliance with the **invented brand name "Smatter"** printed on it beside half a frame of mirrored gibberish.

  Four new director rules follow, each from one of those images: lettering may not face the camera; name an object by its shape and material, not only its category, because an image model draws the most common thing a word can mean; a device may appear but never as the display piece — *if the frame would work as a shop listing, it is the wrong frame*; and hands stay simple, never mid-fine-manipulation, after "two hands, one calloused, one clean, reaching as if unclipping it" produced two arms belonging to nobody.

- **The no-lettering rule is now a check, not a hope.** The "printed subscription sheet" scene came from a director that had been told twice, in the same prompt, not to put lettering in frame. `findTextRisk()` now reads the chosen scene for words that carry print and asks the director again — naming the exact phrase it wrote — up to three times, **before any image is paid for**. Asking again is free; the image is four cents. The word list is deliberately short, because a check that rejects good scenes costs a good photograph every time and is invisible when it does: bare `sheet` is excluded (it would reject a bedroom scene every time), `paper` is included except for towels, bags, clips, cups and napkins. If all three attempts still carry print, the scene is used and the brief carries a `concern`, so a garbled image is traceable rather than mysterious.

- **"Worn" was compounding into squalor.** Grimy tiles, peeling laminate, stained pillowcases, sediment in a water bottle. The camera clause said "slightly imperfect", meaning unstyled, and got unclean; the director was told a *worn* thing on a kitchen table says more than a studio composition, and took it literally. The clause now reads "everyday wear — clean, not styled", the director is told lived-in means used and not neglected, and the word "worn" is no longer suggested to it.

### Changed

- **Featured images now default to one candidate, not three.** Seedream 4.5 returns a single image per request whatever `n` says, so the old default promised a choice the provider never delivered — and now that the director chooses the scene, extra candidates are the same scene redrawn rather than competing ideas. On a provider that does honour `n`, three would be three charges for three near-identical photographs. The control still offers up to four, and the panel now says that some models return one image however many you ask for.

- **The cost confirmation names the number actually drawn.** It read `MAX_CANDIDATES`, so an unspecified count asked the editor to approve four images and then drew one.

**Cost**: $0.48 for twelve images at $0.04. **Tests**: 466 pass, 4 new.

## [0.38.0] - 2026-09-25

### Fixed

- **Featured images were generated by asking a diffusion model to make an editorial decision.** The prompt was a specification document — headed sections, a style list, a block of HARD RULES — handed to an image model. Three faults followed, all visible in the output: diffusion models weight tokens rather than parsing documents, so half the prompt diluted the subject; the prohibitions were **negations** ("do not depict any product, brand, logo, packaging or trademark") aimed at the one component with no reliable NOT operator and no negative-prompt parameter; and nothing decided what to *draw*, leaving "evoke the subject" to a model that resolves it with the nearest cliché.

  The results: **"Creatine for Cognition" produced a floating brain dissolving into blue particles**, and **"How to Make a Laptop Workspace Ergonomic Without Spending Much" produced a premium standing desk with an external monitor and an ergonomic chair** — technically clean, and the exact opposite of an article about spending nothing. The article's content never reached the prompt at all, only its title and theme, which is why it could not know.

  **The fix is a two-stage pipeline.** A new `image_direction` stage has a *text* model read the article and choose one concrete scene; the image model photographs that scene and is never asked to interpret anything. The director is told the image must agree with what the article *argues*, not just its topic, and is given eight clichés **by name** — a generic "avoid clichés" does nothing, because the model does not know which ones it reaches for.

  **The constraints were not relaxed; they moved to a stage that can honour them.** "Do not name a real product" is trivial for a language model and nearly meaningless to a diffusion model, so the image model now receives no prohibition list at all — a test asserts it has not come back. One negative clause is kept: *no text*, because unlike a brand it cannot be prevented upstream — a scene can be entirely text-free and the model will still invent a sign.

- **The spend gate now runs before the director.** Choosing a scene is a model call, so building the prompt first meant a refused image generation had still sent a request — breaking the guarantee that a refusal costs nothing and contacts nobody. Caught by an existing test.

**What it produces now**: the laptop article gets *"a laptop propped open on a stack of old paperbacks, elbows lifted off the table edge, a worn cushion behind someone's lower back"* — the article's own central recommendation. The litter-box guide gets *"a gray cat sits rigidly beside an automatic litter box, half in and half out… watching the unit with still, cautious eyes, not approaching"* — its actual argument, not a product beauty shot.

**Cost: nothing.** The director runs on the same free model as the search metadata.

### Verified by generating, which found one more defect

Two images were generated on Seedream 4.5 at $0.04 each. The first was a large improvement — a laptop raised on a stack of books on a worn kitchen table, the article's own recommendation, where the old image showed a premium standing desk — but the book spines faced the camera and the model rendered **gibberish lettering** on every one. That proved the `NO_TEXT` clause cannot work alone: telling an image model "no text" cannot save a scene built from objects whose identity *is* printed lettering. The director now carries the rule instead — books, packaging, labels and screens only where no lettering faces the camera, and a scene that only works with its lettering visible must be replaced.

The second generation confirmed the fix: same scene reframed with the book page-edges to camera, no lettering anywhere, and — unprompted — a separate external keyboard at the lower height with hands on it, which is the article's *second* argument. One image stating both halves of its advice.

**Also found**: Seedream returns one image per request regardless of `n`. A request for two produced one, billed as one.

**Tests**: 4 rewritten, 3 new, 462 total. The rewrites were necessary — three tests asserted the negation list was *in* the image prompt, which was the defect. They now assert the opposite, and that the constraints are present in the director's prompt instead.

## [0.37.0] - 2026-09-23

### Changed

- **The meta-description backfill became a search-metadata backfill, writing both fields in one call.** Adding a separate SEO-title backfill would have meant two near-identical services and two model calls per article for two facts derived from one reading of it. They are the same job — how an article presents itself on a results page — and writing them together is not only cheaper, it is the only way the title and description are guaranteed to agree rather than being written blind of one another.

  `writeSearchMetadata` asks only for what is missing, asks for an SEO title **only when the editorial headline exceeds the SERP limit** (below it the article title does the job and a second field is maintenance for nothing), refuses an article that needs neither, and **discards an over-long SEO title rather than truncating it** — the field exists because the headline is too long, so a truncated one defeats its own purpose.

### Added

- **Two buttons on the SEO panel**: *Write missing search metadata* and *Push SEO metadata to WordPress*. Their own row, because analysis only reports while these two write and send. Both features existed as API-only after Milestone 38.

### Run against the live data

**SEO titles**: 7 of 8 written first pass, every one 50-57 characters; the eighth failed because the model returned a title over the limit, which was correctly discarded rather than stored — a retry produced a good one. 8 of 8 now.

**Pushed to the live site**: 6 of 6, **five of them published posts** — the case the content-push path could never serve. Verified by reading the post meta back authenticated: every post carries both `rank_math_title` and `rank_math_description` and kept its published state.

### Also: the focus keyword backfilled for free

The Milestone 38 fix filled `article_seo.target_query` for new articles only, leaving the eight existing ones with nothing for Rank Math to grade. No model call was needed — the keyword stage had already written a `primary_keyword` for every one into the `keywords` table; the two tables simply never spoke. Copying it across under the same "fill a blank, never replace a decision" rule filled 8 and left 1 alone. All six live posts re-pushed and verified: **6 of 6 now carry title, description and focus keyword.**

**Tests**: 3 new, 460 total.

## [0.36.0] - 2026-09-23

### Added

- **The writer now produces an SEO title.** Measured on the nine real articles, **eight had titles longer than the ~60 characters a search result shows** — the longest was 100 — so eight of nine were being cut off mid-word in search. The editorial title is the H1 and can take the space it needs to be precise; the SEO title has 60 characters to earn a click. Two rules keep it honest: an over-long one is **discarded rather than truncated** (Cynth already falls back to the article title, so a bad SERP title is worse than none), and one identical to the headline is discarded too.

- **The pipeline fills the SEO target query, so Rank Math has a focus keyword to grade.** Rank Math scores a post against its focus keyword, which Cynth sends from `article_seo.target_query` — and **eight of nine articles had that NULL**, so Cynth sent none and there was nothing to grade. The cause was two features that never spoke: the keyword stage writes to the `keywords` table, the SEO engine reads `article_seo`, and nothing bridged them. The pipeline now fills target query, secondary keywords, semantic topics and audience from what the keyword stage already decided — free, and never over the top of a target query an editor set.

- **`pushSeoMetadata()` — metadata-only push, allowed on published posts.** Cynth refuses to modify published content, rightly, but that made SEO metadata useless on the articles that matter: five of six live articles were already published. A meta description is not content — no reader sees it on the page — so this path writes it without touching the article or its published state. Narrow by construction: the connector's `updateSeoMetadata()` builds a body containing `meta` and nothing else, so no code path in it can send a title, body, excerpt, slug or status. `POST /articles/:id/cms/push-seo`.

  **Proven live on both kinds of post**: 346 (draft) and 344 (**published**, still published afterwards, body unchanged at 3,545 words).

### Decided: the canonical URL stays empty

Asked to do what is best technically, and here that is nothing. For an ordinary post on one site the canonical is the post's own permalink, which Rank Math emits automatically. Writing one from Cynth would at best duplicate that, and at worst cause real harm — a wrong canonical tells Google to index a different page instead, which can remove the page from search entirely. It is worth setting only for syndicated content, which is a publishing-strategy judgement rather than something derivable from an article record.

### Not a bug: the HTML encoding worry

I flagged possible mojibake (`â€"`) in pushed content. Checked at byte level: the database holds 138 real em dashes and zero mojibake sequences, and the live page decodes as clean UTF-8 with 24 em dashes and zero mojibake. **The mangling was in my own terminal display, not in the content.**

### Worth knowing: Hostinger caches the rendered page

After a successful metadata write to post 344, the stored value was correct (verified by reading it back authenticated) while the public page still served the OLD description — `hcdn` serving cached HTML, which a `?nocache=` query string did not bypass. Verify this work by reading post meta over the REST API, not by scraping the rendered page, or a correct write looks like a failure.

**Tests**: 4 new, 457 total.

## [0.35.0] - 2026-09-23

### Added

- **Rank Math integration.** `cms/seoAdapter.ts` held a deliberately empty mapping registry from Milestone 14; it now maps Cynth's metadata onto Rank Math's four post-meta keys (`rank_math_description`, `rank_math_title`, `rank_math_canonical_url`, `rank_math_focus_keyword`). Only non-empty values are emitted — an empty string would overwrite something a human wrote in Rank Math's own editor. Which mapping applies is configuration, not assumption: a new `cms_connections.seo_target` column names the plugin per connection, and a null or unrecognised target selects no mapping and sends no plugin fields, exactly as before. A typo degrades to "no SEO fields", never to wrong ones.

  **Worth knowing what Rank Math was already doing:** a live post already showed a meta description — which was *Cynth's excerpt, verbatim*, via Rank Math's default `%excerpt%` template. So this does not add a description where none existed; it replaces a listing blurb with copy written for a results page.

- **A meta-description backfill, on a free model.** A new `meta_description` model purpose that reads a finished article and writes one description. It routes through the Model Router, passes the same spend gate, and **never overwrites a description that exists** — which is what makes running it over everything safe. Run over all nine existing articles: **9 written, 0 failed, no cost**, every one between 127 and 159 characters.

- **`docs/rank-math-rest-meta.php`** — the mu-plugin the WordPress side needs. Rank Math does not register its meta keys with `show_in_rest` (verified: `GET /wp-json/wp/v2/posts?_fields=meta` returns only `footnotes`), and **WordPress silently drops unregistered meta keys** — a push that looks like it worked and changed nothing. The file registers only the four keys Cynth writes, requires `edit_post` to write them, and reads or changes nothing. Until it is installed, the mapping produces fields WordPress ignores.

### Fixed

- **Meta descriptions were cut mid-word at the character limit.** The cleaner ended in a hard `slice(0, 160)`, producing *"…when the tracking itself becomes count"* — broken rather than shortened. It now prefers the last complete sentence that fits, falls back to the last whole word, and strips a dangling comma or hanging conjunction. The three affected descriptions were cleared and rewritten.

### A decision recorded: the free model is NOT the default for new articles

The writer already produces a meta description for nothing — one more field in a call already being made — and it has just read the whole article, where the backfill model sees the title, excerpt and first 700 words. A separate pass adds another request, timeout and rate limit to replace something that already works, and free models here have a record of returning empty. The right shape is the one built: **the writer produces it by default; the free-model pass repairs anything that lacks one.**

**Tests**: 5 new, 453 total. One existing test was rewritten rather than deleted — it asserted the mapping registry was empty, which was correct while no stack had been chosen; the guarantee it protected is now stated directly instead.

## [0.34.0] - 2026-09-23

### Added

- **Every generated article now writes its own meta description.** `article_seo.meta_description` was previously reachable only by typing it into the SEO screen by hand — no stage wrote one, and it was NULL on all nine generated articles in the live database. The writer now produces it, because the writer is the only stage that has read the finished article and because it costs nothing: one more field in a call that already happens. The prompt is explicit that it is not the excerpt reworded — the excerpt is a listing blurb for someone already on the site, a meta description has to earn a click from a results page. Two rules hold it honest: nothing invents one downstream (an omitted description stays empty rather than being fabricated), and **a human-written description is never overwritten** by a regenerate or a revision.

### Fixed

- **A pipeline-generated article had no slug until the server restarted.** `refreshSlug()` is correctly called by the manual generation path, but the pipeline's own `saveArticle()` wrote the title without it — so the only thing that ever assigned a slug to a pipeline article was the startup "articles that predate slug support" backfill. That masked the bug on older articles and left the newest one with a perfect title and `slug = NULL`, which is what the ranking check reported. `saveArticle()` now refreshes the slug, so it exists the moment the article has a title. (The slug is the URL handle — `everyfivedays.com/automatic-litter-box-buyers-guide/`. Without one, WordPress invents its own and the URL is decided by the CMS rather than the editor.)

### Known gap — the push, which is not a Cynth limitation

**Cynth cannot yet send a meta description to WordPress.** WordPress core has nowhere to store one; it lives in whichever SEO plugin the site runs, under that plugin's own post-meta keys, and Yoast, Rank Math, SEOPress and AIOSEO all differ. `cms/seoAdapter.ts` has held a deliberately empty mapping registry since Milestone 14 for this reason.

Checked against the live site: `everyfivedays.com/wp-json/` lists **no SEO plugin namespace** (only oembed, novamira, duplicator, elementor, image-optimizer and xpro), and the homepage head contains **no `<meta name="description">` and no `og:description`** at all. The site publishes no meta descriptions from any source today. Cynth now has the text; there is nowhere on the site to put it until a plugin is chosen — at which point the work is one `SeoFieldMapping` and nothing else in Cynth changes.

**Tests**: 3 new, 448 total. The first asserts the meta description is *not* equal to the excerpt, which is the failure this would most likely regress into.

## [0.33.0] - 2026-09-13

### Fixed

- **The writer was given only the short product description, never the long one.** `generationContext.service.ts` resolved the two fields as `shortDescription ?? description`, so a product with both — the normal case, since research fills both — sent the short one and silently discarded the full one. Measured on the four products of the live litter-box article, the writer received **991 characters of description and lost 3,431**: roughly four and a half times more than it got. The long description is where the specifics live — capacities, materials, dimensions, compatibility — which is exactly the detail that separates a useful product paragraph from a vague one.

  The two fields are now carried apart, because they are not two versions of the same text: `shortDescription` is the editor's summary line written for a card, `description` is the full detail. Both writer prompts (pipeline and the manual wizard) receive both, labelled `Summary:` and `Full description:`. The published card and the preview card both resolve `useCase ?? shortDescription ?? description` — a card wants the short text, and falling back to the long one would drop a wall of manufacturer copy into the middle of an article. The long description is not repeated under two labels when no short one exists, and the "nothing is recorded about this product" guard now considers both fields, so a product described at length in one field only is no longer labelled unknown.

  **Framing was added with the data.** A long description is usually the manufacturer's marketing copy — simultaneously the richest source of specifics and the most likely thing to drag advertising language into the article. The prompt now states that the description fields are source material rather than copy to reuse: take the specifics and state them in your own voice, never echo the phrasing or superlatives, and either attribute an unverifiable claim to the manufacturer or leave it out. Same principle as the affiliate URL rule — take the useful part of a retailer's data, explicitly refuse the part that would compromise the article.

**Cost**: about 850 extra input tokens for a four-product article, under $0.005, for 4.5x the product detail.

**Tests**: 3 new, 445 total. The first asserts on specifics that exist only in the long description (`210D ripstop`, `Rated to 18 kg`) rather than on the field label, so the test fails if the text stops arriving even when the heading remains.

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
