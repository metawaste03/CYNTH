/**
 * Scores hand-written probes against the stored catalogue: reworded duplicates
 * that SHOULD be stopped, new in-scope topics that should NOT be, and section
 * plans written the way the brief gate will see them. In memory; writes nothing.
 *
 * Usage:  npx tsx scripts/coverage-probe.ts probes.json
 *   probes.json: [{ "kind": "duplicate|neighbour|novel|section-dup|section-new", "text": "..." }]
 */
import { readFileSync } from 'node:fs';
import { loadSecrets } from '../src/shared/secrets/secretStore.js';
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';
import { embedTexts, similarity } from '../src/features/coverage-graph/embeddings.service.js';
import { embeddingInput, splitIntoPoints, INTRODUCTION_HEADING } from '../src/features/coverage-graph/points.js';

loadSecrets();
initializeDatabase();

const probes = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { kind: string; text: string }[];
const rows = getDatabase()
  .prepare(
    `SELECT id, COALESCE(NULLIF(TRIM(title), ''), generated_title) AS title, content FROM articles
     WHERE TRIM(COALESCE(content, '')) <> '' AND theme_id IS NOT NULL`,
  )
  .all() as { id: number; title: string; content: string }[];

const pool: { label: string; topic: boolean; text: string }[] = [];
for (const row of rows) {
  const split = splitIntoPoints(row.content);
  const intro = split.find((p) => p.heading === INTRODUCTION_HEADING)?.text ?? '';
  pool.push({ label: `#${row.id} ${row.title.slice(0, 50)} (topic)`, topic: true, text: `${row.title}\n${intro.slice(0, 1200)}` });
  for (const p of split) pool.push({ label: `#${row.id} > ${p.heading}`, topic: false, text: embeddingInput(p) });
}

const { vectors } = await embedTexts([...pool.map((p) => p.text), ...probes.map((p) => p.text)]);
const poolVecs = vectors.slice(0, pool.length);
const probeVecs = vectors.slice(pool.length);

probes.forEach((probe, i) => {
  const best = (topic: boolean) => {
    let found = { score: -1, label: '' };
    pool.forEach((p, j) => {
      if (p.topic !== topic) return;
      const score = similarity(probeVecs[i], poolVecs[j]);
      if (score > found.score) found = { score, label: p.label };
    });
    return found;
  };
  const t = best(true);
  const s = best(false);
  const pad = ' '.repeat(13);
  console.log(
    `${probe.kind.padEnd(12)} topic ${t.score.toFixed(3)} | point ${s.score.toFixed(3)}  ${probe.text.split('\n')[0].slice(0, 70)}\n` +
      `${pad}topic~ ${t.label}\n${pad}point~ ${s.label}`,
  );
});
