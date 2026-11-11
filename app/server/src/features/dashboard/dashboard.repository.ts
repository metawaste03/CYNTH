import { getDatabase } from '../../shared/database/index.js';
import { countArticlesByStatus } from '../articles/articles.repository.js';

export interface DashboardSummary {
  authors: { total: number; active: number };
  products: { total: number; active: number };
  /** Media library assets, and how many are filed under a thematic area — an unfiled image is hard to match. */
  media: { total: number; filed: number };
  /**
   * Article counts by lifecycle state, derived from the `articles` table.
   *
   * These are aggregates for the summary cards only. The Dashboard's article
   * list does not use them — it reads real Article records from
   * GET /api/articles, because a count cannot be opened, read, or edited.
   */
  articles: { total: number; draft: number; published: number };
  /**
   * WordPress / CMS integration state (Milestone 13). Real counts from the
   * `cms_connections` and `article_cms_links` tables — never a placeholder.
   */
  wordpress: {
    /** Configured connections, and how many are active. */
    connections: number;
    activeConnections: number;
    /** Articles that currently exist as a post in at least one CMS. */
    pushedArticles: number;
    /** Of those, how many are still drafts over there. The rest a human has acted on. */
    remoteDrafts: number;
  };
}

function count(sql: string): number {
  const db = getDatabase();
  const row = db.prepare(sql).get() as unknown as { count: number };
  return row.count;
}

/** Read-only aggregate counts for the Dashboard. No business logic — COUNT(*) queries and one GROUP BY. */
export function getDashboardSummary(): DashboardSummary {
  const byStatus = countArticlesByStatus();

  return {
    authors: {
      total: count('SELECT COUNT(*) AS count FROM authors'),
      active: count('SELECT COUNT(*) AS count FROM authors WHERE is_active = 1'),
    },
    products: {
      total: count('SELECT COUNT(*) AS count FROM products'),
      active: count('SELECT COUNT(*) AS count FROM products WHERE is_active = 1'),
    },
    media: {
      total: count('SELECT COUNT(*) AS count FROM media_assets'),
      filed: count('SELECT COUNT(*) AS count FROM media_assets WHERE theme_id IS NOT NULL'),
    },
    articles: {
      total: count('SELECT COUNT(*) AS count FROM articles'),
      draft: byStatus.draft ?? 0,
      published: byStatus.published ?? 0,
    },
    wordpress: {
      connections: count('SELECT COUNT(*) AS count FROM cms_connections'),
      activeConnections: count('SELECT COUNT(*) AS count FROM cms_connections WHERE is_active = 1'),
      pushedArticles: count('SELECT COUNT(DISTINCT article_id) AS count FROM article_cms_links'),
      remoteDrafts: count("SELECT COUNT(*) AS count FROM article_cms_links WHERE external_status = 'draft'"),
    },
  };
}
