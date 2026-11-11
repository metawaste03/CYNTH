import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

/**
 * Which requests Cynth will answer at all.
 *
 * Cynth has no login, so "who may call this API" is answered by where the
 * request comes from. Binding to 127.0.0.1 keeps other machines out, but not
 * other WEBSITES open in this machine's browser. Two holes remain, and this
 * closes both:
 *
 *   DNS REBINDING. A page on attacker.example re-points its own hostname at
 *   127.0.0.1. The browser then treats Cynth as same-origin with that page,
 *   which can read every response and drive every route. The request still
 *   says `Host: attacker.example`, so a Host allow-list stops it cold.
 *
 *   CROSS-SITE FORM POSTS. Any page can auto-submit a <form> to
 *   http://localhost:4100/... — several routes need no body and fall back to
 *   the default (Live) connection. Browsers always send `Origin` on such a
 *   POST, so a write is refused when Origin names a different site.
 *
 * Scripts and tests call the API with no Origin header at all, and are
 * allowed; the Vite dev server proxies with the browser's own
 * localhost Host and Origin, which are loopback and pass.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The hostname part of a Host header or URL host, lowercased, without the port. */
function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

function isAllowedHostname(hostname: string, extra: string[]): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost') || extra.includes(hostname);
}

export function requestGuard(req: Request, res: Response, next: NextFunction) {
  const extra = env.allowedHosts;

  const host = req.headers.host;
  if (!host || !isAllowedHostname(hostnameOf(host), extra)) {
    return res.status(403).json({ errors: ['Cynth only answers requests addressed to this machine.'] });
  }

  if (!SAFE_METHODS.has(req.method)) {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost: string | null = null;
      try {
        originHost = origin === 'null' ? null : new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!originHost || !isAllowedHostname(hostnameOf(originHost), extra)) {
        return res.status(403).json({ errors: ['Cynth refused a change requested by another website.'] });
      }
    }
  }

  next();
}
