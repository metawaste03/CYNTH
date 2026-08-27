# WordPress Integration

## Purpose

This document defines how Cynth hands finished editorial work to WordPress, the platform on which EveryFiveDays is published.

## Scope

Covers the publishing hand-off from Cynth to a CMS, and the WordPress connector that implements it. It does not embed credentials, and it does not define SEO metadata (see [10_SEO_ENGINE.md](10_SEO_ENGINE.md)).

## Responsibilities

The WordPress integration:

- Receives an article only after a human has reviewed it in Cynth.
- Preserves author attribution as managed by the Author System ([07_AUTHOR_SYSTEM.md](07_AUTHOR_SYSTEM.md)), via an optional mapping to a real WordPress account.
- **Never auto-publishes.** Consistent with [00_PROJECT_VISION.md](00_PROJECT_VISION.md), publication is a human act performed in WordPress.

## Current Status

**Implemented (Milestone 13).**

### Architecture: a connector, not a WordPress engine

```
CYNTH
  ↓
CMS Connector          ← provider-independent contract
  ↓
WordPress              ← the first connector implemented
```

Everything upstream of a connector speaks only the types in
`app/server/src/features/cms/cms.types.ts`. Nothing in the publish service,
the routes, the repositories or the UI knows that WordPress exists — the word
appears only inside `connectors/wordpressConnector.ts` and in user-facing
labels. Adding Ghost, Craft, or a static-site generator means writing one
connector file and adding one registry entry, exactly as AI provider adapters
already work.

### The connector contract has no publish operation

This is the safety mechanism, and it is structural rather than procedural.
`CmsConnector` exposes `testConnection`, `createDraft`, `updateDraft`,
`getPost` and an optional `listAuthors`. There is no `publish()` and no
`setStatus()`. Cynth cannot publish to WordPress because no code path exists
through which it could, not because every call site remembers to avoid one.

Three further guarantees sit on top of it:

- Every write sends the literal string `draft`, taken from a module constant
  rather than from the payload, even though the payload's type already
  forbids anything else.
- An update to a post whose remote status is no longer `draft` is **refused**.
  Overwriting live content is not Cynth's decision, and asking for draft
  status on a published post would silently unpublish it.
- The test suite's mock WordPress asserts, per request, that every write it
  receives asks for a draft.

### Connection settings

Configured in **Settings → WordPress** (`/api/cms/connections`). A connection
holds a name, the CMS type, the site URL, an authentication method, a
username, an optional author mapping, active/default flags, and the result of
the last connection test.

- **The site URL is always configurable and never assumed.** No default, no
  localhost, no port. The same connection record works against
  `http://everyfivedays.local` today and a live HTTPS domain later; only the
  URL changes. Validation rejects a URL carrying a path, query or fragment,
  because Cynth appends `/wp-json` itself and silently trimming a mistyped
  path would surface as a confusing 404 much later.
- **Authentication is a WordPress Application Password** — a per-application
  credential the user creates under *Users → Profile → Application Passwords*
  and can revoke without changing their login. Cynth never asks for, stores,
  or transmits an account password.

### Credentials

Credentials are handled exactly as AI provider keys are, through the same
store (`shared/secrets/secretStore.ts`):

- The database records only the **name** of the environment variable holding
  the credential (`cms_connections.credential_env_var`), never the value.
- The value lives in the gitignored `app/server/.env.local` and is loaded into
  `process.env` at startup.
- One server-side function returns it, solely so the connector can
  authenticate its own request. It never reaches a DTO, a route response, a
  log line, the push history, or the database.
- The only fact any API exposes about a credential is `hasCredential: true|false`.
- Deleting a connection deletes its stored credential.
- CMS wording echoed back in an error is redacted before being shown or
  stored, including WordPress's five-groups-of-four application password
  format and any `Basic` header.

### Test Connection

`POST /api/cms/connections/:id/test`. Two reads; creates nothing, publishes
nothing.

It reports **which stage failed**, because these four problems have four
different fixes and collapsing them into "connection failed" wastes the
user's time:

| Stage | Meaning |
|---|---|
| `connection` | The site could not be reached at all. |
| `api` | The site answered, but its REST API did not, or does not expose `wp/v2`. |
| `authentication` | The site is fine; the username or application password was rejected. |
| `authorization` | The credentials work, but the account cannot create posts. |
| `ok` | Reachable, authenticated, and permitted to create drafts. |

The `authorization` stage exists because authenticating is not the same as
being allowed to post: an account without `edit_posts` would authenticate
cleanly and then fail at push time.

### Article → WordPress Draft

```
CYNTH Draft → Review → Push to WordPress → WordPress Draft → Human Review → Publication
```

