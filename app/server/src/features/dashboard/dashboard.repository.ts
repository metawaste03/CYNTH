import { getDatabase } from '../../shared/database/index.js';

export interface DashboardSummary {
  authors: { total: number; active: number };
  products: { total: number; active: number };
  articles: { total: number };
}

function count(sql: string): number {
  const db = getDatabase();
  const row = db.prepare(sql).get() as unknown as { count: number };
  return row.count;
}

/** Read-only aggregate counts for the Dashboard. No business logic — just COUNT(*) queries. */
export function getDashboardSummary(): DashboardSummary {
  return {
    authors: {
      total: count('SELECT COUNT(*) AS count FROM authors'),
      active: count('SELECT COUNT(*) AS count FROM authors WHERE is_active = 1'),
    },
    products: {
      total: count('SELECT COUNT(*) AS count FROM products'),
      active: count('SELECT COUNT(*) AS count FROM products WHERE is_active = 1'),
    },
    articles: {
      total: count('SELECT COUNT(*) AS count FROM articles'),
    },
  };
}
