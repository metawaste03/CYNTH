import { readFile } from 'node:fs/promises';
import { CmsError, sanitizeCmsMessage } from '../cms.errors.js';
import { getSeoFieldMapping } from '../seoAdapter.js';
import type {
  CmsCallContext,
  CmsSeoMetadata,
  CmsConnectionTestResult,
  CmsConnector,
  CmsDraftImage,
  CmsDraftPayload,
  CmsRemoteAuthor,
  CmsRemotePost,
} from '../cms.types.js';

/**
 * WordPress, over its built-in REST API (`/wp-json/wp/v2`).
 *
 * The first CMS connector. Nothing above this file knows WordPress exists —
 * it speaks only the CmsConnector contract in ../cms.types.ts.
 *
 * Authentication is an Application Password: a per-application credential a
 * user creates in their own WordPress profile and can revoke without changing
 * their login. Cynth never asks for, stores, or transmits an account
 * password.
 *
 * NEVER PUBLISHES. Every write below sends `status: 'draft'`, and there is no
 * code path that sends any other status. Publication is a human act performed
 * in WordPress (docs/00_PROJECT_VISION.md).
 */

/** How long one WordPress request may take. A local site answers in milliseconds; a remote one should still not hang the UI. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Longer than a JSON call: a hero image is megabytes, and the media library resizes it on receipt. */
const MEDIA_UPLOAD_TIMEOUT_MS = 60_000;

export const WORDPRESS_CONNECTOR_TYPE = 'wordpress';

/** The only status Cynth ever writes. Declared once so a typo cannot become a publication. */
const DRAFT_STATUS = 'draft';

/** Trims trailing slashes off a configured site URL, a near-universal paste artifact. */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new CmsError(
      'invalid_configuration',
      'The WordPress Site URL must start with http:// or https://. Update it in Settings then WordPress.',
    );
  }
  return trimmed;
}

function apiRoot(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/wp-json`;
}

/**
 * The Basic authorization header WordPress expects for an Application
 * Password.
 *
 * WordPress accepts the password with or without the spaces it displays it
 * with; the spaces are stripped so a pasted credential works either way.
 */
function authHeader(context: CmsCallContext): string {
  const username = context.username?.trim() ?? '';
  const secret = context.secret.replace(/\s+/g, '');

  if (!username || !secret) {
    throw new CmsError(
      'missing_credentials',
      'This WordPress connection has no username or application password stored. Add them in Settings then WordPress.',
    );
  }

  return `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`;
}

interface WpResponse {
  status: number;
  ok: boolean;
  json: unknown;
  rawText: string;
}

async function callWordPress(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown },
): Promise<WpResponse> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Deliberately does not include the thrown error's own text: it can echo
    // request details and never tells the user anything actionable.
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new CmsError(
        'timeout',
        `WordPress did not respond within ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds. Nothing was changed — check the site is running, then try again.`,
      );
    }
    throw new CmsError(
      'network_error',
      'Cynth could not reach the WordPress site. Check the Site URL and that the site is running, then try again.',
    );
  }

  const rawText = await response.text().catch(() => '');
  let json: unknown = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = null;
  }

  return { status: response.status, ok: response.ok, json, rawText };
}

/** WordPress error bodies are `{ code, message, data }`. Anything else falls back to the raw body. */
function wpMessage(response: WpResponse): string {
  const body = response.json as Record<string, unknown> | null;
  if (body && typeof body.message === 'string' && body.message.trim()) return body.message;
  return response.rawText || 'No details were returned.';
}

function wpErrorCode(response: WpResponse): string | null {
  const body = response.json as Record<string, unknown> | null;
  return body && typeof body.code === 'string' ? body.code : null;
}

/**
 * Turns a failed WordPress response into a Cynth error.
 *
 * WordPress's own wording is kept — it is often the only thing that explains
 * why — but it is redacted and truncated first, and no headers or credentials
 * are ever included.
 */
function throwForFailure(response: WpResponse, context: CmsCallContext, what: string): never {
  const detail = sanitizeCmsMessage(wpMessage(response), [context.secret, context.username]);
  const code = wpErrorCode(response);

  if (response.status === 401 || code === 'incorrect_password' || code === 'invalid_username') {
    throw new CmsError(
      'authentication_failed',
      `WordPress rejected Cynth's credentials. Check the username and application password in Settings then WordPress. WordPress said: ${detail}`,
    );
  }
  if (response.status === 403) {
    throw new CmsError(
      'authorization_failed',
      `WordPress authenticated Cynth but refused the action. The account may lack permission to ${what}. WordPress said: ${detail}`,
    );
  }
  if (response.status === 404) {
    throw new CmsError('not_found', `WordPress could not find what Cynth asked for. WordPress said: ${detail}`);
  }
  if (response.status === 429) {
    throw new CmsError('rate_limited', `WordPress is rate-limiting Cynth. Wait a moment and try again. WordPress said: ${detail}`);
  }
  if (response.status >= 500) {
    throw new CmsError(
      'cms_error',
      `WordPress reported a server error (HTTP ${response.status}). Nothing was changed — you can try again. WordPress said: ${detail}`,
    );
  }

  throw new CmsError('cms_error', `WordPress rejected the request (HTTP ${response.status}). WordPress said: ${detail}`);
}

