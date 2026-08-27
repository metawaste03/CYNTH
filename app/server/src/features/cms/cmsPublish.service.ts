import { getArticleById } from '../articles/articles.repository.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { UNTITLED_ARTICLE_LABEL } from '../articles/articles.constants.js';
import { getConnector } from './connectors/index.js';
import { CmsError, isCmsError, sanitizeCmsMessage } from './cms.errors.js';
import type {
  CmsCallContext,
  CmsConnector,
  CmsDraftPayload,
  CmsRemotePost,
  CmsSeoMetadata,
} from './cms.types.js';
import { articleBodyToHtml } from './articleMarkup.js';
import {
  getConnectionById,
  getConnectionSecret,
  getDefaultConnection,
  recordConnectionCheck,
} from './cmsConnections.repository.js';
import type { CmsConnectionDto } from './cmsConnections.repository.js';
import { getLink, listLinksForArticle, recordPush, refreshLinkState, upsertLink } from './cmsLinks.repository.js';
import type { ArticleCmsLinkDto } from './cmsLinks.repository.js';

/**
 * The Article -> CMS Draft lifecycle.
 *
 *   CYNTH Draft -> Review -> Push to WordPress -> WordPress Draft -> Human Review -> Publication
 *
 * Three rules this file exists to enforce, none of which any caller can
 * bypass:
 *
 *   1. NOTHING IS EVER PUBLISHED. Every write asks for a draft, and the
 *      connector contract has no publish operation at all. The final
 *      publication is a human act performed in the CMS.
 *   2. NO DUPLICATES. An article already pushed to a site is updated in
 *      place. Creating a second remote post for the same article requires the
 *      caller to say so explicitly, and is refused while a live link exists.
 *   3. NO SILENT OVERWRITES. An update states, before it runs, which post it
 *      is about to modify — and refuses outright to modify one a human has
 *      already published.
 */

/** What the caller is asking for. Never inferred: the UI states which it means, and the server verifies it. */
export type PushMode = 'create' | 'update';

export function isValidPushMode(value: unknown): value is PushMode {
  return value === 'create' || value === 'update';
}

/* ------------------------------------------------------------- resolution --- */

interface ResolvedTarget {
  connection: CmsConnectionDto;
  connector: CmsConnector;
  /** Server-side only. Never returned by a route, never logged, never persisted. */
  context: CmsCallContext;
}

/**
 * Resolves the destination and everything a request needs: an active
 * connection, a known connector, and a credential that is actually present.
 *
 * Throws rather than returning a partial target — every failure here is a
 * configuration problem the user must fix before anything can be sent.
 */
function resolveTarget(connectionId: number | null): ResolvedTarget {
  const connection = connectionId === null ? getDefaultConnection() : getConnectionById(connectionId);

  if (!connection) {
    throw new CmsError(
      'connection_not_configured',
      connectionId === null
        ? 'No WordPress connection is configured. Open Settings then WordPress and add one.'
        : 'That WordPress connection no longer exists.',
    );
  }

  if (!connection.isActive) {
    throw new CmsError('connection_inactive', `The connection "${connection.name}" is inactive. Activate it in Settings then WordPress.`);
  }

  const connector = getConnector(connection.connectorType);
  if (!connector) {
    throw new CmsError(
      'unsupported_connector',
      `Cynth has no connector for CMS type "${connection.connectorType}".`,
    );
  }

  const secret = getConnectionSecret(connection.id);
  if (!secret) {
    throw new CmsError(
      'missing_credentials',
      `No credentials are stored for "${connection.name}". Add them in Settings then WordPress.`,
    );
  }

  return {
    connection,
    connector,
    context: { baseUrl: connection.baseUrl, username: connection.username, secret },
  };
}

/* ---------------------------------------------------------------- mapping --- */

/**
 * SEO metadata for a push.
 *
 * Deliberately always null. The SEO Engine milestone owns SEO title, meta
 * description, canonical URL, target query and structured data; inventing
 * them here would put fabricated metadata on real posts, and a value Cynth
 * made up is worse than no value at all.
 *
 * This function exists so that when the SEO engine lands, one implementation
 * changes and the connector, the payload and the push path all already carry
 * the field.
 */
