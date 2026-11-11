/**
 * Is an area actually covering what its brief says it covers?
 *
 * Smart Pet Care's brief is explicit — "DOGS AND CATS BOTH. The back catalogue
 * skews heavily to cats and to devices; correct for that rather than
 * continuing it." The instruction sits in the one place topic research reads.
 * Nothing could say whether it was working, which is the whole reason this
 * exists: an instruction nobody can check is a hope.
 *
 * Counts words against the area's declared vocabulary and prints what it
 * found. It does not judge, and it never blocks anything — a lopsided tally is
 * a question for a person, not a rule.
 *
 * Usage:  npm run balance
 *         npm run balance -- "Smart Pet Care"
 */
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';
import { getAreaBalance } from '../src/features/articles/areaBalance.service.js';

initializeDatabase();
const db = getDatabase();

const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const names = requested.length
  ? requested
  : (db.prepare('SELECT name FROM themes ORDER BY id').all() as { name: string }[]).map((t) => t.name);

let measured = 0;

for (const name of names) {
  const balance = getAreaBalance(name);
  if (!balance) continue;
  measured++;

  console.log(`\n${'='.repeat(64)}\n${balance.themeName}\n${'='.repeat(64)}`);

  const total = balance.articles.length;
  console.log(`\nArticles (${total})`);
  for (const facet of balance.facets) {
    const share = total ? Math.round((facet.specific / total) * 100) : 0;
    console.log(`  ${facet.label.padEnd(16)} ${String(facet.specific).padStart(3)}  (${share}%)   ${facet.mentions} mentions`);
  }
  console.log(`  ${'both or neither'.padEnd(16)} ${String(balance.sharedOrNeutral).padStart(3)}`);
  for (const article of balance.articles) {
    console.log(`      #${String(article.id).padEnd(4)} ${article.title.slice(0, 50).padEnd(52)} ${article.focus}`);
  }

  console.log(`\nProducts in the library (${balance.products.length})`);
  for (const facet of balance.facets) {
    const n = balance.products.filter((p) => p.focus === facet.label).length;
    const share = balance.products.length ? Math.round((n / balance.products.length) * 100) : 0;
    console.log(`  ${facet.label.padEnd(16)} ${String(n).padStart(3)}  (${share}%)`);
  }
  const neutral = balance.products.filter((p) => !balance.facets.some((f) => f.label === p.focus)).length;
  console.log(`  ${'both or neither'.padEnd(16)} ${String(neutral).padStart(3)}`);
  for (const product of balance.products) {
    console.log(`      #${String(product.id).padEnd(4)} ${product.title.slice(0, 50).padEnd(52)} ${product.focus}`);
  }

  /**
   * THE READING, OVER ALL THREE DIMENSIONS.
   *
   * The first version judged on article counts alone and announced "no clear
   * skew" across a library of seven cat products and one dog product, because
   * the two articles happened to be one each. A measure that reassures you
   * about the exact thing you asked it to watch is worse than no measure. Each
   * dimension is now reported on its own, and a sample too small to mean
   * anything says so instead of returning a verdict.
   */
  const dimensions = [
    { what: 'articles', counts: balance.facets.map((f) => ({ label: f.label, n: f.specific })), sample: total },
    {
      what: 'mentions across the area',
      counts: balance.facets.map((f) => ({ label: f.label, n: f.mentions })),
      sample: balance.facets.reduce((sum, f) => sum + f.mentions, 0),
    },
    {
      what: 'products',
      counts: balance.facets.map((f) => ({
        label: f.label,
        n: balance.products.filter((p) => p.focus === f.label).length,
      })),
      sample: balance.products.length,
    },
  ];

  /** Two to one is where a lean becomes a pattern a reader would notice. */
  const leans = (counts: { label: string; n: number }[]) => {
    const sorted = [...counts].sort((a, b) => b.n - a.n);
    return { sorted, skewed: sorted[0].n >= Math.max(2, sorted[1].n * 2) };
  };

  console.log('');
  const skewedDimensions: typeof dimensions = [];

  for (const dimension of dimensions) {
    if (dimension.sample < 4) {
      console.log(`  ${dimension.what}: too few to read (${dimension.sample}).`);
      continue;
    }
    const { sorted, skewed } = leans(dimension.counts);
    if (skewed) {
      skewedDimensions.push(dimension);
      console.log(`  SKEW in ${dimension.what}: ${sorted[0].label} ${sorted[0].n} to ${sorted[1].label} ${sorted[1].n}.`);
    } else {
      console.log(`  ${dimension.what}: no clear lean (${sorted.map((c) => `${c.label} ${c.n}`).join(', ')}).`);
    }
  }

  if (skewedDimensions.length) {
    const starved = leans(skewedDimensions[0].counts).sorted.slice(-1)[0];
    console.log(`\n  -> The next article and the next products in this area should serve "${starved.label}".`);
  }
}

if (!measured) {
  console.log('No area in that list declares facets to measure. See AREA_FACETS in areaBalance.service.ts.');
}