/** WordPress returns title/content/excerpt as `{ raw, rendered }` objects in edit context, or plain strings elsewhere. */
function readRendered(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.rendered === 'string') return record.rendered;
    if (typeof record.raw === 'string') return record.raw;
  }
  return null;
}

function mapPost(body: unknown, baseUrl: string): CmsRemotePost {
  if (!body || typeof body !== 'object') {
    throw new CmsError('invalid_response', 'WordPress returned a response Cynth could not read.');
  }
  const post = body as Record<string, unknown>;
  const id = post.id;
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new CmsError('invalid_response', 'WordPress returned a post without an id.');
  }

  return {
    id: String(id),
    status: typeof post.status === 'string' ? post.status : 'unknown',
    title: readRendered(post.title),
    url: typeof post.link === 'string' ? post.link : null,
    editUrl: `${normalizeBaseUrl(baseUrl)}/wp-admin/post.php?post=${id}&action=edit`,
    modifiedAt: typeof post.modified_gmt === 'string' ? `${post.modified_gmt}Z` : null,
  };
}

/**
 * The request body for a draft.
 *
 * `status` is the literal draft constant, never a value from the payload —
 * even though the payload's type already forbids anything else. Two
 * independent guarantees against an accidental publication are worth the one
 * redundant line.
 *
 * Fields Cynth has no authoritative value for are omitted entirely rather
 * than sent empty: an absent excerpt leaves WordPress to derive its own,
 * whereas an empty string would overwrite one an editor had written.
 */
function draftBody(payload: CmsDraftPayload, options: { keepRemoteState?: boolean } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
  };

  /**
   * `keepRemoteState` is what makes an update to a PUBLISHED post possible.
   *
   * Sending `status: draft` at a live post does not update it, it unpublishes
   * it — the article drops off the site and the caller still sees a 200. And
   * the slug is the live URL that every inbound link and indexed result points
   * at; moving it is not part of "fix a paragraph". Both fields are therefore
   * omitted rather than sent, so WordPress keeps what it already has.
   */
  if (!options.keepRemoteState) {
    body.status = DRAFT_STATUS;
    if (payload.slug) body.slug = payload.slug;
  }

  if (payload.excerpt) body.excerpt = payload.excerpt;
  if (payload.remoteAuthorId) body.author = Number(payload.remoteAuthorId) || payload.remoteAuthorId;

  // SEO METADATA (Milestone 37).
  //
  // WordPress core stores none of this: an SEO title and a meta description
  // live in whichever plugin the site runs, each under its own post-meta
  // keys. The connection says which plugin, seoAdapter.ts says which keys,
  // and a target with no registered mapping sends nothing at all rather than
  // writing keys that may not exist.
  //
  // Emitted under `meta`, which WordPress accepts only for keys the site has
  // registered with `show_in_rest`. Unregistered keys are dropped silently by
  // WordPress — see docs/rank-math-rest-meta.php for the mu-plugin that
  // registers Rank Math's.
  if (payload.seo && payload.seoTarget) {
    const mapping = getSeoFieldMapping('wordpress', payload.seoTarget);
    if (mapping) {
      const fields = mapping.map(payload.seo);
      if (Object.keys(fields).length) body.meta = fields;
    }
  }

  return body;
}

