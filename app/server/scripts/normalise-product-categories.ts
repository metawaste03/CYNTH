/**
 * Collapses free-text product categories onto the thematic areas.
 *
 * WHY. `products.category` was a free-text box beside a Thematic Area
 * dropdown, and the two say the same thing — so the box collected variants of
 * the dropdown's answer: "Pet Product", "Pet Products", "Pet Device", "Pet
 * device", "Pet Treats", "Pet treats"; "Sleep Gadget" and "Sleep Gadgets";
 * "Cognitive Performance" and "Cognitive Permance". Seventeen categories for
 * thirty-four products, and the filter dropdown listed all seventeen.
 *
 * THE THEME IS THE SOURCE OF TRUTH. Every category is derived from the
 * product's thematic area rather than from string-matching the old text: the
 * theme is a real reference to a real row, and the text was always a
 * paraphrase of it. Where a product has no theme, the old text is matched
 * against the theme names as a fallback, and anything still unresolved is left
 * exactly as it is for a person to look at.
 *
 * NOT HARDCODED. The five names are read from the themes table. Renaming a
 * thematic area and re-running this moves the products with it.
 *
 * Usage:  npm run normalise:categories -- [--write]
 */
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';

initializeDatabase();
const db = getDatabase();
const write = process.argv.includes('--write');

const themes = db.prepare('SELECT id, name FROM themes ORDER BY id').all() as { id: number; name: string }[];
const byId = new Map(themes.map((theme) => [theme.id, theme.name]));

/** Normalised for comparison only — never stored. */
const flatten = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
const byFlatName = new Map(themes.map((theme) => [flatten(theme.name), theme.name]));

const products = db
  .prepare('SELECT id, title, category, theme_id FROM products ORDER BY id')
  .all() as { id: number; title: string; category: string | null; theme_id: number | null }[];

const changes: { id: number; from: string; to: string; via: string }[] = [];
const unresolved: { id: number; title: string; category: string | null }[] = [];

for (const product of products) {
  const current = (product.category ?? '').trim();

  const fromTheme = product.theme_id !== null ? byId.get(product.theme_id) : undefined;
  const fromText = current ? byFlatName.get(flatten(current)) : undefined;
  const target = fromTheme ?? fromText;

  if (!target) {
    unresolved.push({ id: product.id, title: product.title, category: product.category });
    continue;
  }

  if (current === target) continue;
  changes.push({ id: product.id, from: current || '(none)', to: target, via: fromTheme ? 'theme' : 'name match' });
}

console.log(`${products.length} products, ${themes.length} thematic areas.`);
console.log(`${changes.length} to change, ${unresolved.length} left alone.\n`);

for (const change of changes) {
  console.log(`  #${String(change.id).padStart(3)}  ${change.from.padEnd(24)} -> ${change.to.padEnd(34)} (${change.via})`);
}

if (unresolved.length) {
  console.log('\nNo thematic area and no name match — left exactly as they are:');
  for (const row of unresolved) {
    console.log(`  #${String(row.id).padStart(3)}  ${String(row.category ?? '(none)').padEnd(24)} ${row.title.slice(0, 40)}`);
  }
}

if (!write) {
  console.log('\nDry run. Nothing written. Re-run with --write.');
  process.exit(0);
}

const update = db.prepare("UPDATE products SET category = ?, updated_at = datetime('now') WHERE id = ?");
for (const change of changes) update.run(change.to, change.id);

console.log(`\nWrote ${changes.length} categor${changes.length === 1 ? 'y' : 'ies'}.`);

const after = db
  .prepare("SELECT COALESCE(NULLIF(TRIM(category),''),'(none)') c, COUNT(*) n FROM products GROUP BY c ORDER BY n DESC")
  .all() as { c: string; n: number }[];
console.log('\nCategories now in use:');
for (const row of after) console.log(`  ${String(row.n).padStart(3)}  ${row.c}`);