function buildSeoMetadata(_article: ArticleDraftDto): CmsSeoMetadata | null {
  return null;
}

export interface ArticleMappingPreview {
  title: string;
  /** The rendered body, as it will be stored in the CMS. */
  content: string;
  excerpt: string | null;
  slug: string | null;
  status: 'draft';
  remoteAuthorId: string | null;
  remoteAuthorName: string | null;
  /** Character count of the rendered body, so the user can see something real was mapped. */
  contentLength: number;
}

/**
 * Maps a Cynth Article onto the CMS-agnostic draft payload.
 *
 * Only fields Cynth holds an authoritative value for are mapped:
 *
 *   title    the editor's working title, falling back to the model's title
 *   content  the generated body, rendered to the markup the CMS stores
 *   slug     Cynth's own slug, derived from the title
 *   status   always draft
 *   author   only when the user configured an author mapping
 *
 * Excerpt is left null: Cynth has no excerpt field, and the one shown in
 * article lists is a display truncation, not editorial content. Sending it
 * would look like an authored summary and would overwrite any excerpt a human
 * had written in the CMS.
 */
export function buildDraftPayload(article: ArticleDraftDto, connection: CmsConnectionDto): CmsDraftPayload {
  if (!article.generated?.content?.trim()) {
    throw new CmsError(
      'article_not_generated',
      'This article has no generated content yet, so there is nothing to send. Generate a draft first.',
    );
  }

  const title = article.title?.trim() || article.generated.title?.trim() || UNTITLED_ARTICLE_LABEL;

  return {
    title,
    content: articleBodyToHtml(article.generated.content),
    excerpt: null,
    slug: article.slug,
    status: 'draft',
    remoteAuthorId: connection.defaultRemoteAuthorId,
    seo: buildSeoMetadata(article),
  };
}

/** What the UI shows before a push: exactly the fields that will be sent. */
export function previewMapping(articleId: number, connectionId: number | null): ArticleMappingPreview {
  const article = getArticleById(articleId);
  if (!article) throw new CmsError('not_found', 'Article not found.');

  const connection = connectionId === null ? getDefaultConnection() : getConnectionById(connectionId);
  if (!connection) {
    throw new CmsError('connection_not_configured', 'No WordPress connection is configured.');
  }

  const payload = buildDraftPayload(article, connection);
  return {
    title: payload.title,
    content: payload.content,
    excerpt: payload.excerpt,
    slug: payload.slug,
    status: payload.status,
    remoteAuthorId: payload.remoteAuthorId,
    remoteAuthorName: connection.defaultRemoteAuthorName,
    contentLength: payload.content.length,
  };
}

/* ------------------------------------------------------------- connection --- */

export interface ConnectionTestOutcome {
  ok: boolean;
  stage: string;
  message: string;
  siteName: string | null;
  authenticatedAs: string | null;
  canCreateDrafts: boolean | null;
  connection: CmsConnectionDto | null;
}

/**
 * TEST CONNECTION.
 *
 * Verifies Cynth can reach the site, that it speaks the REST API, that the
 * stored credentials authenticate, and that the account may create drafts —
 * reporting which of those failed, because they have four different fixes.
 *
 * Publishes nothing and creates nothing. Both underlying requests are reads.
 */
