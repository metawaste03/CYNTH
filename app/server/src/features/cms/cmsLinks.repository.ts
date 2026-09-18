import { getDatabase } from '../../shared/database/index.js';
import type { ArticleCmsLinkRow, CmsPushHistoryRow } from '../../shared/database/types.js';

/**
 * The relationship between a Cynth Article and its copy in a CMS, plus the
 * audit trail of every synchronisation attempt.
 *
 * The link row is what makes duplicate protection possible: its existence
 * means "this article is already over there", so a second Push is an update
 * rather than a new post. Without it, Cynth would create a fresh WordPress
 * draft on every click and quietly litter the site.
 *
 * Nothing here stores a credential.
 */

export interface ArticleCmsLinkDto {
  id: number;
  articleId: number;
  connectionId: number;
  /** The remote post id. Text, because not every CMS numbers its posts. */
  externalId: string;
  /** The remote post's status, as the CMS reports it — 'draft', 'publish', … */
  externalStatus: string | null;
  externalUrl: string | null;
  externalEditUrl: string | null;
  /** Denormalised so a deleted connection still leaves a readable record of where the content went. */
  siteUrl: string | null;
  firstPushedAt: string | null;
  lastPushedAt: string | null;
  lastSyncedAt: string | null;
}

function mapLink(row: ArticleCmsLinkRow): ArticleCmsLinkDto {
  return {
    id: row.id,
    articleId: row.article_id,
    connectionId: row.connection_id,
    externalId: row.external_id,
    externalStatus: row.external_status,
    externalUrl: row.external_url,
    externalEditUrl: row.external_edit_url,
    siteUrl: row.site_url,
    firstPushedAt: row.first_pushed_at,
    lastPushedAt: row.last_pushed_at,
    lastSyncedAt: row.last_synced_at,
  };
}

/** The link for one article/connection pair, or null when the article has never been pushed there. */
export function getLink(articleId: number, connectionId: number): ArticleCmsLinkDto | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM article_cms_links WHERE article_id = ? AND connection_id = ?')
    .get(articleId, connectionId) as unknown as ArticleCmsLinkRow | undefined;
  return row ? mapLink(row) : null;
}

/** Every CMS this article has been pushed to. An article can legitimately live on more than one site. */
export function listLinksForArticle(articleId: number): ArticleCmsLinkDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM article_cms_links WHERE article_id = ? ORDER BY id ASC')
    .all(articleId) as unknown as ArticleCmsLinkRow[];
  return rows.map(mapLink);
}

/** Article ids that have been pushed to at least one CMS, for list badges. */
export function listPushedArticleIds(): number[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT DISTINCT article_id FROM article_cms_links').all() as unknown as {
    article_id: number;
  }[];
  return rows.map((row) => row.article_id);
}

export interface UpsertLinkInput {
  articleId: number;
  connectionId: number;
  externalId: string;
  externalStatus: string | null;
  externalUrl: string | null;
  externalEditUrl: string | null;
  siteUrl: string | null;
}

/**
 * Records (or refreshes) where an article lives in a CMS.
 *
 * `first_pushed_at` is written once and never overwritten — the point of the
 * record is to know when the content first left Cynth, which a later update
 * must not erase.
 */
export function upsertLink(input: UpsertLinkInput): ArticleCmsLinkDto {
  const db = getDatabase();
  const existing = getLink(input.articleId, input.connectionId);

  if (existing) {
    db.prepare(`
      UPDATE article_cms_links SET
        external_id = ?, external_status = ?, external_url = ?, external_edit_url = ?, site_url = ?,
        last_pushed_at = datetime('now'), last_synced_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(
      input.externalId,
      input.externalStatus,
      input.externalUrl,
      input.externalEditUrl,
      input.siteUrl,
      existing.id,
    );
  } else {
    db.prepare(`
      INSERT INTO article_cms_links (
        article_id, connection_id, external_id, external_status, external_url, external_edit_url, site_url,
        first_pushed_at, last_pushed_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
    `).run(
      input.articleId,
      input.connectionId,
      input.externalId,
      input.externalStatus,
      input.externalUrl,
      input.externalEditUrl,
      input.siteUrl,
    );
  }

  return getLink(input.articleId, input.connectionId)!;
}

/**
 * Updates what Cynth believes the remote post's state is, without recording a
 * push. Used when re-reading the CMS to check whether the post still exists
 * and what status a human has since given it.
 */
export function refreshLinkState(
  linkId: number,
  externalStatus: string | null,
  externalUrl: string | null,
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE article_cms_links
    SET external_status = ?, external_url = ?, last_synced_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(externalStatus, externalUrl, linkId);
}

/** Forgets the relationship. Deliberately does NOT touch the remote post — Cynth does not delete other systems' content. */
export function deleteLink(articleId: number, connectionId: number): boolean {
  const db = getDatabase();
  const result = db
    .prepare('DELETE FROM article_cms_links WHERE article_id = ? AND connection_id = ?')
    .run(articleId, connectionId);
  return result.changes > 0;
}

/* --------------------------------------------------------------- history --- */

export type CmsPushOperation = 'create' | 'update' | 'test' | 'refresh';

export interface RecordPushInput {
  articleId: number | null;
  connectionId: number | null;
  connectionName: string | null;
  siteUrl: string | null;
  operation: CmsPushOperation;
  status: 'success' | 'failure';
  externalId?: string | null;
  externalStatus?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
}

export interface CmsPushHistoryEntryDto {
  id: number;
  articleId: number | null;
  connectionId: number | null;
  connectionName: string | null;
  siteUrl: string | null;
  operation: string;
  status: string;
  externalId: string | null;
  externalStatus: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

function mapHistory(row: CmsPushHistoryRow): CmsPushHistoryEntryDto {
  return {
    id: row.id,
    articleId: row.article_id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    siteUrl: row.site_url,
    operation: row.operation,
    status: row.status,
    externalId: row.external_id,
    externalStatus: row.external_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

/**
 * One synchronisation attempt, success or failure.
 *
 * What is deliberately NOT recorded: credentials, authorization headers,
 * environment variable values, and raw CMS response bodies. Error messages
 * pass through sanitizeCmsMessage() before they reach here.
 */
export function recordPush(input: RecordPushInput): number {
  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO cms_push_history (
        article_id, connection_id, connection_name, site_url, operation, status,
        external_id, external_status, error_code, error_message, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.articleId,
      input.connectionId,
      input.connectionName,
      input.siteUrl,
      input.operation,
      input.status,
      input.externalId ?? null,
      input.externalStatus ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.durationMs ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function listPushHistoryForArticle(articleId: number, limit = 20): CmsPushHistoryEntryDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM cms_push_history WHERE article_id = ? ORDER BY id DESC LIMIT ?')
    .all(articleId, limit) as unknown as CmsPushHistoryRow[];
  return rows.map(mapHistory);
}

/** Recent synchronisation activity across every article, for the settings screen. */
export function listRecentPushHistory(limit = 20): CmsPushHistoryEntryDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM cms_push_history ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as CmsPushHistoryRow[];
  return rows.map(mapHistory);
}