/**
 * Uploads the payload's featured image and attaches it to the post.
 *
 * Runs after the draft exists, in two steps, because that is what the REST
 * API offers: `/wp/v2/media` creates the attachment, then the post's
 * `featured_media` points at it. There is no single call that does both.
 *
 * DELIBERATELY NON-FATAL. The article and its body are already safely in
 * WordPress by the time this runs. If the upload fails — the file moved, the
 * account cannot upload files, the site rejects the MIME type — the right
 * outcome is a draft with no featured image, not a push the user is told
 * failed and retries, producing a second copy of an article that is already
 * there. The image is re-sent on the next update.
 */
/**
 * Uploads the file and returns the new attachment's id, or null.
 *
 * Split out of `attachFeaturedImage` so the published-post path can reuse it
 * without also inheriting that function's `status: draft` write.
 */
async function uploadMedia(image: CmsDraftImage, context: CmsCallContext): Promise<number | null> {
  const bytes = await readFile(image.filePath);

  const upload = await fetch(`${apiRoot(context.baseUrl)}/wp/v2/media`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: authHeader(context),
      'content-type': image.mimeType,
      // WordPress reads the filename from this header for a raw-body upload,
      // which avoids assembling a multipart request by hand.
      'content-disposition': `attachment; filename="${sanitizeUploadFilename(image.filename)}"`,
    },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(MEDIA_UPLOAD_TIMEOUT_MS),
  });

  if (!upload.ok) return null;

  const media = (await upload.json().catch(() => null)) as Record<string, unknown> | null;
  const mediaId = media && typeof media.id === 'number' ? media.id : null;
  if (mediaId === null) return null;

  // Alt text is a separate write and only happens when the editor actually
  // wrote some — an empty alt attribute is better than an invented one.
  if (image.altText) {
    await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/media/${mediaId}`, {
      method: 'POST',
      headers: { authorization: authHeader(context) },
      body: { alt_text: image.altText },
    });
  }

  return mediaId;
}

/**
 * Finds an EXISTING category by name. Never creates one.
 *
 * WHY IT WILL NOT CREATE. A category created from a typo is invisible until
 * somebody notices two nearly identical ones in the sidebar — which is exactly
 * what happened to the product library, where "Sleeping Gadget" sat beside
 * "Sleeping Gadgets". A name that does not match anything means the article is
 * filed wherever it already was, and the mismatch is reported rather than
 * papered over with a new term.
 *
 * WHY IT COMPARES DECODED NAMES. WordPress stores and returns a term name with
 * HTML entities — "Sleep &amp; Recovery" — while Cynth holds the plain
 * characters. Comparing them raw matches nothing, which is the same trap the
 * picks shortcode hit on the site side.
 */
async function findCategoryId(name: string, context: CmsCallContext): Promise<number | null> {
  const wanted = decodeEntities(name).trim().toLowerCase();

  const match = (body: unknown): number | null => {
    if (!Array.isArray(body)) return null;
    for (const term of body as Record<string, unknown>[]) {
      const termName = typeof term.name === 'string' ? decodeEntities(term.name).trim().toLowerCase() : '';
      if (termName === wanted && (typeof term.id === 'number' || typeof term.id === 'string')) {
        return Number(term.id);
      }
    }
    return null;
  };

  /**
   * THE WHOLE LIST FIRST, AND THE MATCH DONE HERE.
   *
   * The obvious call is `?search=<name>`, and it is the fragile one: search is
   * the CMS's own tokenising, and the name Cynth holds ("Sleep & Recovery")
   * does not have to match the way the CMS indexes the one it stores. Reading
   * the categories and comparing them here depends on nothing but the names
   * themselves — and for a site with five of them it is a single request.
   */
  const all = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/categories?per_page=100&orderby=id`, {
    method: 'GET',
    headers: { authorization: authHeader(context) },
  });

  if (all.ok) {
    const hit = match(all.json);
    if (hit !== null) return hit;
    // Fewer than a full page means we have seen every category there is, so a
    // miss is a real miss and a second request would only repeat it.
    if (Array.isArray(all.json) && all.json.length < 100) return null;
  }

  // A site with more than a hundred categories: ask it to find this one.
  const searched = await callWordPress(
    `${apiRoot(context.baseUrl)}/wp/v2/categories?per_page=100&search=${encodeURIComponent(wanted)}`,
    { method: 'GET', headers: { authorization: authHeader(context) } },
  );

  return searched.ok ? match(searched.json) : null;
}

