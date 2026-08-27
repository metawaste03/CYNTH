import { CmsError, sanitizeCmsMessage } from '../cms.errors.js';
import type {
  CmsCallContext,
  CmsConnectionTestResult,
  CmsConnector,
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
function draftBody(payload: CmsDraftPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: payload.title,
    content: payload.content,
    status: DRAFT_STATUS,
  };

  if (payload.slug) body.slug = payload.slug;
  if (payload.excerpt) body.excerpt = payload.excerpt;
  if (payload.remoteAuthorId) body.author = Number(payload.remoteAuthorId) || payload.remoteAuthorId;

  // payload.seo is deliberately not mapped. The SEO Engine milestone owns
  // those values; sending fabricated ones now would put invented metadata on
  // a real post. The field exists so the mapping has somewhere to land.

  return body;
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
      body: draftBody(payload),
    });

    if (!response.ok) throwForFailure(response, context, 'create posts');
    return mapPost(response.json, context.baseUrl);
  },

  async updateDraft(externalId: string, payload: CmsDraftPayload, context: CmsCallContext): Promise<CmsRemotePost> {
    const response = await callWordPress(`${apiRoot(context.baseUrl)}/wp/v2/posts/${encodeURIComponent(externalId)}`, {
      method: 'POST', // WordPress accepts POST for updates as well as PUT/PATCH.
      headers: { authorization: authHeader(context) },
      body: draftBody(payload),
    });

    if (!response.ok) throwForFailure(response, context, 'edit this post');
    return mapPost(response.json, context.baseUrl);
  },

  /** Reads a post's current state. Null — not an error — when WordPress no longer has it. */
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
