/**
 * Renames Cynth's thematic areas to the names EveryFiveDays publishes.
 *
 * WHY. The two vocabularies had drifted, and only two of the five matched:
 *
 *   Smart Pet Care          = Smart Pet Care
 *   Sleep & Recovery        = Sleep & Recovery
 *   Cognitive Performance  != Cognitive Performance & Nootropics
 *   Fitness Technology     != Fitness Tech & Biohacking
 *   Productive Workspaces  != Productive Workspace Setups
 *
 * The site's names are the ones a reader sees, so they are the ones that win.
 * Aligning them removes a translation table that would otherwise sit between
 * Cynth and the site forever, silently showing nothing on three of the five
 * category pages the first time somebody edited one side and not the other.
 *
 * Product categories follow automatically: they are derived from the thematic
 * area, so `npm run normalise:categories` after this moves every product with
 * its area. That is the behaviour that script was built for.
 *
 * Renaming is safe referentially — articles, products and themes are joined by
 * id, never by name.
 *
 * Usage:  npm run align:themes -- [--write]
 */
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';
import { slugify } from '../src/shared/text/slug.js';

initializeDatabase();
const db = getDatabase();
const write = process.argv.includes('--write');

/** The site's five, as published. Read from EveryFiveDays, not invented here. */
const SITE_NAMES: Record<string, string> = {
  'Cognitive Performance & Nootropics': 'Cognitive Performance',
  'Fitness Tech & Biohacking': 'Fitness Technology',
  'Productive Workspace Setups': 'Productive Workspaces',
  'Smart Pet Care': 'Smart Pet Care',
  'Sleep & Recovery': 'Sleep & Recovery',
};

const themes = db.prepare('SELECT id, name, slug FROM themes ORDER BY id').all() as {
  id: number;
  name: string;
  slug: string;
}[];

const changes: { id: number; from: string; to: string }[] = [];
const untouched: string[] = [];

/** The names the site publishes, so an already-correct theme is not reported as unknown. */
const ALIGNED = new Set(Object.values(SITE_NAMES));

for (const theme of themes) {
  const target = SITE_NAMES[theme.name];
  if (!target) {
    // Already one of the site's names means aligned, not unrecognised. The map
    // is keyed by the OLD name, so a renamed theme no longer appears in it —
    // which read as a warning about the three areas that were already right.
    if (!ALIGNED.has(theme.name)) untouched.push(theme.name);
    continue;
  }
  if (target === theme.name) continue;
  changes.push({ id: theme.id, from: theme.name, to: target });
}

/**
 * THE SLUG HAS TO FOLLOW THE NAME, and the first run of this script forgot it.
 *
 * Renaming left three areas carrying the old name's slug —
 * `fitness-tech-biohacking` on "Fitness Technology" — which nothing read, so
 * nothing broke, which is exactly what makes it worth fixing now rather than
 * when something starts reading it and quietly matches the wrong area.
 *
 * Computed from the name each theme will END UP with, so a rename and a slug
 * refresh in the same run agree with each other.
 */
const reslug: { id: number; name: string; from: string; to: string }[] = [];
for (const theme of themes) {
  const finalName = SITE_NAMES[theme.name] ?? theme.name;
  const wanted = slugify(finalName);
  if (wanted && wanted !== theme.slug) {
    reslug.push({ id: theme.id, name: finalName, from: theme.slug, to: wanted });
  }
}

console.log(`${themes.length} thematic areas: ${changes.length} to rename, ${reslug.length} slug(s) to refresh.\n`);
for (const change of changes) {
  console.log(`  name  #${change.id}  ${change.from.padEnd(36)} -> ${change.to}`);
}
for (const change of reslug) {
  console.log(`  slug  #${change.id}  ${change.from.padEnd(36)} -> ${change.to}`);
}
if (untouched.length) {
  console.log(`\nNot in the site's list, left alone: ${untouched.join(', ')}`);
}

if (!changes.length && !reslug.length) {
  console.log('\nAlready aligned.');
  process.exit(0);
}

if (!write) {
  console.log('\nDry run. Nothing written. Re-run with --write.');
  if (changes.length) console.log('Afterwards: npm run normalise:categories -- --write');
  process.exit(0);
}

const rename = db.prepare("UPDATE themes SET name = ?, updated_at = datetime('now') WHERE id = ?");
for (const change of changes) rename.run(change.to, change.id);

const setSlug = db.prepare("UPDATE themes SET slug = ?, updated_at = datetime('now') WHERE id = ?");
for (const change of reslug) setSlug.run(change.to, change.id);

if (changes.length) {
  console.log(`\nRenamed ${changes.length} thematic area(s).`);
  console.log('Now run:  npm run normalise:categories -- --write');
}
if (reslug.length) {
  console.log(`Refreshed ${reslug.length} slug(s).`);
}