export async function testConnection(connectionId: number): Promise<ConnectionTestOutcome> {
  const startedAt = Date.now();
  let target: ResolvedTarget;

  try {
    target = resolveTarget(connectionId);
  } catch (error) {
    const message = isCmsError(error) ? error.message : 'Could not test this connection.';
    const connection = getConnectionById(connectionId);
    recordConnectionCheck(connectionId, 'failed', 'configuration', message);
    recordPush({
      articleId: null,
      connectionId,
      connectionName: connection?.name ?? null,
      siteUrl: connection?.baseUrl ?? null,
      operation: 'test',
      status: 'failure',
      errorCode: isCmsError(error) ? error.code : 'invalid_configuration',
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      stage: 'configuration',
      message,
      siteName: null,
      authenticatedAs: null,
      canCreateDrafts: null,
      connection: getConnectionById(connectionId),
    };
  }

  try {
    const result = await target.connector.testConnection(target.context);
    const message = sanitizeCmsMessage(result.message, [target.context.secret, target.context.username]);

    recordConnectionCheck(connectionId, result.ok ? 'ok' : 'failed', result.stage, message);
    recordPush({
      articleId: null,
      connectionId,
      connectionName: target.connection.name,
      siteUrl: target.connection.baseUrl,
      operation: 'test',
      status: result.ok ? 'success' : 'failure',
      errorCode: result.ok ? null : result.stage,
      errorMessage: result.ok ? null : message,
      durationMs: Date.now() - startedAt,
    });

    return {
      ok: result.ok,
      stage: result.stage,
      message,
      siteName: result.siteName ?? null,
      authenticatedAs: result.authenticatedAs ?? null,
      canCreateDrafts: result.canCreateDrafts ?? null,
      connection: getConnectionById(connectionId),
    };
  } catch (error) {
    const message = isCmsError(error)
      ? error.message
      : sanitizeCmsMessage(error instanceof Error ? error.message : 'Unknown error.', [
          target.context.secret,
          target.context.username,
        ]);

    recordConnectionCheck(connectionId, 'failed', isCmsError(error) ? error.code : 'cms_error', message);
    recordPush({
      articleId: null,
      connectionId,
      connectionName: target.connection.name,
      siteUrl: target.connection.baseUrl,
      operation: 'test',
      status: 'failure',
      errorCode: isCmsError(error) ? error.code : 'cms_error',
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    });

    return {
      ok: false,
      stage: isCmsError(error) ? error.code : 'cms_error',
      message,
      siteName: null,
      authenticatedAs: null,
      canCreateDrafts: null,
      connection: getConnectionById(connectionId),
    };
  }
}

/** The site's users, so the author mapping is chosen from real accounts rather than typed as a number. */
export async function listRemoteAuthors(connectionId: number) {
  const target = resolveTarget(connectionId);
  if (!target.connector.listAuthors) {
    throw new CmsError('unsupported_connector', `${target.connection.name} does not expose a user list.`);
  }
  return target.connector.listAuthors(target.context);
}

/* --------------------------------------------------------------- preflight --- */

export interface PushPreflight {
  articleId: number;
  connection: { id: number; name: string; baseUrl: string; connectorType: string; hasCredential: boolean } | null;
  /** The existing remote post, when this article has already been pushed to this connection. */
  link: ArticleCmsLinkDto | null;
  /**
   * What pressing the button will do: create a new remote draft, or update
   * the existing one. Stated explicitly so the action is never ambiguous.
   */
  action: PushMode | null;
  /** Everything that will be sent, exactly as it will be sent. */
  mapping: ArticleMappingPreview | null;
  ready: boolean;
  issues: string[];
  /** Set when the blocking problem is configuration, so the UI can link to settings. */
  configurationErrorCode: string | null;
  /** Every CMS this article currently lives on. */
  links: ArticleCmsLinkDto[];
}

/**
 * What the user sees before pressing Push. Reads local state only — contacts
 * no CMS, so opening a draft never touches the site.
 */
export function getPushPreflight(articleId: number, connectionId: number | null = null): PushPreflight {
  const article = getArticleById(articleId);
  if (!article) throw new CmsError('not_found', 'Article not found.');

  const issues: string[] = [];
  let configurationErrorCode: string | null = null;

  const connection = connectionId === null ? getDefaultConnection() : getConnectionById(connectionId);

  if (!connection) {
    issues.push('No WordPress connection is configured. Open Settings then WordPress and add one.');
    configurationErrorCode = 'connection_not_configured';
  } else {
    if (!connection.isActive) {
      issues.push(`The connection "${connection.name}" is inactive.`);
      configurationErrorCode = 'connection_inactive';
    }
    if (!connection.hasCredential) {
      issues.push(`No credentials are stored for "${connection.name}".`);
      configurationErrorCode = 'missing_credentials';
    }
  }

  if (!article.generated?.content?.trim()) {
    issues.push('This article has no generated content yet, so there is nothing to send.');
  }

  const link = connection ? getLink(articleId, connection.id) : null;

  let mapping: ArticleMappingPreview | null = null;
  if (connection && article.generated?.content?.trim()) {
    const payload = buildDraftPayload(article, connection);
    mapping = {
      title: payload.title,
      content: payload.content,
      excerpt: payload.excerpt,
      slug: payload.slug,
      status: payload.status,
      remoteAuthorId: payload.remoteAuthorId,
      remoteAuthorName: connection.defaultRemoteAuthorName,
      contentLength: payload.content.length,
    };
  }

  return {
    articleId,
    connection: connection
      ? {
          id: connection.id,
          name: connection.name,
          baseUrl: connection.baseUrl,
          connectorType: connection.connectorType,
          hasCredential: connection.hasCredential,
        }
      : null,
    link,
    // DUPLICATE PROTECTION, surfaced before the click: an article already
    // pushed here can only be updated, and the button says so.
    action: connection ? (link ? 'update' : 'create') : null,
    mapping,
    ready: issues.length === 0,
    issues,
    configurationErrorCode,
    links: listLinksForArticle(articleId),
  };
}

/* -------------------------------------------------------------------- push --- */

/**
 * Articles currently being pushed. Guards against a double-click, or a second
 * browser tab, creating two remote posts for the same article. In-memory is
 * sufficient: Cynth is a single-user, single-process local application
 * (docs/02_VERSION1_SCOPE.md), and this mirrors the same guard the generation
 * engine already uses.
 */
const inFlight = new Set<number>();

export interface PushResult {
  operation: PushMode;
  post: CmsRemotePost;
  link: ArticleCmsLinkDto;
  connectionName: string;
  message: string;
}

/**
 * Sends a Cynth Article to a CMS as a DRAFT.
 *
 * `mode` is required and is checked against reality rather than trusted: if
 * the caller says "create" but a link already exists, the push is refused
 * with an explanation instead of quietly producing a duplicate — and if the
 * caller says "update" but nothing has been pushed, it is refused rather than
 * quietly creating one.
 */
export async function pushArticle(
  articleId: number,
  connectionId: number | null,
  mode: PushMode,
): Promise<PushResult> {
  const article = getArticleById(articleId);
  if (!article) throw new CmsError('not_found', 'Article not found.');

  const target = resolveTarget(connectionId);
  const { connection, connector, context } = target;
  const payload = buildDraftPayload(article, connection);

  const existingLink = getLink(articleId, connection.id);

  /**
   * Records a refusal before re-throwing it.
   *
   * A refused push is a real synchronisation event — "I tried to push this
   * twice", "I tried to update something a human had published" — and belongs
   * in the history as much as a failed request does. Without this the audit
   * trail would only show the pushes that got as far as the network.
   */
  const refuse = (error: CmsError): never => {
    recordPush({
      articleId,
      connectionId: connection.id,
      connectionName: connection.name,
      siteUrl: connection.baseUrl,
      operation: mode,
      status: 'failure',
      externalId: existingLink?.externalId ?? null,
      errorCode: error.code,
      errorMessage: error.message,
    });
    throw error;
  };

  /* ---- DUPLICATE PROTECTION ------------------------------------------- */

  if (mode === 'create' && existingLink) {
    // Before refusing, confirm the remote post is really still there: a post
    // deleted in WordPress should not leave the article permanently
    // un-pushable.
    const remote = await connector.getPost(existingLink.externalId, context);
    if (remote) {
      refreshLinkState(existingLink.id, remote.status, remote.url);
      refuse(
        new CmsError(
          'already_pushed',
          `This article is already on ${connection.name} as post ${existingLink.externalId}. Use "Update WordPress Draft" to update it — creating another post would duplicate it.`,
        ),
      );
    }
    // The remote post is gone. Creating a new one is now the honest action,
    // so the stale link is replaced by the push below rather than blocking it.
  }

  if (mode === 'update') {
    if (!existingLink) {
      refuse(
        new CmsError(
          'not_pushed_yet',
          `This article has not been pushed to ${connection.name} yet, so there is nothing to update. Use "Push to WordPress" to create the draft.`,
        ),
      );
    }

    const remote = await connector.getPost(existingLink!.externalId, context);
    if (!remote) {
      refuse(
        new CmsError(
          'remote_post_missing',
          `Post ${existingLink!.externalId} no longer exists on ${connection.name} — it may have been deleted there. Use "Push to WordPress" to create a new draft.`,
        ),
      );
    }

    refreshLinkState(existingLink!.id, remote!.status, remote!.url);

    // NEVER TOUCH PUBLISHED CONTENT. Updating a live post would either
    // overwrite what readers are seeing, or — by asking for draft status —
    // unpublish it. Neither is Cynth's decision to make.
    if (remote!.status !== 'draft') {
      refuse(
        new CmsError(
          'remote_post_published',
          `Post ${existingLink!.externalId} on ${connection.name} is no longer a draft (its status is "${remote!.status}"). Cynth does not modify content that has already been published — edit it in WordPress instead.`,
        ),
      );
    }
  }

  if (inFlight.has(articleId)) {
    refuse(
      new CmsError('push_in_progress', 'This article is already being sent. Wait for the current attempt to finish.'),
    );
  }
  inFlight.add(articleId);

  const startedAt = Date.now();

  try {
    const post =
      mode === 'update' && existingLink
        ? await connector.updateDraft(existingLink.externalId, payload, context)
        : await connector.createDraft(payload, context);

    const link = upsertLink({
      articleId,
      connectionId: connection.id,
      externalId: post.id,
      externalStatus: post.status,
      externalUrl: post.url,
      externalEditUrl: post.editUrl,
      siteUrl: connection.baseUrl,
    });

    // The operation actually performed, which can differ from the requested
    // mode when a create replaced a link whose remote post had been deleted.
    const operation: PushMode = mode === 'update' && existingLink ? 'update' : 'create';

    recordPush({
      articleId,
      connectionId: connection.id,
      connectionName: connection.name,
      siteUrl: connection.baseUrl,
      operation,
      status: 'success',
      externalId: post.id,
      externalStatus: post.status,
      durationMs: Date.now() - startedAt,
    });

    return {
      operation,
      post,
      link,
      connectionName: connection.name,
      message:
        operation === 'create'
          ? `Created draft post ${post.id} on ${connection.name}. It is a draft — nothing has been published.`
          : `Updated draft post ${post.id} on ${connection.name}. It is still a draft — nothing has been published.`,
    };
  } catch (error) {
    const message = isCmsError(error)
      ? error.message
      : sanitizeCmsMessage(error instanceof Error ? error.message : 'Unknown error.', [context.secret, context.username]);

    recordPush({
      articleId,
      connectionId: connection.id,
      connectionName: connection.name,
      siteUrl: connection.baseUrl,
      operation: mode,
      status: 'failure',
      externalId: existingLink?.externalId ?? null,
      errorCode: isCmsError(error) ? error.code : 'cms_error',
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    });

    if (isCmsError(error)) throw error;
    throw new CmsError('cms_error', `The push failed: ${message}`);
  } finally {
    inFlight.delete(articleId);
  }
}

/**
 * Re-reads the remote post and updates what Cynth believes about it —
 * including a status a human has since changed in the CMS.
 *
 * A read; it writes nothing to the CMS.
 */
export async function refreshLink(articleId: number, connectionId: number): Promise<ArticleCmsLinkDto | null> {
  const link = getLink(articleId, connectionId);
  if (!link) return null;

  const target = resolveTarget(connectionId);
  const remote = await target.connector.getPost(link.externalId, target.context);

  if (!remote) {
    // The post is gone. Say so rather than silently keeping a dead link:
    // 'deleted' is Cynth's own marker, distinct from any CMS status.
    refreshLinkState(link.id, 'deleted', link.externalUrl);
    recordPush({
      articleId,
      connectionId,
      connectionName: target.connection.name,
      siteUrl: target.connection.baseUrl,
      operation: 'refresh',
      status: 'failure',
      externalId: link.externalId,
      errorCode: 'remote_post_missing',
      errorMessage: `Post ${link.externalId} no longer exists on ${target.connection.name}.`,
    });
    return getLink(articleId, connectionId);
  }

  refreshLinkState(link.id, remote.status, remote.url);
  recordPush({
    articleId,
    connectionId,
    connectionName: target.connection.name,
    siteUrl: target.connection.baseUrl,
    operation: 'refresh',
    status: 'success',
    externalId: remote.id,
    externalStatus: remote.status,
  });

  return getLink(articleId, connectionId);
}
