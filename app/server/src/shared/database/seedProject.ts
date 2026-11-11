import type { DatabaseSync } from 'node:sqlite';
import { slugify } from '../text/slug.js';

/**
 * INITIAL CONTENT CONFIGURATION — not engine architecture.
 *
 * Everything in this file is seed data describing the *first* project Cynth
 * happens to run. The engine knows nothing about these names: themes are rows
 * in `themes`, and adding a sixth one is an INSERT, not a code change. Delete
 * this file and Cynth still works — it would simply start with no project
 * configured.
 *
 * Read the constant below as "this project currently has five configured
 * thematic areas", never as "Cynth has five categories".
 */

export interface ThemeSeed {
  name: string;
  /** Left undefined on purpose — editorial descriptions are the Product Owner's to write, not ours to invent. */
  description?: string;
}

export interface ProjectSeed {
  name: string;
  description: string;
  themes: ThemeSeed[];
}

/** EveryFiveDays: the first content universe seeded into Cynth. */
export const INITIAL_PROJECT_SEED: ProjectSeed = {
  name: 'EveryFiveDays',
  description: 'The first content project configured in Cynth.',
  themes: [
    { name: 'Smart Pet Care' },
    { name: 'Cognitive Performance & Nootropics' },
    { name: 'Fitness Tech & Biohacking' },
    { name: 'Productive Workspace Setups' },
    { name: 'Sleep & Recovery' },
  ],
};

export interface ProjectSeedResult {
  seeded: boolean;
  projectId: number | null;
  themeCount: number;
  articleTypesLinked: number;
}

/**
 * Seeds the initial project and its thematic areas, then makes every article
 * type currently in the shared taxonomy available to it.
 *
 * Only runs when `projects` is empty, mirroring how article types are seeded.
 * Once a project exists, this never touches it again — themes renamed,
 * deactivated or added through the application are the user's, not ours to
 * overwrite on the next restart.
 */
export function seedInitialProject(db: DatabaseSync): ProjectSeedResult {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number };

  if (existing.count > 0) {
    const row = db.prepare('SELECT id FROM projects WHERE is_default = 1').get() as { id: number } | undefined;
    const themes = db.prepare('SELECT COUNT(*) AS count FROM themes').get() as { count: number };
    return { seeded: false, projectId: row?.id ?? null, themeCount: themes.count, articleTypesLinked: 0 };
  }

  const projectId = Number(
    db
      .prepare('INSERT INTO projects (name, slug, description, is_active, is_default) VALUES (?, ?, ?, 1, 1)')
      .run(INITIAL_PROJECT_SEED.name, slugify(INITIAL_PROJECT_SEED.name), INITIAL_PROJECT_SEED.description)
      .lastInsertRowid,
  );

  const insertTheme = db.prepare(
    'INSERT INTO themes (project_id, name, slug, description, position) VALUES (?, ?, ?, ?, ?)',
  );
  INITIAL_PROJECT_SEED.themes.forEach((theme, index) => {
    insertTheme.run(projectId, theme.name, slugify(theme.name), theme.description ?? null, index);
  });

  // Every article type already in the taxonomy is offered to this project.
  // A different project could enable a different subset without either
  // duplicating the types or changing any code.
  const linked = db
    .prepare(
      'INSERT OR IGNORE INTO project_article_types (project_id, article_type_id) SELECT ?, id FROM article_types',
    )
    .run(projectId);

  return {
    seeded: true,
    projectId,
    themeCount: INITIAL_PROJECT_SEED.themes.length,
    articleTypesLinked: Number(linked.changes),
  };
}
