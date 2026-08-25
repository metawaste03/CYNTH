# Cynth — Where Things Actually Stand

*A plain-English handoff review, written for someone joining the project cold. August 25, 2026.*

> **Superseded in part, later the same day.** This review was written immediately before Milestone 9, and it names two things as the obvious next work: catching the changelog up, and wiring the Prompt Builder to a real AI provider call. Both have since been done. Cynth now calls a configured AI model and saves the generated draft, and the binder is current through Milestone 9. Read the sections below as an accurate description of Milestones 0–8, then read the Milestone 9 record in [13_MILESTONES.md](13_MILESTONES.md) for what changed and what its known limitations are. In particular, "there is no code anywhere that calls an actual AI model" and the description of the Editorial Review step's `ComingSoonButton` are no longer true of article generation.

## The one-paragraph version

Cynth is a desktop-style web app that's meant to help write articles for the EveryFiveDays website, with a human editor always making the final call. Right now it has a real, working foundation: a database, a way to manage authors and products, and a multi-step "New Article" form that saves your work as you go and builds a complete text prompt out of everything you've entered. What it does *not* have yet is the part most people would assume is the whole point: it doesn't actually call an AI model to write anything. There's no OpenAI or Anthropic key being used anywhere in the code. The SEO Review and Quality Gate pages exist in the navigation menu but are empty — literally just a title and a "not available yet" message. So think of it less as "an AI writer" and more as "a very solid intake form and records system that an AI writer will eventually be plugged into."

## What Cynth is supposed to become

