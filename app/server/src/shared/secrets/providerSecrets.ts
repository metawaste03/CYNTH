import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * API keys never touch SQLite (per Milestone 8's security requirement).
 * Instead they're written to a local, gitignored .env-style file and loaded
 * into process.env — the database only ever stores the env var *name*
 * (ai_providers.api_key_env_var), never the value.
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

/** Loads any previously-saved provider secrets into process.env. Called once at server startup. Never overrides a real environment variable that's already set. */
export function loadProviderSecrets(): void {
  for (const [key, value] of readSecretsFile()) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Writes/updates one secret in the file and immediately reflects it in process.env. */
export function setProviderSecret(envVarName: string, value: string): void {
  const entries = readSecretsFile();
  entries.set(envVarName, value);
  writeSecretsFile(entries);
  process.env[envVarName] = value;
}

/** Removes a secret from the file and from process.env. */
export function deleteProviderSecret(envVarName: string): void {
  const entries = readSecretsFile();
  entries.delete(envVarName);
  writeSecretsFile(entries);
  delete process.env[envVarName];
}

/** Whether a secret is actually set — the only thing the API is allowed to expose about it. */
export function hasProviderSecret(envVarName: string | null): boolean {
  return Boolean(envVarName && process.env[envVarName]);
}
