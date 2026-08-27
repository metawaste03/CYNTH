export interface DashboardSummary {
  authors: { total: number; active: number };
  products: { total: number; active: number };
  /** Aggregate counts for the summary cards only — the Dashboard's article list reads real Article records instead. */
  articles: { total: number; draft: number; published: number };
  /** WordPress integration state. Real counts, never a placeholder. */
  wordpress: {
    connections: number;
    activeConnections: number;
    pushedArticles: number;
    remoteDrafts: number;
  };
}
