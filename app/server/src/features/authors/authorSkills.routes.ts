import { Router } from 'express';
import * as repo from './authorSkills.repository.js';
import { AUTHOR_SKILL_SCOPES, validateAuthorSkillInput } from './authorSkills.validation.js';
import type { AuthorSkillScope } from './authorSkills.validation.js';
import { AUTHOR_LIBRARY_DIR, LibraryError, libraryExists, listLibraryFiles } from './authorSkills.library.js';
import { exportSkill, importFile, importLibrary } from './authorSkills.import.js';

/**
 * Author skill management. CRUD over the documents, plus the two operations
 * that move them between the Author folder and the database.
 *
 * Nothing here generates anything. The generation path reads this feature's
 * repository directly and never these routes.
 */
export const authorSkillsRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** A repository call that can answer with a stated reason rather than a row. */
function isError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result;
}

/* -------------------------------------------------------------- the library */

/**
 * What is in the Author folder, and which of it has been imported.
 *
 * Reported before the skills themselves so the page can show the folder even
 * when nothing has been imported from it yet.
 */
/**
 * SQLite writes `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC, with no
 * zone marker; the filesystem reports ISO 8601 with one. Comparing the two as
 * strings is not merely imprecise, it is always wrong in the same direction —
 * 'T' sorts above ' ', so every file looked newer than its own import.
 */
function toEpoch(sqliteOrIso: string): number {
  const normalised = sqliteOrIso.includes('T') ? sqliteOrIso : `${sqliteOrIso.replace(' ', 'T')}Z`;
  return Date.parse(normalised);
}

authorSkillsRouter.get('/library', (_req, res) => {
  const imported = new Map(
    repo
      .listSkills()
      .filter((skill) => skill.sourceFilename)
      .map((skill) => [skill.sourceFilename as string, skill]),
  );

  const files = listLibraryFiles().map((file) => {
    const match = imported.get(file.filename);
    return {
      ...file,
      importedSkillId: match?.id ?? null,
      importedSkillName: match?.name ?? null,
      /**
       * True when the file on disk was written after the skill was last
       * saved. A one-second grace absorbs the rounding in SQLite's
       * whole-second timestamps, which would otherwise make a file that was
       * just exported look newer than the export that produced it.
       */
      changedSinceImport: match ? toEpoch(file.modifiedAt) - toEpoch(match.updatedAt) > 1000 : false,
    };
  });

  res.json({ directory: AUTHOR_LIBRARY_DIR, exists: libraryExists(), files });
});

/** Imports one file. `authorId` assigns it in the same step; omit it to import unassigned. */
authorSkillsRouter.post('/library/import', (req, res) => {
  const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
  if (!filename) return res.status(400).json({ errors: ['filename is required.'] });

  let authorId: number | null | undefined;
  if (req.body?.authorId !== undefined && req.body.authorId !== null) {
    const parsed = parseId(String(req.body.authorId));
    if (parsed === null) return res.status(400).json({ errors: ['authorId must be a positive whole number.'] });
    authorId = parsed;
  } else if (req.body?.authorId === null) {
    authorId = null;
  }

  const scope = req.body?.scope;
  if (scope !== undefined && !AUTHOR_SKILL_SCOPES.includes(scope)) {
    return res.status(400).json({ errors: [`scope must be one of: ${AUTHOR_SKILL_SCOPES.join(', ')}.`] });
  }

  try {
    const result = importFile(filename, { authorId, scope: scope as AuthorSkillScope | undefined });
    if (isError(result)) return res.status(400).json({ errors: [result.error] });
    res.status(result.updated ? 200 : 201).json({ skill: result.skill, updated: result.updated });
  } catch (error) {
    if (error instanceof LibraryError) return res.status(400).json({ errors: [error.message] });
    throw error;
  }
});

/**
 * One-time setup: import every persona document in the folder, creating the
 * authors they name and linking the thematic areas they name. Idempotent, and
 * it reports every decision rather than summarising them away.
 */