Someone (the "Product Owner" in the project's own language) wants a tool where you pick an author, optionally attach a product, describe what the article should cover, and have the system draft something in that author's voice — which a human then reviews, checks for SEO basics, runs through a quality checklist, and manually publishes to WordPress. The AI assists; it never publishes on its own, and there's no plan for it to. That's stated over and over in the project's documentation as a hard rule, not a nice-to-have.

A few other ground rules worth knowing because they explain a lot of the code's tone: this is meant to be a single-person tool (no logins, no accounts, no multiple users), it's meant to run on one person's Windows computer rather than live on a server somewhere, and — this is the big one — nobody working on this project is allowed to invent requirements. If something hasn't been explicitly decided by the project owner, the code and docs are supposed to say "TODO" rather than guess. You'll see that pattern constantly: components and database columns exist, but with comments like "no AI analysis yet — pending real input."

## How the project is organized on disk

```
CYNTH/
├── docs/            Written documentation — the project's own paper trail
├── prompts/         Reserved folders for AI prompt text — still empty, on purpose
├── data/            Reserved folders for reference data — still empty, on purpose
├── app/
│   ├── client/      The website you'd actually look at (React)
│   └── server/      The backend that talks to the database (Node.js)
└── database/        The actual SQLite database file and uploaded images
```

The `prompts/` and `data/` folders looking empty isn't a sign anything's missing — it's intentional. Author profiles, products, and article types are all stored in the SQLite database instead, not as files in those folders. Those folders were part of an early plan that was superseded once a database got built.

## What's genuinely built and working

### The database
There's a real SQLite database (`database/cynth.db`) with nine tables: authors, author writing samples, products, product images, article types, articles, keywords, AI provider settings, AI provider models, settings, and a generation history log. SQLite means it's just one file sitting on disk — no separate database server to install or run. The database creates and updates itself automatically every time the backend starts, including adding new columns to old installations without losing data. This part is solid engineering.

### Managing authors
There's a full author management screen: a list you can search and filter, a detail page, and forms to create or edit an author. Each author can have a short bio, a described tone, a target audience, writing philosophy, preferred and prohibited phrases, and any number of attached writing samples. This is all just record-keeping right now — nothing reads these samples and analyzes an author's style automatically. It's a filing cabinet, not yet a stylist.

### Managing products
Same idea, for products that might get mentioned in an article (this looks like it's meant for affiliate-style content). You can create products with a title, brand, description, and "editorial fit" notes, and attach multiple images to each one, with one marked as the primary image. Images are stored as actual files on disk under `database/uploads/products/`, with only the file path saved in the database. Full create/edit/search/filter is done here too.

### The Dashboard
Shows live counts pulled straight from the database — how many authors, how many products, how many articles exist. Earlier in the project this was just fake placeholder numbers; that's been fixed.

### The "New Article" wizard — the most built-out piece
This is an eight-step guided form: Article Type → Author → Topic → Title → Keywords → Product → Content Brief → Editorial Review. You can leave partway through and come back later — every save writes to the database as a "draft," and reopening the same web address reloads exactly where you left off. The last step, Editorial Review, assembles everything you've filled in — the article type, the chosen author's whole voice profile and writing samples, the optional product, and all your content-brief notes — into one long, clearly labeled block of text called the "prompt." You can preview that assembled text on its own page.

Here's the important part: that's as far as it goes. The button that would trigger actual AI generation is, in the code, literally named `ComingSoonButton`. Clicking it just shows the message "Available in a future milestone." Nothing gets sent anywhere.

### AI Provider settings
There's a Settings screen where you can register AI providers (like "an OpenAI account" or "an Anthropic account"), give each one a name, a type, a default model, and register individual models under a provider for different purposes (e.g., which model handles article drafting vs. which handles SEO review). Sensitive API keys are deliberately kept out of the database — they're read from a local `.env.local` file instead, so a leaked database file can't leak credentials. There's also a "Test Connection" button, but right now clicking it does nothing except display a canned message saying connection testing isn't built yet. No API call is made.

### The Model Router
A small backend piece that answers the question "which provider and model is configured to handle this kind of task?" by looking it up in the database. It's a lookup table lookup, essentially — it never actually contacts OpenAI, Anthropic, or anyone else. It's the plumbing that a real AI-calling feature would use later, already built and waiting.

### The Prompt Builder
Worth calling out separately from the wizard: this is a backend piece that takes a saved draft and stitches together a complete, well-organized prompt (article details, author voice, product info, content brief, and a fixed set of instructions telling the AI to stay in the author's voice and to never present the result as publish-ready). It's pure text assembly — it builds the words but does not send them to any AI model. That's the wiring that's sitting ready for whenever "actually call the AI" gets built.

## What's explicitly not built yet

Two pages exist in the navigation menu — **SEO Review** and **Quality Gate** — that are, right now, nothing more than a page title, a short description, and an icon with the words "isn't available yet." No logic behind them at all.

Beyond that, there is no code anywhere that calls an actual AI model. No AI SDK (OpenAI's, Anthropic's, or anyone else's) is even installed as a dependency in the backend — you can confirm this by looking at `app/server/package.json`, which lists only `express` and `multer`. So "generate an article draft" is a feature that has all its supporting scaffolding in place (the prompt text, the provider settings, the model routing) but the actual "send this to an AI and get text back" step has not been written.

There's also no WordPress publishing integration, no authentication/login system (this is intentional — it's meant to be single-user), and no automatic or unsupervised publishing of any kind (also intentional, and treated as a hard rule rather than a missing feature).

## The one thing you should know before touching anything

The project's own written documentation — specifically `docs/13_MILESTONES.md` and `docs/CHANGELOG.md` — is out of date compared to the actual code. Those two files stop recording history at what they call "Milestone 5B," which only covers building the author/product screens and letting you pick an article type on a draft.

But the code itself is clearly further along than that. There's a whole Content Brief workflow, a Prompt Builder, full AI Provider management, and the Model Router — none of which appear in the changelog. The only place this later work is actually documented is a smaller, less formal file: `app/server/src/features/README.md`, which does mention this work by number ("Milestone 6," "Milestone 7," "Milestone 8"). In other words, real work happened, it just wasn't written back into the project's official record.

This matters for two reasons. First, if you're told "check the changelog to see what's been done," you'll get an answer that's noticeably behind reality — go look at the actual code and that smaller README instead. Second, this project takes its own documentation discipline seriously (it's rule #1 in `docs/04_DEVELOPMENT_RULES.md`: "no milestone should introduce a capability that isn't first documented"), so catching up `13_MILESTONES.md` and `CHANGELOG.md` to reflect Milestones 6, 7, and 8 is probably one of the first useful, low-risk things a new person could do here.

## The tech stack, in plain terms

The part you see in a browser is built with React — a popular way of building interactive web pages — written in TypeScript, which is JavaScript with some extra safety rails that catch mistakes before the code even runs. It's built and served using a tool called Vite. The backend is a Node.js server using Express, a simple, well-known way of handling web requests, also written in TypeScript. The two sides talk to each other over ordinary web requests (a REST API), the same basic mechanism your browser uses to load any web page. The database is SQLite, and notably it's using Node's own newer built-in SQLite support rather than installing a separate third-party database library — one less thing to manage. There is no design framework like Bootstrap or Tailwind; the styling is hand-written plain CSS with a small shared set of design tokens (colors, spacing, etc.) for consistency.

## Questions worth asking before you build on top of this

A few things stood out as still genuinely open, based on the documentation itself rather than any guesswork on my part: nobody has yet supplied EveryFiveDays' actual editorial standards (tone, accuracy rules, what's off-limits) — the "Editorial Constitution" document is a placeholder waiting on that. Similarly, nobody has defined EveryFiveDays' actual SEO targets, or what the Quality Gate should specifically check for, or which AI providers are meant to be supported at launch, or how the WordPress site is even hosted and authenticated against. All four of those are marked as open TODOs in the documentation, not implementation gaps — they're waiting on decisions from whoever owns the EveryFiveDays site, not on more coding.

## A reasonable starting point

If you're picking this up fresh, the fastest way to get oriented is: read `docs/00_PROJECT_VISION.md` and `docs/02_VERSION1_SCOPE.md` first (they're short), run both the client and server locally per `app/README.md` and click through the app yourself, then compare what you see against this document. After that, the two clearest next pieces of real work are (1) reconciling the changelog with what's actually built, and (2) wiring the Prompt Builder's output to an actual AI provider call — everything needed to do that already exists except the one line that sends the request.
