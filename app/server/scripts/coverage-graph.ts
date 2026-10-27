/**
 * Brings the coverage graph up to date and prints each area's scope map:
 * which subtopics have articles, which have only been touched by a section,
 * and which have never been written about.
 *
 * Only articles whose text changed since they were last indexed are embedded,
 * so a second run with nothing new costs nothing.
 *
 * Usage:  npm run coverage
 *         npm run coverage -- "Sleep & Recovery"
 *         npm run coverage -- --points     (also list each article's linked points)
 */
import { loadSecrets } from '../src/shared/secrets/secretStore.js';
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';
import { isCovered, subtopicCoverage, syncCoverageGraph } from '../src/features/coverage-graph/coverageGraph.service.js';

loadSecrets();
initializeDatabase();
const db = getDatabase();

const args = process.argv.slice(2);
const showPoints = args.includes('--points');
const requested = args.filter((a) => !a.startsWith('--'));

const summary = await syncCoverageGraph();
console.log(
  `Graph synced with ${summary.model}: ${summary.indexed.length} article(s) indexed, ${summary.removed.length} removed, ` +
    `${summary.subtopicsEmbedded} subtopic(s) embedded, ${summary.promptTokens} tokens, cost ${summary.reportedCost ?? 'not reported'}.`,
);

const themes = db.prepare('SELECT id, name FROM themes ORDER BY id').all() as { id: number; name: string }[];

for (const theme of themes) {
  if (requested.length && !requested.includes(theme.name)) continue;
  const coverage = subtopicCoverage(theme.id);
  if (!coverage.length) continue;

  console.log(`\n${'='.repeat(70)}\n${theme.name}\n${'='.repeat(70)}`);
  for (const ring of ['core', 'adjacent', 'approved', 'proposed', 'rejected']) {
    const subs = coverage.filter((s) => s.ring === ring);
    if (!subs.length) continue;
    const covered = subs.filter(isCovered).length;
    console.log(`\n${ring.toUpperCase()} — ${covered} of ${subs.length} covered`);
    for (const sub of subs) {
      const mark = isCovered(sub) ? '■' : '□';
      const primary = sub.primaryArticles.map((a) => `#${a.id}`).join(' ');
      const touched = sub.touchedBy.map((t) => `#${t.id}×${t.points}`).join(' ');
      console.log(`  ${mark} ${sub.name.padEnd(40)} ${primary ? `main: ${primary}` : ''}${touched ? `  sections: ${touched}` : ''}`);
    }
  }
}

if (showPoints) {
  const links = db
    .prepare(
      `SELECT a.article_id AS a_id, a.heading AS a_heading, b.article_id AS b_id, b.heading AS b_heading, l.score
       FROM coverage_point_links l JOIN coverage_points a ON a.id = l.point_id JOIN coverage_points b ON b.id = l.other_point_id
       WHERE l.point_id < l.other_point_id ORDER BY l.score DESC LIMIT 40`,
    )
    .all() as { a_id: number; a_heading: string; b_id: number; b_heading: string; score: number }[];
  console.log(`\nStrongest point links (${links.length}):`);
  for (const link of links) console.log(`  ${link.score.toFixed(3)}  #${link.a_id} ${link.a_heading}  ~  #${link.b_id} ${link.b_heading}`);
}
