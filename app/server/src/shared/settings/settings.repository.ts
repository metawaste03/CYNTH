import { getDatabase } from '../database/index.js';

/**
 * Generic key/value application settings, using the `settings` table created
 * in Milestone 2 and unused until now.
 *
 * Deliberately untyped storage: callers own the meaning of their own keys.
 * No secrets are ever stored here — API keys live outside SQLite entirely
 * (see shared/secrets/secretStore.ts).
 */

export function getSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
}
