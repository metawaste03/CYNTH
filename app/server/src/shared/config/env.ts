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

/**
 * The interface the server binds to. Loopback only, by default.
 *
 * Cynth has no login: anything that can reach the port can read every draft,
 * push to the live site and spend provider credit. Binding with no host meant
 * every interface, so on a Wi-Fi network classed as Public — with Windows
 * allowing node.exe through — anyone nearby could do all of that.
 *
 * CYNTH_SERVER_HOST exists for a deliberate exception, not a convenience.
 * Exposing Cynth beyond this machine also needs the hostnames it will be
 * reached by listed in CYNTH_ALLOWED_HOSTS, or the request guard refuses them.
 */
export const DEFAULT_SERVER_HOST = '127.0.0.1';

/** Hostnames (no port) the request guard accepts in addition to loopback. */
function resolveAllowedHosts(): string[] {
  return (process.env.CYNTH_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export const env = {
  get port(): number {
    return resolvePort();
  },
  get host(): string {
    return process.env.CYNTH_SERVER_HOST?.trim() || DEFAULT_SERVER_HOST;
  },
  get allowedHosts(): string[] {
    return resolveAllowedHosts();
  },
};
