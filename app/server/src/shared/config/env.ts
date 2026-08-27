/**
 * Local runtime configuration for the server process.
 *
 * No secrets live here. Provider API keys are handled separately, and never
 * reach SQLite — see shared/secrets/secretStore.ts.
 *
 * The port is deliberately not 4000: Local (the WordPress development
 * environment used for EveryFiveDays) occupies that port, and Cynth is
 * expected to run alongside it rather than compete with it.
 *
 * Resolution order, highest priority first:
 *   1. CYNTH_SERVER_PORT  — Cynth's own setting, also read by the Vite dev
 *                           proxy so the client and server cannot disagree.
 *   2. PORT               — respected so a generic host or process manager
 *                           can place the server wherever it needs to.
 *   3. DEFAULT_SERVER_PORT
 *
 * Read through a getter rather than captured at import time: index.ts calls
 * loadProviderSecrets() (which populates process.env from .env.local) after
 * this module has already been imported, so the value must be resolved when
 * it is used, not when this file is first loaded.
 */

export const DEFAULT_SERVER_PORT = 4100;

function resolvePort(): number {
  const configured = process.env.CYNTH_SERVER_PORT ?? process.env.PORT;
  const parsed = Number(configured);

  if (configured !== undefined && (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535)) {
    throw new Error(
      `Invalid server port "${configured}". Set CYNTH_SERVER_PORT to a whole number between 0 and 65535.`,
    );
  }

  return configured === undefined ? DEFAULT_SERVER_PORT : parsed;
}

export const env = {
  get port(): number {
    return resolvePort();
  },
};
