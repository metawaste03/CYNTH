import { createAuthor, listAuthors } from './authors.repository.js';
import * as skills from './authorSkills.repository.js';
import type { AuthorSkillDto } from './authorSkills.repository.js';
import { listLibraryFiles, readLibraryFile, titleFromMarkdown, writeLibraryFile } from './authorSkills.library.js';
import { listThemes, listThemesForAuthor, setAuthorThemes } from '../content/content.repository.js';

/**
 * Moving skill documents between the Author folder and the database.
 *
 * Two entry points, deliberately different in how much they do:
 *
 *  - importFile() imports exactly one document and assigns it to exactly the
 *    author the caller named. Predictable, and the path used day to day.
 *  - importLibrary() is the one-time setup: it reads a folder of persona
 *    documents and wires up the authors and thematic-area links they describe.
 *    It reports every decision it made, and skips rather than guesses whenever
 *    a document does not say something it would otherwise have to invent.
 *
 * Both are idempotent. A document is matched to the row it produced last time
 * by `source_filename`, so re-running an import updates rather than duplicates.
 */

/** How a persona document names its author: a `**Name:**` list item, as the supplied files are written. */
const AUTHOR_NAME_PATTERN = /^\s*[-*]\s*\*\*Name:\*\*\s*(.+?)\s*$/m;

/** How a persona document names the thematic area it is for: `# Author Persona: <area>`. */
const PERSONA_TITLE_PATTERN = /^Author Persona:\s*(.+?)\s*$/;

/**
 * The author named inside the document, or null when it does not name one.
 *
 * Null is a real answer, not a failure: a document that names no author is a
 * shared or unassigned one, and importLibrary() treats it as such rather than
 * inventing a byline for it.
 */
export function authorNameFromMarkdown(body: string): string | null {
  const match = AUTHOR_NAME_PATTERN.exec(body);
  return match ? match[1].trim() || null : null;
}

/** The thematic area named by the document's own H1, when it follows the `Author Persona: <area>` form. */
export function themeNameFromMarkdown(body: string, fallbackTitle: string): string | null {
  const match = PERSONA_TITLE_PATTERN.exec(titleFromMarkdown(body, fallbackTitle));
  return match ? match[1].trim() || null : null;
}

export interface ImportFileOptions {
  /** Assign the imported document to this author. Undefined leaves the existing assignment alone. */
  authorId?: number | null;
  scope?: 'author' | 'shared';
  /** Only applied when creating; a re-import never reactivates a document the user switched off. */
  isActive?: boolean;
}

export interface ImportedSkill {
  skill: AuthorSkillDto;
  /** Whether an existing row for this file was updated rather than a new one created. */
  updated: boolean;
}

/**
 * Imports one library file. Re-importing the same file overwrites the body of
 * the row it created before, which is how an edit made outside Cynth reaches
 * the database without producing a second copy.
 */
export function importFile(filename: string, options: ImportFileOptions = {}): ImportedSkill | { error: string } {
  const body = readLibraryFile(filename);
  const existing = skills.getSkillBySourceFilename(filename);
  const name = titleFromMarkdown(body, filename.replace(/\.md$/i, ''));

  if (existing) {
    const result = skills.updateSkill(existing.id, {
      name: existing.name,
      body,
      scope: options.scope ?? existing.scope,
      authorId: options.authorId === undefined ? existing.authorId : options.authorId,
      sourceFilename: filename,
      position: existing.position,
      isActive: existing.isActive,
    });
    if (result === null) return { error: 'The skill being updated no longer exists.' };
    if ('error' in result) return result;
    return { skill: result, updated: true };
  }

  const created = skills.createSkill({
    name,
    body,
    scope: options.scope ?? 'author',
    authorId: options.authorId ?? null,
    sourceFilename: filename,
    isActive: options.isActive,
  });
  if ('error' in created) return created;
  return { skill: created, updated: false };
}

/**
 * Writes a skill back to the Author folder.
 *
 * Uses the file it was imported from when it has one, so the folder and the
 * database converge on the same file rather than accumulating variants.
 */
export function exportSkill(id: number): { filename: string; path: string } | { error: string } | null {
  const skill = skills.getSkillById(id);
  if (!skill) return null;

  const filename = skill.sourceFilename ?? `${skill.slug}.md`;
  const path = writeLibraryFile(filename, skill.body);
  return { filename, path };
}

