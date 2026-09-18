import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Must match DEFAULT_SERVER_PORT in ../server/src/shared/config/env.ts. */
const DEFAULT_SERVER_PORT = 4100
const DEFAULT_CLIENT_PORT = 5173

/**
 * The dev proxy has to point at whatever port the Express server actually
 * listens on, so both sides read the same setting rather than each hardcoding
 * a number that can drift apart.
 *
 * Only CYNTH_SERVER_PORT and CYNTH_SERVER_URL are ever read out of the
 * server's env files. Those files also hold provider API keys, which are
 * deliberately ignored here and never enter the client bundle — this runs in
 * Node, at dev-server startup, and only decides a proxy target.
 */
const SHARED_KEYS = ['CYNTH_SERVER_PORT', 'CYNTH_SERVER_URL'] as const

function readSharedServerConfig(): Partial<Record<(typeof SHARED_KEYS)[number], string>> {
  const found: Partial<Record<(typeof SHARED_KEYS)[number], string>> = {}

  // .env.local wins over .env, matching the server's own precedence.
  for (const file of ['.env', '.env.local']) {
    const filePath = path.resolve(__dirname, '..', 'server', file)
    if (!fs.existsSync(filePath)) continue

    for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue

      const key = trimmed.slice(0, eq).trim()
      if ((SHARED_KEYS as readonly string[]).includes(key)) {
        found[key as (typeof SHARED_KEYS)[number]] = trimmed.slice(eq + 1).trim()
      }
    }
  }

  return found
}

function resolveProxyTarget(): string {
  const shared = readSharedServerConfig()

  // A real environment variable always beats a file, so a one-off run can
  // override without editing anything.
  const explicitUrl = process.env.CYNTH_SERVER_URL ?? shared.CYNTH_SERVER_URL
  if (explicitUrl) return explicitUrl.replace(/\/+$/, '')

  const port = process.env.CYNTH_SERVER_PORT ?? shared.CYNTH_SERVER_PORT ?? String(DEFAULT_SERVER_PORT)
  return `http://localhost:${port}`
}

const proxyTarget = resolveProxyTarget()
const clientPort = Number(process.env.CYNTH_CLIENT_PORT ?? DEFAULT_CLIENT_PORT)

console.log(`[cynth] Vite dev server proxying /api and /uploads -> ${proxyTarget}`)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    proxy: {
      // Local dev only: proxies API calls to the Express server so the
      // browser sees same-origin requests and no CORS setup is needed.
      '/api': proxyTarget,
      '/uploads': proxyTarget,
    },
  },
})