/** The handful of entities WordPress actually emits in a term name. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * The request body plus the category, when one resolves.
 *
 * Resolution is a network call, so it cannot live in `draftBody`, which is
 * synchronous and is also used by the preview. An unresolvable name sends no
 * `categories` at all rather than an empty array: an empty array would strip
 * the post of every category it has, turning "I could not find your category"
 * into "I removed the one you had".
 */
async function bodyWithCategory(
  payload: CmsDraftPayload,
  context: CmsCallContext,
  options: { keepRemoteState?: boolean } = {},
): Promise<Record<string, unknown>> {
  const body = draftBody(payload, options);
  if (!payload.categoryName) return body;

  const id = await findCategoryId(payload.categoryName, context);
  if (id !== null) body.categories = [id];

  return body;
}

async function attachFeaturedImage(
  post: CmsRemotePost,
  payload: CmsDraftPayload,
  context: CmsCallContext,
  options: { keepRemoteState?: boolean } = {},
): Promise<CmsRemotePost> {
  const image = payload.featuredImage;
  if (!image) return post;

  try {
    const mediaId = await uploadMedia(image, context);
    if (mediaId === null) return post;

    const attach = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/posts/${encodeURIComponent(post.id)}`, {
      method: 'POST',
      headers: { authorization: authHeader(context) },
      // On a draft, `status` is restated even though WordPress would leave it
      // untouched on a partial update: every draft write says "draft".
      //
      // On a LIVE post it must not be sent at all. It used to be, which made
      // "Update the live article" unpublish every article with a featured
      // image — the body update kept the post live and this second request
      // then took it down, while the caller was told readers saw the new
      // version (posts 365, 394 and 338, 2026-10-01).
      body: options.keepRemoteState ? { featured_media: mediaId } : { featured_media: mediaId, status: DRAFT_STATUS },
    });

    return attach.ok ? mapPost(attach.json, context.baseUrl) : post;
  } catch {
    return post;
  }
}

/** A filename WordPress will accept, with any path component removed. */
function sanitizeUploadFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'image';
  const cleaned = base.replace(/["\r\n]/g, '').trim();
  return cleaned || 'image';
}

export const wordpressConnector: CmsConnector = {
  connectorType: WORDPRESS_CONNECTOR_TYPE,
  label: 'WordPress',
  authMethods: ['application_password'],

  /**
   * Verifies the site is reachable, that it speaks the REST API, that Cynth's
   * credentials authenticate, and that the account may actually create
   * drafts.
   *
   * Creates nothing and publishes nothing: both requests are reads.
   */
  async testConnection(context: CmsCallContext): Promise<CmsConnectionTestResult> {
    const root = apiRoot(context.baseUrl);

    // Stage 1 — reachability and REST API presence. Unauthenticated on
    // purpose, so a network problem is never misreported as a bad password.
    let discovery: WpResponse;
    try {
      discovery = await callWordPress(root, { method: 'GET' });
    } catch (error) {
      if (error instanceof CmsError && (error.code === 'network_error' || error.code === 'timeout')) {
        return { ok: false, stage: 'connection', message: error.message };
      }
      throw error;
    }

    if (!discovery.ok) {
      return {
        ok: false,
        stage: 'api',
        message: `The site answered, but its REST API did not (HTTP ${discovery.status}). WordPress said: ${sanitizeCmsMessage(wpMessage(discovery), [context.secret, context.username])}`,
      };
    }

    const root_ = discovery.json as Record<string, unknown> | null;
    const namespaces = Array.isArray(root_?.namespaces) ? (root_!.namespaces as unknown[]) : [];
    if (!namespaces.includes('wp/v2')) {
      return {
        ok: false,
        stage: 'api',
        message:
          'The site responded but does not expose the wp/v2 REST namespace, so Cynth cannot create posts on it. Check that the REST API is not disabled by a plugin or security rule.',
      };
    }
    const siteName = typeof root_?.name === 'string' ? root_.name : null;

    // Stage 2 — authentication and permission. `context=edit` is the cheapest
    // request that proves the credential works AND returns the account's
    // capabilities, so "wrong password" and "account cannot post" stay
    // distinguishable.
    const me = await callWordPress(`${root}/wp/v2/users/me?context=edit`, {
      method: 'GET',
      headers: { authorization: authHeader(context) },
    });

    if (me.status === 401) {
      return {
        ok: false,
        stage: 'authentication',
        siteName,
        message: `WordPress rejected the credentials. Check the username and application password. WordPress said: ${sanitizeCmsMessage(wpMessage(me), [context.secret, context.username])}`,
      };
    }
    if (!me.ok) {
      return {
        ok: false,
        stage: me.status === 403 ? 'authorization' : 'api',
        siteName,
        message: `WordPress refused the request (HTTP ${me.status}). WordPress said: ${sanitizeCmsMessage(wpMessage(me), [context.secret, context.username])}`,
      };
    }

    const user = me.json as Record<string, unknown> | null;
    const capabilities = (user?.capabilities ?? {}) as Record<string, unknown>;
    // `edit_posts` is the capability that actually decides whether a draft can
    // be created. An account that authenticates but lacks it would fail at
    // push time, so the test says so now.
    const canCreateDrafts = capabilities.edit_posts === true || capabilities.publish_posts === true;
    const authenticatedAs = typeof user?.name === 'string' ? user.name : (context.username ?? null);

    if (!canCreateDrafts) {
      return {
        ok: false,
        stage: 'authorization',
        siteName,
        authenticatedAs,
        canCreateDrafts: false,
        message: `Connected and authenticated as ${authenticatedAs ?? 'this account'}, but the account cannot create posts on this site. Use an account with at least Author permissions.`,
      };
    }

    return {
      ok: true,
      stage: 'ok',
      siteName,
      authenticatedAs,
      canCreateDrafts: true,
      message: `Connected to ${siteName ?? context.baseUrl} and authenticated as ${authenticatedAs ?? 'the configured account'}. Nothing was created or published.`,
    };
  },

  async createDraft(payload: CmsDraftPayload, context: CmsCallContext): Promise<CmsRemotePost> {
    const response = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/posts`, {
      method: 'POST',
      headers: { authorization: authHeader(context) },
      body: await bodyWithCategory(payload, context),
    });

    if (!response.ok) throwForFailure(response, context, 'create posts');
    const post = mapPost(response.json, context.baseUrl);

    return attachFeaturedImage(post, payload, context);
  },

  async updateDraft(externalId: string, payload: CmsDraftPayload, context: CmsCallContext): Promise<CmsRemotePost> {
    const response = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/posts/${encodeURIComponent(externalId)}`, {
      method: 'POST', // WordPress accepts POST for updates as well as PUT/PATCH.
      headers: { authorization: authHeader(context) },
      body: await bodyWithCategory(payload, context),
    });

    if (!response.ok) throwForFailure(response, context, 'edit this post');
    const post = mapPost(response.json, context.baseUrl);

    return attachFeaturedImage(post, payload, context);
  },

  /**
   * Replaces the body of a post that is already live.
   *
   * The same request as `updateDraft` minus two fields, and those two
   * omissions are the entire point — see `draftBody`'s `keepRemoteState`.
   */
  async updatePublished(
    externalId: string,
    payload: CmsDraftPayload,
    context: CmsCallContext,
  ): Promise<CmsRemotePost> {
    const response = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/posts/${encodeURIComponent(externalId)}`, {
      method: 'POST',
      headers: { authorization: authHeader(context) },
      body: await bodyWithCategory(payload, context, { keepRemoteState: true }),
    });

    if (!response.ok) throwForFailure(response, context, 'edit this post');
    const post = mapPost(response.json, context.baseUrl);

    return attachFeaturedImage(post, payload, context, { keepRemoteState: true });
  },

  /** Reads a post's current state. Null — not an error — when WordPress no longer has it. */
  /**
   * SEO metadata only. Deliberately narrow.
   *
   * The body of this request contains `meta` and nothing else, so it cannot
   * change a word of the article, its slug, or whether it is published. That
   * is what makes it safe to run against a published post, which `updateDraft`
   * rightly refuses.
   */
  async updateSeoMetadata(
    externalId: string,
    seo: CmsSeoMetadata,
    seoTarget: string | null,
    context: CmsCallContext,
  ): Promise<CmsRemotePost | null> {
    if (!seoTarget) return null;
    const mapping = getSeoFieldMapping('wordpress', seoTarget);
    if (!mapping) return null;

    const fields = mapping.map(seo);
    if (!Object.keys(fields).length) return null;

    const response = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/posts/${encodeURIComponent(externalId)}`, {
      method: 'POST',
      headers: { authorization: authHeader(context) },
      body: { meta: fields },
    });

    if (!response.ok) throwForFailure(response, context, 'edit this post');
    return mapPost(response.json, context.baseUrl);
  },

  /**
   * Attaches a featured image to a post without touching anything else.
   *
   * Note what is NOT in the body: no `status`. Every other write this module
   * makes to a post restates "draft", which is the invariant it is built
   * around — and which is exactly why this path had to exist. A published
   * article whose image was chosen after the push could not be given that
   * image without being unpublished to receive it.
   *
   * Unlike the push-time attach, a failure here is fatal rather than silent.
   * There, the article was already safely in WordPress and a missing picture
   * was the lesser outcome; here, attaching the picture is the entire
   * operation, so reporting success without one would be a lie.
   */
  async updateFeaturedImage(
    externalId: string,
    image: CmsDraftImage,
    context: CmsCallContext,
  ): Promise<CmsRemotePost | null> {
    const mediaId = await uploadMedia(image, context);
    if (mediaId === null) return null;

    const response = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/posts/${encodeURIComponent(externalId)}`, {
      method: 'POST',
      headers: { authorization: authHeader(context) },
      body: { featured_media: mediaId },
    });

    if (!response.ok) throwForFailure(response, context, 'edit this post');
    return mapPost(response.json, context.baseUrl);
  },

  async getPost(externalId: string, context: CmsCallContext): Promise<CmsRemotePost | null> {
    const response = await callWordPress(
      `${apiRoot(context.baseUrl)}/wp/v2/posts/${encodeURIComponent(externalId)}?context=edit`,
      { method: 'GET', headers: { authorization: authHeader(context) } },
    );

    if (response.status === 404) return null;
    if (!response.ok) throwForFailure(response, context, 'read this post');
    return mapPost(response.json, context.baseUrl);
  },

  /** The site's users, for the optional author mapping. A read; changes nothing. */
  async listAuthors(context: CmsCallContext): Promise<CmsRemoteAuthor[]> {
    const response = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/users?context=edit&per_page=100`, {
      method: 'GET',
      headers: { authorization: authHeader(context) },
    });

    if (!response.ok) throwForFailure(response, context, 'list users');
    if (!Array.isArray(response.json)) {
      throw new CmsError('invalid_response', 'WordPress returned an unexpected response when listing users.');
    }

    return (response.json as Record<string, unknown>[])
      .filter((user) => user.id !== undefined)
      .map((user) => ({
        id: String(user.id),
        name: typeof user.name === 'string' ? user.name : String(user.id),
        slug: typeof user.slug === 'string' ? user.slug : null,
      }));
  },
};
