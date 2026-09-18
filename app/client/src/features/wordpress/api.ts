import { api } from '../../shared/services/apiClient';
import type {
  ArticleCmsLink,
  CmsConnection,
  CmsConnectionInput,
  CmsConnectionTestResult,
  CmsConnectorMeta,
  CmsPushHistoryEntry,
  CmsRemoteAuthor,
  PushMode,
  PushPreflight,
  PushResult,
} from '../../shared/types/cms';

/**
 * The CMS connector's API surface.
 *
 * Named for WordPress in the UI because WordPress is what the user is
 * configuring, but every call below is CMS-agnostic — the endpoints are
 * /api/cms/*, and a second connector needs no new client code.
 *
 * No function here ever receives a credential back from the server.
 * `hasCredential` is the only fact about a stored secret that reaches the
 * browser.
 */

export function fetchConnectorMeta(): Promise<CmsConnectorMeta[]> {
  return api.get<{ connectors: CmsConnectorMeta[] }>('/cms/meta').then((r) => r.connectors);
}

export function fetchConnections(): Promise<CmsConnection[]> {
  return api.get<{ connections: CmsConnection[] }>('/cms/connections').then((r) => r.connections);
}

export function fetchConnection(id: number): Promise<CmsConnection> {
  return api.get<{ connection: CmsConnection }>(`/cms/connections/${id}`).then((r) => r.connection);
}

export function createConnection(input: CmsConnectionInput): Promise<CmsConnection> {
  return api.post<{ connection: CmsConnection }>('/cms/connections', input).then((r) => r.connection);
}

export function updateConnection(id: number, input: CmsConnectionInput): Promise<CmsConnection> {
  return api.put<{ connection: CmsConnection }>(`/cms/connections/${id}`, input).then((r) => r.connection);
}

export function setConnectionStatus(id: number, isActive: boolean): Promise<CmsConnection> {
  return api.patch<{ connection: CmsConnection }>(`/cms/connections/${id}/status`, { isActive }).then((r) => r.connection);
}

export function setDefaultConnection(id: number): Promise<CmsConnection> {
  return api.patch<{ connection: CmsConnection }>(`/cms/connections/${id}/default`, {}).then((r) => r.connection);
}

export function setAuthorMapping(
  id: number,
  remoteAuthorId: string | null,
  remoteAuthorName: string | null,
): Promise<CmsConnection> {
  return api
    .patch<{ connection: CmsConnection }>(`/cms/connections/${id}/author-mapping`, { remoteAuthorId, remoteAuthorName })
    .then((r) => r.connection);
}

export function deleteConnection(id: number): Promise<void> {
  return api.delete(`/cms/connections/${id}`);
}

/**
 * TEST CONNECTION.
 *
 * Distinguishes a site that cannot be reached, a REST API that will not
 * answer, credentials that do not authenticate, and an account that cannot
 * post. Publishes nothing and creates nothing.
 *
 * A failed test resolves rather than rejects: the failure IS the answer, and
 * the stage matters as much as the message.
 */
export function testConnection(id: number): Promise<CmsConnectionTestResult> {
  return api.post<CmsConnectionTestResult>(`/cms/connections/${id}/test`, {});
}

/** The site's users, for the author mapping. A read; changes nothing. */
export function fetchRemoteAuthors(id: number): Promise<CmsRemoteAuthor[]> {
  return api.get<{ authors: CmsRemoteAuthor[] }>(`/cms/connections/${id}/authors`).then((r) => r.authors);
}

export function fetchRecentPushHistory(limit = 20): Promise<CmsPushHistoryEntry[]> {
  return api.get<{ entries: CmsPushHistoryEntry[] }>(`/cms/history?limit=${limit}`).then((r) => r.entries);
}

/* ------------------------------------------------------- article publishing */

/**
 * What pressing Push will do, before it does it: which site, which post,
 * whether this creates a new draft or updates the existing one, and exactly
 * what will be sent. Reads local state only — contacts no CMS.
 */
export function fetchPushPreflight(articleId: number, connectionId?: number | null): Promise<PushPreflight> {
  const query = connectionId ? `?connectionId=${connectionId}` : '';
  return api.get<{ preflight: PushPreflight }>(`/articles/${articleId}/cms/preflight${query}`).then((r) => r.preflight);
}

/**
 * Sends the article to the CMS as a DRAFT.
 *
 * `mode` is required and never inferred: the UI has already told the user
 * whether this creates a new post or updates an existing one, and the server
 * refuses if that no longer matches reality. Nothing here can publish.
 */
export function pushArticle(articleId: number, mode: PushMode, connectionId?: number | null): Promise<PushResult> {
  return api.post<PushResult>(`/articles/${articleId}/cms/push`, { mode, connectionId: connectionId ?? null });
}

/** Re-reads the remote post so Cynth reflects a status a human changed in the CMS. */
export function refreshArticleLink(articleId: number, connectionId: number): Promise<ArticleCmsLink> {
  return api.post<{ link: ArticleCmsLink }>(`/articles/${articleId}/cms/refresh`, { connectionId }).then((r) => r.link);
}

export function fetchArticlePushHistory(articleId: number): Promise<CmsPushHistoryEntry[]> {
  return api.get<{ entries: CmsPushHistoryEntry[] }>(`/articles/${articleId}/cms/history`).then((r) => r.entries);
}
