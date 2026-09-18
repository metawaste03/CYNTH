import { Router } from 'express';
import * as repo from './content.repository.js';

/**
 * The content configuration API: projects, thematic areas and topics.
 *
 * Generic engine surface — no endpoint knows what a theme is called or how
 * many exist. Adding EveryFiveDays' sixth thematic area is a POST, not a
 * deployment.
 */
export const contentRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function requireText(value: unknown, field: string, errors: string[]): string {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${field} is required.`);
    return '';
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/* -------------------------------------------------------------- projects */

contentRouter.get('/projects', (_req, res) => {
  res.json({ projects: repo.listProjects(), default: repo.getDefaultProject() });
});

contentRouter.get('/projects/:id/article-types', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid project id.'] });
  if (!repo.getProjectById(id)) return res.status(404).json({ errors: ['Project not found.'] });

  res.json({ articleTypes: repo.listArticleTypesForProject(id) });
});

contentRouter.put('/projects/:id/article-types', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid project id.'] });
  if (!repo.getProjectById(id)) return res.status(404).json({ errors: ['Project not found.'] });

  const ids = (req.body ?? {}).articleTypeIds;
  if (!Array.isArray(ids) || ids.some((v) => !Number.isInteger(v))) {
    return res.status(400).json({ errors: ['articleTypeIds must be an array of integers.'] });
  }

  res.json({ articleTypes: repo.setProjectArticleTypes(id, ids) });
});

/* ---------------------------------------------------------------- themes */

contentRouter.get('/themes', (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? parseId(req.query.projectId) : undefined;
  if (projectId === null) return res.status(400).json({ errors: ['Invalid project id.'] });

  res.json({
    themes: repo.listThemes({
      projectId: projectId ?? undefined,
      activeOnly: req.query.activeOnly === 'true',
    }),
  });
});

contentRouter.get('/themes/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid theme id.'] });

  const theme = repo.getThemeById(id);
  if (!theme) return res.status(404).json({ errors: ['Thematic area not found.'] });

  res.json({
    theme,
    topics: repo.listTopics({ themeId: id }),
    authors: repo.listAuthorsForTheme(id),
    articleTypes: repo.listArticleTypesForTheme(id),
  });
});

contentRouter.post('/themes', (req, res) => {
  const body = req.body ?? {};
  const errors: string[] = [];
  const name = requireText(body.name, 'Name', errors);

  const projectId = Number.isInteger(body.projectId) ? body.projectId : repo.getDefaultProject()?.id;
  if (!projectId) errors.push('No project is configured to add a thematic area to.');
  else if (!repo.getProjectById(projectId)) errors.push('Project not found.');

  if (errors.length) return res.status(400).json({ errors });

  res.status(201).json({
    theme: repo.createTheme(projectId!, {
      name,
      description: optionalText(body.description),
      position: Number.isInteger(body.position) ? body.position : 0,
      isActive: body.isActive !== false,
    }),
  });
});

contentRouter.put('/themes/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid theme id.'] });

  const body = req.body ?? {};
  const errors: string[] = [];
  const name = requireText(body.name, 'Name', errors);
  if (errors.length) return res.status(400).json({ errors });

  const theme = repo.updateTheme(id, {
    name,
    description: optionalText(body.description),
    position: Number.isInteger(body.position) ? body.position : 0,
    isActive: body.isActive !== false,
  });
  if (!theme) return res.status(404).json({ errors: ['Thematic area not found.'] });

  res.json({ theme });
});

contentRouter.patch('/themes/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid theme id.'] });

  const isActive = (req.body ?? {}).isActive;
  if (typeof isActive !== 'boolean') return res.status(400).json({ errors: ['isActive must be true or false.'] });

  const theme = repo.setThemeActive(id, isActive);
  if (!theme) return res.status(404).json({ errors: ['Thematic area not found.'] });

  res.json({ theme });
});

/** Refused while any article still references the area — deactivate instead. */
contentRouter.delete('/themes/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid theme id.'] });
  if (!repo.getThemeById(id)) return res.status(404).json({ errors: ['Thematic area not found.'] });

  const blockers = repo.themeDeletionBlockers(id);
  if (blockers.length) return res.status(409).json({ errors: blockers });

  repo.deleteTheme(id);
  res.status(204).end();
});

contentRouter.put('/themes/:id/article-types', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid theme id.'] });
  if (!repo.getThemeById(id)) return res.status(404).json({ errors: ['Thematic area not found.'] });

  const ids = (req.body ?? {}).articleTypeIds;
  if (!Array.isArray(ids) || ids.some((v) => !Number.isInteger(v))) {
    return res.status(400).json({ errors: ['articleTypeIds must be an array of integers.'] });
  }

  res.json({ articleTypes: repo.setThemeArticleTypes(id, ids) });
});

/* ---------------------------------------------------------------- topics */

contentRouter.get('/topics', (req, res) => {
  const themeId = typeof req.query.themeId === 'string' ? parseId(req.query.themeId) : undefined;
  const projectId = typeof req.query.projectId === 'string' ? parseId(req.query.projectId) : undefined;
  if (themeId === null || projectId === null) return res.status(400).json({ errors: ['Invalid id filter.'] });

  res.json({
    topics: repo.listTopics({
      themeId: themeId ?? undefined,
      projectId: projectId ?? undefined,
      activeOnly: req.query.activeOnly === 'true',
    }),
  });
});

contentRouter.get('/topics/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid topic id.'] });

  const topic = repo.getTopicById(id);
  if (!topic) return res.status(404).json({ errors: ['Topic not found.'] });

  res.json({ topic, theme: repo.getThemeById(topic.themeId) });
});

contentRouter.post('/topics', (req, res) => {
  const body = req.body ?? {};
  const errors: string[] = [];
  const title = requireText(body.title, 'Title', errors);

  if (!Number.isInteger(body.themeId)) errors.push('themeId is required.');
  else if (!repo.getThemeById(body.themeId)) errors.push('Thematic area not found.');

  if (errors.length) return res.status(400).json({ errors });

  res.status(201).json({
    topic: repo.createTopic(body.themeId, {
      title,
      description: optionalText(body.description),
      notes: optionalText(body.notes),
      scope: optionalText(body.scope),
      keyAreas: optionalText(body.keyAreas),
      considerations: optionalText(body.considerations),
      exclusions: optionalText(body.exclusions),
      isActive: body.isActive !== false,
    }),
  });
});

contentRouter.put('/topics/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid topic id.'] });

  const body = req.body ?? {};
  const errors: string[] = [];
  const title = requireText(body.title, 'Title', errors);
  if (errors.length) return res.status(400).json({ errors });

  const topic = repo.updateTopic(id, {
    title,
    description: optionalText(body.description),
    notes: optionalText(body.notes),
    scope: optionalText(body.scope),
    keyAreas: optionalText(body.keyAreas),
    considerations: optionalText(body.considerations),
    exclusions: optionalText(body.exclusions),
    isActive: body.isActive !== false,
  });
  if (!topic) return res.status(404).json({ errors: ['Topic not found.'] });

  res.json({ topic });
});

contentRouter.delete('/topics/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid topic id.'] });
  if (!repo.deleteTopic(id)) return res.status(404).json({ errors: ['Topic not found.'] });

  res.status(204).end();
});

/* ------------------------------------------------------- author <-> theme */

contentRouter.get('/authors/:id/themes', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid author id.'] });

  res.json({ themes: repo.listThemesForAuthor(id) });
});

contentRouter.put('/authors/:id/themes', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid author id.'] });

  const ids = (req.body ?? {}).themeIds;
  if (!Array.isArray(ids) || ids.some((v) => !Number.isInteger(v))) {
    return res.status(400).json({ errors: ['themeIds must be an array of integers.'] });
  }

  res.json({ themes: repo.setAuthorThemes(id, ids) });
});
