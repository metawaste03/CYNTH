/**
 * Maps each CYNTH author persona to the WordPress user their articles are
 * attributed to.
 *
 * Before this existed, every push carried the connection's single default
 * author, so five voices arrived in WordPress under one byline and had to be
 * reassigned by hand.
 *
 * Idempotent and re-runnable. Matching is by author NAME — the value the
 * owner maintains in both systems — and every decision is printed. An author
 * that cannot be matched is reported and left alone rather than guessed at,
 * because a wrong mapping means an article filed under somebody else's name.
 *
 * The ids below are the ones on the local install (see
 * `Everyfivedays/AUTHOR ACCOUNTS.md`). A different WordPress numbers its users
 * differently — edit MAPPING and re-run.
 *
 * Run with:  npm --prefix app/server run map:authors          (dry run)
 *            npm --prefix app/server run map:authors -- --apply
 */
import { initializeDatabase, closeDatabase, getDatabase, DATABASE_PATH } from '../src/shared/database/index.js';

/** Author display name -> WordPress user id. */
const MAPPING: Record<string, string> = {
  'Naomi Alvarez': '2',
  'Devon Cho': '3',
  'Priya Anand': '4',
  'Theo Lindqvist': '5',
  'Mara Kessler': '6',
};

const apply = process.argv.includes('--apply');

initializeDatabase();
console.log(`Database: ${DATABASE_PATH}`);
console.log(apply ? '\nAPPLYING mapping\n' : '\nDRY RUN — pass --apply to write\n');

const db = getDatabase();

const authors = db
  .prepare('SELECT id, name, remote_author_id FROM authors ORDER BY id')
  .all() as unknown as { id: number; name: string; remote_author_id: string | null }[];

if (authors.length === 0) {
  console.log('No authors in CYNTH yet — nothing to map.');
  closeDatabase();
  process.exit(0);
}

let matched = 0;
const unmatched: string[] = [];

for (const author of authors) {
  const target = MAPPING[author.name.trim()];

  if (!target) {
    unmatched.push(`${author.id}  ${author.name}`);
    continue;
  }

  matched++;

  if (author.remote_author_id === target) {
    console.log(`  OK     ${author.name} -> WP ${target} (already set)`);
    continue;
  }

  if (apply) {
    db.prepare("UPDATE authors SET remote_author_id = ?, updated_at = datetime('now') WHERE id = ?").run(
      target,
      author.id,
    );
    console.log(`  SET    ${author.name} -> WP ${target}`);
  } else {
    console.log(`  WOULD  ${author.name} -> WP ${target}`);
  }
}

console.log(`\nmatched ${matched} of ${authors.length} authors`);

if (unmatched.length) {
  console.log('\nLeft unmapped — these keep the connection default:');
  for (const line of unmatched) console.log(`  ${line}`);
}

closeDatabase();
