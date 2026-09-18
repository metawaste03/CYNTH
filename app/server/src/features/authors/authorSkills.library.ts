import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE AUTHOR LIBRARY — the folder skill documents are imported from and
 * exported back to.
 *
 * The database is the source of truth: generation reads `author_skills` and
 * never touches this folder, so Cynth works with the folder absent, renamed,
 * or emptied. The folder is the exchange format — where a document written
 * outside Cynth arrives, and where an edited one can be written back so the
 * two stay in step.
 *
 * Nothing here writes to the database and nothing here is called during
 * generation.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// app/server/{src,dist}/features/authors -> CYNTH/Author. Both the source and
// the built tree sit five levels deep, so one relative path serves each.
// Overridable via CYNTH_AUTHOR_DIR, which is what the tests use.
export const AUTHOR_LIBRARY_DIR = process.env.CYNTH_AUTHOR_DIR
  ? path.resolve(process.env.CYNTH_AUTHOR_DIR)
  : path.resolve(__dirname, '..', '..', '..', '..', '..', 'Author');

/** Only plain markdown basenames. No directories, no traversal, no other extension. */
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

export interface LibraryFile {
  filename: string;
  /** The document's first H1, which is what the persona files lead with. Falls back to the filename. */
  title: string;
  characterCount: number;
  modifiedAt: string;
}

export class LibraryError extends Error {}

/**
 * Resolves a caller-supplied filename inside the library.
 *
 * Two independent checks, because either alone can be worked around: the name
 * must look like a bare markdown filename, and the resolved path must still be
 * a direct child of the library directory.
 */
function resolveInLibrary(filename: string): string {
  if (!SAFE_FILENAME.test(filename)) {
    throw new LibraryError('A skill file must be a plain .md filename with no path separators.');
  }
  const full = path.resolve(AUTHOR_LIBRARY_DIR, filename);
  if (path.dirname(full) !== path.resolve(AUTHOR_LIBRARY_DIR)) {
    throw new LibraryError('A skill file must sit directly inside the Author folder.');
  }
  return full;
}

/** The document's own title. Not invented — read from the first level-one heading, or the filename when there is none. */
export function titleFromMarkdown(body: string, fallback: string): string {
  for (const line of body.split(/\r?\n/)) {
    const heading = /^#\s+(.+?)\s*$/.exec(line);
    if (heading) return heading[1];
  }
  return fallback;
}

export function libraryExists(): boolean {
  return fs.existsSync(AUTHOR_LIBRARY_DIR) && fs.statSync(AUTHOR_LIBRARY_DIR).isDirectory();
}

/** Every markdown file in the library, newest first. Returns an empty list when the folder is absent rather than failing. */
export function listLibraryFiles(): LibraryFile[] {
  if (!libraryExists()) return [];

  return fs
    .readdirSync(AUTHOR_LIBRARY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SAFE_FILENAME.test(entry.name))
    .map((entry) => {
      const full = path.join(AUTHOR_LIBRARY_DIR, entry.name);
      const body = fs.readFileSync(full, 'utf8');
      return {
        filename: entry.name,
        title: titleFromMarkdown(body, entry.name),
        characterCount: body.length,
        modifiedAt: fs.statSync(full).mtime.toISOString(),
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

export function readLibraryFile(filename: string): string {
  const full = resolveInLibrary(filename);
  if (!fs.existsSync(full)) throw new LibraryError(`${filename} is not in the Author folder.`);
  return fs.readFileSync(full, 'utf8');
}

/** Writes a skill back out. Creates the folder if the user has moved or deleted it. */
export function writeLibraryFile(filename: string, body: string): string {
  const full = resolveInLibrary(filename);
  fs.mkdirSync(AUTHOR_LIBRARY_DIR, { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
  return full;
}
