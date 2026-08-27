import { getDatabase } from '../../shared/database/index.js';
import type { CmsConnectionRow } from '../../shared/database/types.js';
import { applySecretEdit, deleteSecret, getSecret, hasSecret } from '../../shared/secrets/secretStore.js';
import type { CmsConnectionInput } from './cmsConnections.validation.js';

/**
 * Configured CMS destinations.
 *
 * SECURITY: this repository never returns a credential. `hasCredential` is
 * the only fact about a stored secret that any DTO carries, exactly as
 * ai_providers does for API keys. The secret value lives in the environment
 * (see shared/secrets/secretStore.ts) and is read by exactly one function
 * here, for exactly one purpose: authenticating an outbound request.
 */

export interface CmsConnectionDto {
  id: number;
  name: string;
  connectorType: string;
  description: string | null;
  /** The site root. Configurable, never hardcoded — the same connection works for a local and a live site. */
  baseUrl: string;
  authMethod: string;
  username: string | null;
  /** The env var NAME holding the credential. Not a secret; the value never leaves the server. */
  credentialEnvVar: string | null;
  hasCredential: boolean;
  defaultRemoteAuthorId: string | null;
  defaultRemoteAuthorName: string | null;
  isActive: boolean;
  isDefault: boolean;
  /** The outcome of the last Test Connection. Diagnostics, never a credential. */
  lastStatus: string | null;
  lastStage: string | null;
  lastMessage: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapConnection(row: CmsConnectionRow): CmsConnectionDto {
  return {
    id: row.id,
    name: row.name,
    connectorType: row.connector_type,
    description: row.description,
    baseUrl: row.base_url,
    authMethod: row.auth_method,
    username: row.username,
    credentialEnvVar: row.credential_env_var,
    hasCredential: hasSecret(row.credential_env_var),
    defaultRemoteAuthorId: row.default_remote_author_id,
    defaultRemoteAuthorName: row.default_remote_author_name,
    isActive: row.is_active === 1,
    isDefault: row.is_default === 1,
    lastStatus: row.last_status,
    lastStage: row.last_stage,
    lastMessage: row.last_message,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listConnections(): CmsConnectionDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM cms_connections ORDER BY is_default DESC, name ASC')
    .all() as unknown as CmsConnectionRow[];
  return rows.map(mapConnection);
}

export function getConnectionById(id: number): CmsConnectionDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM cms_connections WHERE id = ?').get(id) as unknown as
    | CmsConnectionRow
    | undefined;
  return row ? mapConnection(row) : null;
}

/** The connection a push targets when the request does not name one. */
export function getDefaultConnection(): CmsConnectionDto | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM cms_connections WHERE is_default = 1 AND is_active = 1')
    .get() as unknown as CmsConnectionRow | undefined;
  if (row) return mapConnection(row);

  // Falling back to a single active connection avoids a pointless "choose a
  // destination" step when there is only one thing to choose.
  const rows = db
    .prepare('SELECT * FROM cms_connections WHERE is_active = 1')
    .all() as unknown as CmsConnectionRow[];
  return rows.length === 1 ? mapConnection(rows[0]) : null;
}

/**
 * The credential value for a connection, read from the environment.
 *
 * The ONE function in the CMS feature that returns a secret. It exists solely
 * so a connector can authenticate its own request. The value must never reach
 * a DTO, a route response, a log line, the push history, or the database.
 */
export function getConnectionSecret(connectionId: number): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT credential_env_var FROM cms_connections WHERE id = ?').get(connectionId) as unknown as
    | { credential_env_var: string | null }
    | undefined;
  return getSecret(row?.credential_env_var ?? null);
}

function applyCredential(connectionId: number, credential: string | undefined, existingEnvVar: string | null): string | null {
  return applySecretEdit(credential, existingEnvVar, () => `CYNTH_CMS_${connectionId}_CREDENTIAL`);
}

export function createConnection(input: CmsConnectionInput): CmsConnectionDto {
  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO cms_connections (name, connector_type, description, base_url, auth_method, username, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `)
    .run(input.name, input.connectorType, input.description, input.baseUrl, input.authMethod, input.username);

  const connectionId = Number(result.lastInsertRowid);
  const envVar = applyCredential(connectionId, input.credential, null);
  if (envVar) {
    db.prepare('UPDATE cms_connections SET credential_env_var = ? WHERE id = ?').run(envVar, connectionId);
  }

  // The first connection configured becomes the default, so a single-site
  // setup never has to be told which site it means.
  const count = db.prepare('SELECT COUNT(*) AS count FROM cms_connections').get() as unknown as { count: number };
  if (count.count === 1) setDefaultConnection(connectionId);

  return getConnectionById(connectionId)!;
}

export function updateConnection(id: number, input: CmsConnectionInput): CmsConnectionDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT credential_env_var FROM cms_connections WHERE id = ?').get(id) as unknown as
    | { credential_env_var: string | null }
    | undefined;
  if (!existing) return null;

  const envVar = applyCredential(id, input.credential, existing.credential_env_var);

  db.prepare(`
    UPDATE cms_connections SET
      name = ?, connector_type = ?, description = ?, base_url = ?, auth_method = ?,
      username = ?, credential_env_var = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name,
    input.connectorType,
    input.description,
    input.baseUrl,
    input.authMethod,
    input.username,
    envVar,
    id,
  );

  return getConnectionById(id);
}

export function setConnectionActiveStatus(id: number, isActive: boolean): CmsConnectionDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`UPDATE cms_connections SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isActive ? 1 : 0, id);
  if (result.changes === 0) return null;
  return getConnectionById(id);
}

/** Only one default connection system-wide — unset any other before setting this one. */
export function setDefaultConnection(id: number): CmsConnectionDto | null {
  const db = getDatabase();
  if (!db.prepare('SELECT id FROM cms_connections WHERE id = ?').get(id)) return null;

  db.prepare('UPDATE cms_connections SET is_default = 0').run();
  db.prepare(`UPDATE cms_connections SET is_default = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  return getConnectionById(id);
}

/** The remote author posts are attributed to. Chosen by the user from the site's own user list — never guessed. */
export function setConnectionAuthorMapping(
  id: number,
  remoteAuthorId: string | null,
  remoteAuthorName: string | null,
): CmsConnectionDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`
      UPDATE cms_connections
      SET default_remote_author_id = ?, default_remote_author_name = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(remoteAuthorId, remoteAuthorName, id);
  if (result.changes === 0) return null;
  return getConnectionById(id);
}

/** Records the outcome of a Test Connection so the settings screen can show it without re-testing. */
export function recordConnectionCheck(
  id: number,
  status: 'ok' | 'failed',
  stage: string,
  message: string,
): CmsConnectionDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`
      UPDATE cms_connections
      SET last_status = ?, last_stage = ?, last_message = ?, last_checked_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(status, stage, message, id);
  if (result.changes === 0) return null;
  return getConnectionById(id);
}

export function deleteConnection(id: number): boolean {
  const db = getDatabase();
  const row = db.prepare('SELECT credential_env_var FROM cms_connections WHERE id = ?').get(id) as unknown as
    | { credential_env_var: string | null }
    | undefined;
  if (!row) return false;

  // Cascades article_cms_links. cms_push_history keeps its rows with a NULL
  // connection_id: the audit trail of what was pushed where outlives the
  // configuration that did it.
  db.prepare('DELETE FROM cms_connections WHERE id = ?').run(id);
  if (row.credential_env_var) deleteSecret(row.credential_env_var);
  return true;
}
