/**
 * Where should the coverage thresholds sit?
 *
 * Embeds every stored article's points and scores them against each other,
 * in memory. Nothing is written to the database. The catalogue already holds
 * known near-duplicates — three articles that explain caffeine timing, two on
 * subscriptions — so the scores those pairs produce are the evidence a
 * threshold is set from, rather than a number picked because it looks round.
 *
 * Three comparisons, matching the three places the graph will check:
 *   1. topic   — title + introduction against every other article's (the topic gate)
 *   2. heading — each H2 heading alone against every other article's points (the brief gate,
 *                which only has planned headings to go on)
 *   3. point   — each section against every other article's sections (the draft backstop)
 *
 * Costs one embedding pass over the catalogue: about a fifth of a cent.
 *
 * Usage:  npx tsx scripts/coverage-calibrate.ts [--out file.json]
 */
import { writeFileSync } from 'node:fs';
import { loadSecrets } from '../src/shared/secrets/secretStore.js';
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';
import { embedTexts, resolveEmbeddingTarget, similarity } from '../src/features/coverage-graph/embeddings.service.js';
import { embeddingInput, splitIntoPoints, INTRODUCTION_HEADING } from '../src/features/coverage-graph/points.js';

loadSecrets();
initializeDatabase();

const outIndex = process.argv.indexOf('--out');
const outFile = outIndex > 0 ? process.argv[outIndex + 1] : null;

const rows = getDatabase()
  .prepare(
    `SELECT a.id, COALESCE(NULLIF(TRIM(a.title), ''), a.generated_title) AS title, t.name AS area, a.content
     FROM articles a LEFT JOIN themes t ON t.id = a.theme_id
     WHERE TRIM(COALESCE(a.content, '')) <> '' AND a.theme_id IS NOT NULL ORDER BY a.id`,
  )
  .all() as { id: number; title: string; area: string; content: string }[];

interface P { articleId: number; area: string; title: string; heading: string; parent: string | null; index: number; vector?: Float32Array }

const points: P[] = [];
const topics: P[] = [];
const headings: P[] = [];
const texts: string[] = [];

for (const row of rows) {
  const split = splitIntoPoints(row.content);
  for (const point of split) {
    points.push({ articleId: row.id, area: row.area, title: row.title, heading: point.heading, parent: point.parentHeading, index: texts.length });
    texts.push(embeddingInput(point));
  }
  const intro = split.find((p) => p.heading === INTRODUCTION_HEADING)?.text ?? '';
  topics.push({ articleId: row.id, area: row.area, title: row.title, heading: '(topic)', parent: null, index: texts.length });
  texts.push(`${row.title}\n${intro.slice(0, 1200)}`);
  for (const point of split) {
    if (point.parentHeading || point.heading === INTRODUCTION_HEADING) continue;
    headings.push({ articleId: row.id, area: row.area, title: row.title, heading: point.heading, parent: null, index: texts.length });
    texts.push(`${row.title} — ${point.heading}`);
  }
}

const target = resolveEmbeddingTarget();
console.log(`Embedding ${texts.length} texts from ${rows.length} articles with ${target.model} via ${target.providerName}...`);
const result = await embedTexts(texts, target);
for (const p of [...points, ...topics, ...headings]) p.vector = result.vectors[p.index];
console.log(`Done: ${result.promptTokens} tokens, reported cost ${result.reportedCost ?? 'not reported'}.`);

function bestAgainst(probe: P, pool: P[]) {
  let best: { score: number; match: P } | null = null;
  for (const other of pool) {
    if (other.articleId === probe.articleId) continue;
    const score = similarity(probe.vector!, other.vector!);
    if (!best || score > best.score) best = { score, match: other };
  }
  return best!;
}

const label = (p: P) => `#${p.articleId} ${p.title.slice(0, 48)}${p.heading !== '(topic)' ? ` › ${p.parent ? p.parent + ' › ' : ''}${p.heading}` : ''}`;

function report(name: string, probes: P[], pool: P[], top = 20) {
  const scored = probes.map((probe) => ({ probe, ...bestAgainst(probe, pool) })).sort((a, b) => b.score - a.score);
  const scores = scored.map((s) => s.score);
  const pct = (q: number) => scores[Math.min(scores.length - 1, Math.floor((1 - q) * scores.length))].toFixed(3);
  console.log(`\n=== ${name} (${probes.length} probes) — best match in another article ===`);
  console.log(`max ${scores[0].toFixed(3)} · p95 ${pct(0.95)} · p90 ${pct(0.9)} · p75 ${pct(0.75)} · median ${pct(0.5)}`);
  for (const s of scored.slice(0, top)) {
    console.log(`${s.score.toFixed(3)}  ${label(s.probe)}\n        ≈ ${label(s.match)}${s.match.area !== s.probe.area ? `  [other area: ${s.match.area}]` : ''}`);
  }
  return scored.map((s) => ({ score: s.score, probe: label(s.probe), match: label(s.match), crossArea: s.match.area !== s.probe.area }));
}

const output = {
  model: target.model,
  tokens: result.promptTokens,
  topic: report('TOPIC vs other topics', topics, topics, 15),
  heading: report('PLANNED HEADING vs existing points', headings, points, 20),
  point: report('POINT vs existing points', points.filter((p) => p.heading !== INTRODUCTION_HEADING), points, 25),
};

if (outFile) {
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\nFull results written to ${outFile}`);
}
