import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';
import { seedArticleTypes } from './seed.js';
import { seedInitialProject } from './seedProject.js';
import { runMigrations } from './migrations.js';
import { seedTemplates } from '../../features/templates/templates.repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// app/server/src/shared/database -> the project's top-level database/ directory,
// i.e. CYNTH/database/. Overridable via CYNTH_DB_DIR for testing. Exported so
// other local-storage needs (e.g. product image uploads) can live alongside
// the database file instead of duplicating this path resolution.
export const DATABASE_DIR = process.env.CYNTH_DB_DIR
  ? path.resolve(process.env.CYNTH_DB_DIR)
  : path.resolve(__dirname, '..', '..', '..', '..', '..', 'database');

export const DATABASE_PATH = path.join(DATABASE_DIR, 'cynth.db');

let db: DatabaseSync | null = null;

export interface DatabaseInitResult {
  path: string;
  tables: string[];
  articleTypesSeeded: boolean;
  articleTypesCount: number;
  /** The initial content project (EveryFiveDays) — seed data, not engine configuration. */
  projectSeeded: boolean;
  themeCount: number;
  /** Article templates seeded this start. Idempotent: an existing version is never overwritten. */
  templatesSeeded: number;
}

/**
 * Opens the local SQLite database (creating the file and its directory if
 * they don't exist), ensures every table exists, and seeds article_types
 * if empty. Every step is idempotent, so this is safe to run on every
 * app startup.
 */
export function initializeDatabase(): DatabaseInitResult {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });

  db = new DatabaseSync(DATABASE_PATH);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  runMigrations(db);

  const { seeded, count } = seedArticleTypes(db);

  // Seeds the first content project and its thematic areas, only when no
  // project exists yet. The engine does not require a project to run.
  const project = seedInitialProject(db);

  // Idempotent by (template_id, version). An edited template is left alone,
  // because overwriting one would change what an article written to it means.
  const templates = seedTemplates();

  const tables = (db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[]
  ).map((row) => row.name);

  return {
    path: DATABASE_PATH,
    tables,
    articleTypesSeeded: seeded,
    articleTypesCount: count,
    projectSeeded: project.seeded,
    themeCount: project.themeCount,
    templatesSeeded: templates.seeded,
  };
}

/** Returns the open database handle. Throws if initializeDatabase() hasn't run yet. */
export function getDatabase(): DatabaseSync {
  if (!db) {
    throw new Error('Database has not been initialized. Call initializeDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}
