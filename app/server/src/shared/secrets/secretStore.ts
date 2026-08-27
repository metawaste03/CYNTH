import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cynth's one and only place for credential values.
 *
 * No secret ever touches SQLite. Secrets are written to a local, gitignored
 * .env-style file and loaded into process.env; the database stores only the
 * env var *name* — ai_providers.api_key_env_var for AI provider keys,
 * cms_connections.credential_env_var for CMS credentials (Milestone 13).
 *
 * Nothing here is provider-specific. It was originally written for AI
 * provider keys (Milestone 8) and generalised when WordPress arrived: a
 * second kind of credential must not mean a second, subtly different way of
 * storing one.
 *
 * Nothing in this module is ever logged, returned by a route, or included in
 * a DTO. The only fact any caller may expose about a secret is whether it is
 * set — see hasSecret().
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// app/server/src/shared/secrets -> app/server/.env.local
export const SECRETS_FILE_PATH = path.resolve(__dirname, '..', '..', '..', '.env.local');

function readSecretsFile(): Map<string, string> {
  const entries = new Map<string, string>();
  if (!fs.existsSync(SECRETS_FILE_PATH)) return entries;

  const content = fs.readFileSync(SECRETS_FILE_PATH, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    entries.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return entries;
}

function writeSecretsFile(entries: Map<string, string>): void {
  const content = Array.from(entries.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.writeFileSync(SECRETS_FILE_PATH, content ? `${content}\n` : '', { mode: 0o600 });
}

/** Loads every previously-saved secret into process.env. Called once at server startup. Never overrides a real environment variable that's already set. */
export function loadSecrets(): void {
  for (const [key, value] of readSecretsFile()) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Writes/updates one secret in the file and immediately reflects it in process.env. */
export function setSecret(envVarName: string, value: string): void {
  const entries = readSecretsFile();
  entries.set(envVarName, value);
  writeSecretsFile(entries);
  process.env[envVarName] = value;
}

/** Removes a secret from the file and from process.env. */
export function deleteSecret(envVarName: string): void {
  const entries = readSecretsFile();
  entries.delete(envVarName);
  writeSecretsFile(entries);
  delete process.env[envVarName];
}

/** Whether a secret is actually set — the only thing the API is allowed to expose about it. */
export function hasSecret(envVarName: string | null): boolean {
  return Boolean(envVarName && process.env[envVarName]);
}

/**
 * The secret value itself, for the one caller that must authenticate an
 * outbound request with it.
 *
 * Server-side only. The return value must never reach a DTO, a route
 * response, a log line, or the database.
 */
export function getSecret(envVarName: string | null): string | null {
  if (!envVarName) return null;
  return process.env[envVarName] || null;
}

/**
 * Applies an incoming credential edit and returns the env var name to store.
 *
 * The three-way contract is shared by every credential in Cynth:
 *   undefined -> leave the stored secret untouched
 *   ''        -> clear it
 *   any value -> set or rotate it
 *
 * `envVarNameFor` is only called when a name is actually needed, so a record
 * that never receives a secret never acquires an env var name either.
 */
export function applySecretEdit(
  incoming: string | undefined,
  existingEnvVar: string | null,
  envVarNameFor: () => string,
): string | null {
  if (incoming === undefined) return existingEnvVar;

  if (incoming === '') {
    if (existingEnvVar) deleteSecret(existingEnvVar);
    return null;
  }

  const envVar = existingEnvVar ?? envVarNameFor();
  setSecret(envVar, incoming);
  return envVar;
}
