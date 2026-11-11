/**
 * One-time setup from the command line: import the Author folder.
 *
 * Exactly the same operation as the Import All button on the Author Skills
 * screen — it calls the same function — for when it is easier to run this than
 * to start the app. Idempotent: running it twice changes nothing.
 *
 * Run with:  npm --prefix app/server run import:skills
 */
import { initializeDatabase, closeDatabase, DATABASE_PATH } from '../src/shared/database/index.js';
import { AUTHOR_LIBRARY_DIR, libraryExists } from '../src/features/authors/authorSkills.library.js';
import { importLibrary } from '../src/features/authors/authorSkills.import.js';

initializeDatabase();
console.log(`Database: ${DATABASE_PATH}`);
console.log(`Author folder: ${AUTHOR_LIBRARY_DIR}`);

if (!libraryExists()) {
  console.error('No Author folder at that path. Nothing was imported.');
  closeDatabase();
  process.exit(1);
}

const report = importLibrary();

for (const entry of report.entries) {
  const bits = [entry.outcome.toUpperCase().padEnd(8), entry.filename];
  if (entry.authorName) bits.push(`-> ${entry.authorName}${entry.authorCreated ? ' (author created)' : ''}`);
  if (entry.themeName) bits.push(`[${entry.themeName}${entry.themeLinked ? ' linked' : ' NOT linked'}]`);
  if (!entry.isActive) bits.push('(inactive)');
  console.log(bits.join(' '));
  if (entry.note) console.log(`         ${entry.note}`);
}

console.log(
  `\n${report.skillsImported} imported, ${report.skillsUpdated} updated, ` +
    `${report.authorsCreated} author(s) created, ${report.themesLinked} thematic-area link(s), ` +
    `${report.needsDecision} awaiting a decision, ${report.skipped} skipped.`,
);

closeDatabase();