Field mapping — only what Cynth holds an authoritative value for:

| Cynth | WordPress | Notes |
|---|---|---|
| working title, else the model's title | `title` | Generation never overwrites the working title |
| generated body | `content` | Rendered from Markdown to HTML — see below |
| `articles.slug` | `slug` | Cynth's own slug, derived from the title |
| — | `status` | Always `draft`, never taken from the request |
| connection author mapping | `author` | Omitted entirely when unmapped |
| — | `excerpt` | **Not sent.** Cynth has no excerpt field |

The excerpt shown in Cynth's article lists is a display truncation, not
editorial content. Sending it would look like an authored summary, and would
overwrite an excerpt a human had written in WordPress.

**Markup.** Cynth's models write Markdown-flavoured prose; WordPress stores
HTML. `articleMarkup.ts` translates headings, paragraphs, lists, blockquotes,
code, emphasis and links — translation only, nothing added. The source is
HTML-escaped before any markup is introduced, and only `http(s)` and
root-relative link targets are linkified, so an article body can never inject
markup or a `javascript:` URL into a post.

### Post identity and duplicate protection

`article_cms_links` holds one row per (article, connection) pair: the remote
post id, its last-known remote status, its URL and edit URL, the site it lives
on, and first/last push and last sync timestamps.

The presence of that row is what makes a second push an **update** rather than
a duplicate:

- The preflight (`GET /api/articles/:id/cms/preflight`) states the action
  before the click, and the button reads either **Push to WordPress as Draft**
  or **Update WordPress Draft**. There is no ambiguous "Push".
- `mode` is required on the push request and is verified against reality, not
  trusted. `create` on an article that already has a live remote post is
  refused; `update` on one that has never been pushed is refused rather than
  quietly creating a post.
- An update names the post it will replace, and asks for confirmation.
- If the remote post has been deleted in WordPress, that is reported — and a
  deliberate `create` is then allowed, so the article is not permanently
  stuck.
- An in-flight guard prevents a double-click or a second browser tab creating
  two posts for the same article.

### Synchronisation history

`cms_push_history` records every attempt: operation (`create` / `update` /
`refresh` / `test`), outcome, connection name, site URL, remote post id and
status, error code and message, duration and timestamp. Refusals are recorded
too — "I tried to push this twice" is a real event worth keeping. History rows
survive the deletion of the connection that produced them. No credential is
ever recorded.

`POST /api/articles/:id/cms/refresh` re-reads the remote post so Cynth
reflects a status a human has since changed in WordPress. It is a read; it
writes nothing there.

## Local WordPress

The initial target is the Local (Flywheel) installation used for
EveryFiveDays. Its address was read from the running environment rather than
assumed: `http://everyfivedays.local`, whose REST API answers at
`/wp-json` with the `wp/v2` namespace. Application Passwords are available on
it over plain HTTP because its `wp-config.php` sets
`WP_ENVIRONMENT_TYPE = 'local'`.

Verified against the real site during Milestone 13: reachability and REST API
discovery both pass, and a deliberately wrong credential is correctly reported
as an **authentication** failure rather than a connection failure. Nothing was
created on the site.

## Future Expansion

- **SEO metadata.** `CmsSeoMetadata` is declared in the connector contract and
  threaded through the payload, and `buildSeoMetadata()` currently returns
  `null` on purpose. The SEO Engine milestone owns SEO title, meta
  description, canonical URL, target query, structured data and link
  recommendations; inventing them now would put fabricated metadata on real
  posts. When that milestone lands, one function changes and the connector,
  the payload and the push path already carry the field.
- **Categories, tags and featured images.** Not mapped, for the same reason:
  Cynth has no authoritative value for them yet.
- **Further CMS connectors.** The registry is ready; nothing above the
  connector layer needs to change.

## TODO

- ~~TODO: Confirm EveryFiveDays' WordPress hosting setup.~~ **Resolved:** self-hosted (Local/Flywheel) with the REST API available; the connector is host-agnostic and the site URL is configuration.
- ~~TODO: Confirm authentication method.~~ **Resolved:** WordPress Application Passwords. No credentials appear in this binder.
- ~~TODO: Define what publish states exist and how Cynth maps to them.~~ **Resolved:** Cynth writes only `draft`. It *reads* WordPress's other statuses to know when to refuse an update, but never writes them.
- TODO: Define rollback/undo expectations if a publish needs to be reversed. *Currently out of scope: Cynth cannot publish, so it has nothing to reverse. Reverting a live post is done in WordPress.*
- TODO: Decide whether Cynth should map categories, tags, or a featured image once it holds authoritative values for them.
