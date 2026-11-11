import { Router } from 'express';
import { getDatabase } from '../../shared/database/index.js';
import { setSetting } from '../../shared/settings/settings.repository.js';
import { AREA_SCOPES } from './coverageScope.js';
import {
  decideSubtopic,
  getThresholds,
  isCovered,
  subtopicCoverage,
  syncCoverageGraph,
  thresholdSettingKeys,
} from './coverageGraph.service.js';
import type { CoverageThresholds } from './coverageGraph.service.js';

/**
 * COVERAGE — HTTP surface.
 *
 * Reads are free: they report what the graph already holds. Two endpoints
 * write: `sync`, which embeds any article that changed (a fraction of a cent),
 * and a subtopic decision, which is the editor approving or rejecting a
 * subtopic topic research proposed. Nothing here writes an article.
 */
export const coverageGraphRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The whole map: every area's scope, how much of it has been reached, and what waits for a decision. */
coverageGraphRouter.get('/', (_req, res) => {
  const db = getDatabase();
  const themes = db.prepare('SELECT id, name FROM themes ORDER BY id').all() as { id: number; name: string }[];

  const totals = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM coverage_articles) AS articles,
              (SELECT COUNT(*) FROM coverage_points) AS points,
              (SELECT COUNT(*) / 2 FROM coverage_point_links) AS links,
              (SELECT MAX(indexed_at) FROM coverage_articles) AS last_indexed_at,
              (SELECT MAX(model) FROM coverage_articles) AS model`,
    )
    .get() as { articles: number; points: number; links: number; last_indexed_at: string | null; model: string | null };

  const areas = themes
    .filter((theme) => AREA_SCOPES[theme.name])
    .map((theme) => {
      const subtopics = subtopicCoverage(theme.id).map((sub) => ({ ...sub, covered: isCovered(sub) }));
      const articleCount = (
        db.prepare('SELECT COUNT(*) AS n FROM coverage_articles WHERE theme_id = ?').get(theme.id) as { n: number }
      ).n;
      return { themeId: theme.id, name: theme.name, coreIdea: AREA_SCOPES[theme.name].coreIdea, articleCount, subtopics };
    });

  res.json({
    thresholds: getThresholds(),
    graph: {
      articles: totals.articles,
      points: totals.points,
      links: totals.links,
      lastIndexedAt: totals.last_indexed_at,
      model: totals.model,
    },
    areas,
  });
});

/**
 * The strongest repeats already in the catalogue: pairs of sections in
 * different articles that say much the same thing. Useful for deciding what
 * to consolidate, and for seeing what the draft gate would have caught.
 */
coverageGraphRouter.get('/repeats', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const rows = getDatabase()
    .prepare(
      `SELECT l.score, a.article_id AS a_id, aa.title AS a_title, a.heading AS a_heading,
              b.article_id AS b_id, ba.title AS b_title, b.heading AS b_heading
       FROM coverage_point_links l
       JOIN coverage_points a ON a.id = l.point_id JOIN coverage_articles aa ON aa.article_id = a.article_id
       JOIN coverage_points b ON b.id = l.other_point_id JOIN coverage_articles ba ON ba.article_id = b.article_id
       WHERE l.point_id < l.other_point_id ORDER BY l.score DESC LIMIT ?`,
    )
    .all(limit) as {
    score: number;
    a_id: number;
    a_title: string;
    a_heading: string;
    b_id: number;
    b_title: string;
    b_heading: string;
  }[];

  res.json({
    draftBlock: getThresholds().draftBlock,
    repeats: rows.map((row) => ({
      score: row.score,
      a: { articleId: row.a_id, title: row.a_title, heading: row.a_heading },
      b: { articleId: row.b_id, title: row.b_title, heading: row.b_heading },
    })),
  });
});

/** Embeds whatever changed since the last sync. */
coverageGraphRouter.post('/sync', async (_req, res) => {
  try {
    const summary = await syncCoverageGraph();
    res.json({ summary });
  } catch (error) {
    res.status(502).json({ errors: [error instanceof Error ? error.message : 'The coverage graph could not be synced.'] });
  }
});

/** The editor's answer to a proposed subtopic. */
coverageGraphRouter.post('/subtopics/:id/decision', (req, res) => {
  const id = parseId(req.params.id);
  const decision = req.body?.decision;
  if (!id) return res.status(400).json({ errors: ['Invalid subtopic id.'] });
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ errors: ['The decision must be "approve" or "reject".'] });
  }
  if (!decideSubtopic(id, decision)) {
    return res.status(409).json({ errors: ['That subtopic is not waiting for a decision.'] });
  }
  // An approved subtopic needs a vector before it can be matched; a sync
  // provides it on the next topic research, so nothing is spent here.
  return res.json({ ok: true });
});

/** Moves a threshold. Each is a similarity between 0 and 1 (the cut share is a fraction). */
coverageGraphRouter.put('/thresholds', (req, res) => {
  const keys = thresholdSettingKeys();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const updates: [string, number][] = [];

  for (const [field, raw] of Object.entries(body)) {
    if (!(field in keys)) {
      errors.push(`Unknown threshold "${field}".`);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      errors.push(`"${field}" must be a number above 0 and at most 1.`);
      continue;
    }
    updates.push([keys[field as keyof CoverageThresholds], value]);
  }

  if (errors.length) return res.status(400).json({ errors });
  for (const [key, value] of updates) setSetting(key, String(value));
  return res.json({ thresholds: getThresholds() });
});