export interface LibraryImportEntry {
  filename: string;
  /** What happened, in the user's terms. */
  outcome: 'imported' | 'updated' | 'skipped';
  skillId: number | null;
  authorName: string | null;
  authorCreated: boolean;
  themeName: string | null;
  themeLinked: boolean;
  scope: 'author' | 'shared';
  /** False for a document imported but left out of generation until the user decides what it is. */
  isActive: boolean;
  /** Why an outcome was what it was, whenever that is not self-evident. */
  note: string | null;
}

export interface LibraryImportReport {
  entries: LibraryImportEntry[];
  authorsCreated: number;
  skillsImported: number;
  skillsUpdated: number;
  themesLinked: number;
  /** Documents imported inactive because they name no author — they need a decision before they affect anything. */
  needsDecision: number;
  skipped: number;
}

function findAuthorByName(name: string): { id: number; name: string } | null {
  const match = listAuthors({}).find((author) => author.name.trim().toLowerCase() === name.trim().toLowerCase());
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * Links an author to the thematic area a persona document names, matching on
 * the area's name. The link is added to whatever the author already covers —
 * an import must not quietly remove coverage the user configured by hand.
 *
 * Returns false when no area of that name exists. That is not an error: the
 * document names an area this project has not configured, and inventing one
 * is exactly what Cynth must not do.
 */
function linkThemeByName(authorId: number, themeName: string): boolean {
  const theme = listThemes().find((t) => t.name.trim().toLowerCase() === themeName.trim().toLowerCase());
  if (!theme) return false;

  const current = listThemesForAuthor(authorId).map((t) => t.id);
  if (current.includes(theme.id)) return true;

  setAuthorThemes(authorId, [...current, theme.id]);
  return true;
}

/**
 * One-time setup from a folder of persona documents.
 *
 * For each markdown file: import it, and if it names an author, find or create
 * that author and attach the document to them; if it also names a thematic
 * area this project has configured, link the two.
 *
 * A document that names no author is imported INACTIVE and unassigned. A
 * folder may hold notes, templates and drafts alongside personas, and reading
 * one of those into every article's prompt because it happened to sit in the
 * same directory is exactly the kind of guess Cynth does not make. The user
 * decides what such a document is — a shared philosophy, one author's second
 * document, or nothing — and it affects no article until they do.
 *
 * Nothing is deleted, nothing already assigned is reassigned, and no editorial
 * text is generated. An author created here has a name and this document, and
 * nothing else — the structured persona fields stay empty for the user to fill
 * in or leave alone.
 */
export function importLibrary(): LibraryImportReport {
  const report: LibraryImportReport = {
    entries: [],
    authorsCreated: 0,
    skillsImported: 0,
    skillsUpdated: 0,
    themesLinked: 0,
    needsDecision: 0,
    skipped: 0,
  };

  for (const file of listLibraryFiles()) {
    const body = readLibraryFile(file.filename);
    const authorName = authorNameFromMarkdown(body);
    const themeName = authorName ? themeNameFromMarkdown(body, file.filename) : null;

    const entry: LibraryImportEntry = {
      filename: file.filename,
      outcome: 'skipped',
      skillId: null,
      authorName,
      authorCreated: false,
      themeName,
      themeLinked: false,
      scope: 'author',
      isActive: authorName !== null,
      note: null,
    };

    let authorId: number | null = null;
    if (authorName) {
      const existingAuthor = findAuthorByName(authorName);
      if (existingAuthor) {
        authorId = existingAuthor.id;
      } else {
        // Name only. Every other field on an author is editorial identity,
        // and Cynth does not write editorial identity.
        authorId = createAuthor({ name: authorName }).id;
        entry.authorCreated = true;
        report.authorsCreated += 1;
      }
    }

    const imported = importFile(file.filename, {
      scope: entry.scope,
      authorId,
      isActive: entry.isActive,
    });

    if ('error' in imported) {
      entry.note = imported.error;
      report.skipped += 1;
      report.entries.push(entry);
      continue;
    }

    entry.skillId = imported.skill.id;
    entry.scope = imported.skill.scope;
    entry.isActive = imported.skill.isActive;
    entry.outcome = imported.updated ? 'updated' : 'imported';
    if (imported.updated) report.skillsUpdated += 1;
    else report.skillsImported += 1;

    if (authorId !== null && themeName) {
      entry.themeLinked = linkThemeByName(authorId, themeName);
      if (entry.themeLinked) report.themesLinked += 1;
      else entry.note = `No thematic area named "${themeName}" is configured — the skill was imported unlinked.`;
    } else if (!authorName) {
      report.needsDecision += 1;
      entry.note =
        'The document names no author, so it was imported inactive and unassigned. ' +
        'Assign it to an author, or make it a shared skill, to bring it into generation.';
    }

    report.entries.push(entry);
  }

  return report;
}