authorSkillsRouter.post('/library/import-all', (_req, res) => {
  if (!libraryExists()) {
    return res.status(400).json({ errors: [`No Author folder at ${AUTHOR_LIBRARY_DIR}.`] });
  }
  res.json({ report: importLibrary() });
});

/** Writes a skill back to the Author folder, to the file it came from where it has one. */
authorSkillsRouter.post('/:id/export', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid skill id.'] });

  try {
    const result = exportSkill(id);
    if (result === null) return res.status(404).json({ errors: ['Skill not found.'] });
    if (isError(result)) return res.status(400).json({ errors: [result.error] });
    res.json(result);
  } catch (error) {
    if (error instanceof LibraryError) return res.status(400).json({ errors: [error.message] });
    throw error;
  }
});

/* --------------------------------------------------------------------- CRUD */

authorSkillsRouter.get('/', (req, res) => {
  const { authorId, scope, assignment, status, search } = req.query;
  const parsedAuthorId = typeof authorId === 'string' ? parseId(authorId) : null;

  res.json({
    skills: repo.listSkills({
      authorId: parsedAuthorId ?? undefined,
      scope: scope === 'author' || scope === 'shared' ? scope : undefined,
      assignment: assignment === 'assigned' || assignment === 'unassigned' ? assignment : undefined,
      status: status === 'active' || status === 'inactive' ? status : undefined,
      search: typeof search === 'string' && search ? search : undefined,
    }),
  });
});

authorSkillsRouter.get('/meta/scopes', (_req, res) => {
  res.json({
    scopes: [
      { value: 'author', label: 'Author', description: 'Applies only to the author it is assigned to.' },
      { value: 'shared', label: 'Shared', description: 'Applies to every author, alongside their own skill.' },
    ],
  });
});

authorSkillsRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid skill id.'] });

  const skill = repo.getSkillById(id);
  if (!skill) return res.status(404).json({ errors: ['Skill not found.'] });

  res.json({ skill });
});

authorSkillsRouter.post('/', (req, res) => {
  const { errors, value } = validateAuthorSkillInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const skill = repo.createSkill(value!);
  if (isError(skill)) return res.status(400).json({ errors: [skill.error] });

  res.status(201).json({ skill });
});

authorSkillsRouter.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid skill id.'] });

  const { errors, value } = validateAuthorSkillInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const skill = repo.updateSkill(id, value!);
  if (skill === null) return res.status(404).json({ errors: ['Skill not found.'] });
  if (isError(skill)) return res.status(400).json({ errors: [skill.error] });

  res.json({ skill });
});

/** Reassignment on its own — the operation behind "change the author assigned to this skill". */
authorSkillsRouter.patch('/:id/author', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid skill id.'] });

  const raw = req.body?.authorId;
  let authorId: number | null;
  if (raw === null) {
    authorId = null;
  } else {
    const parsed = parseId(String(raw));
    if (parsed === null) {
      return res.status(400).json({ errors: ['authorId must be a positive whole number, or null to unassign.'] });
    }
    authorId = parsed;
  }

  const skill = repo.assignSkill(id, authorId);
  if (skill === null) return res.status(404).json({ errors: ['Skill not found.'] });
  if (isError(skill)) return res.status(400).json({ errors: [skill.error] });

  res.json({ skill });
});

authorSkillsRouter.patch('/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid skill id.'] });

  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ errors: ['isActive must be true or false.'] });
  }

  const skill = repo.setSkillActiveStatus(id, req.body.isActive);
  if (!skill) return res.status(404).json({ errors: ['Skill not found.'] });

  res.json({ skill });
});

authorSkillsRouter.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid skill id.'] });

  if (!repo.deleteSkill(id)) return res.status(404).json({ errors: ['Skill not found.'] });
  res.status(204).send();
});
