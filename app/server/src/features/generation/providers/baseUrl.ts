import { DEFAULT_BASE_URLS } from '../generation.constants.js';

/**
 * BASE URL DIAGNOSIS (Milestone 15).
 *
 * This file exists because of one specific, reproducible failure.
 *
 * A provider was configured with the base URL `https://openrouter.ai/` — the
 * website, pasted out of a browser — instead of `https://openrouter.ai/api/v1`,
 * the API root. Every catalogue read then requested `https://openrouter.ai/models`,
 * which is a real page: it answers HTTP 200 with `text/html`. Cynth saw a
 * successful response, failed to parse it as JSON, and reported
 *
 *     "The provider returned a response Cynth could not read."
 *
 * That message is true and useless. The provider was reachable, the key was
 * fine, the model existed; the URL pointed at a website. Nothing in the error
 * said so, so there was nothing to act on.
 *
 * Two things fix it, and both are here rather than buried in an adapter:
 *
 *   1. A base URL is checked BEFORE it is used, against what the provider
 *      type's API root actually looks like, and a recognisably-wrong one is
 *      refused with the corrected value spelled out.
 *   2. When a request does come back unparseable anyway, the error says what
 *      arrived (an HTML page, an empty body) and from where.
 *
 * Nothing here rewrites a user's configuration silently. A wrong base URL is
 * reported with the correction quoted; applying it stays the user's decision,
 * because a provider may legitimately sit behind a proxy or a gateway whose
 * URL Cynth has no business second-guessing.
 */

export interface BaseUrlDiagnosis {
  ok: boolean;
  /** The URL Cynth would use, normalised (trailing slashes stripped). */
  resolved: string | null;
  /** Present only when the URL is wrong in a way Cynth can name. */
  problem: string | null;
  /** The value that would be correct, when Cynth can work it out. */
  suggestion: string | null;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Checks a configured base URL for a provider type without contacting anything.
 *
 * The interesting case is the third one: a URL on the provider's OWN host that
 * is missing the API path. That is not a typo the user can see — the host is
 * right, the site loads in a browser, and the only symptom is an unreadable
 * response much later. It is the exact shape of the bug above, so it is named
 * explicitly rather than lumped in with "could not reach the provider".
 */
export function diagnoseBaseUrl(baseUrl: string | null, providerType: string): BaseUrlDiagnosis {
  const fallback = DEFAULT_BASE_URLS[providerType] ?? null;
  const configured = baseUrl?.trim() ? stripTrailingSlashes(baseUrl.trim()) : '';

  if (!configured) {
    return fallback
      ? { ok: true, resolved: fallback, problem: null, suggestion: null }
      : {
          ok: false,
          resolved: null,
          problem: `This provider has no Base URL and Cynth has no default for provider type "${providerType}".`,
          suggestion: null,
        };
  }

  if (!/^https?:\/\//i.test(configured)) {
    return {
      ok: false,
      resolved: null,
      problem: 'The Base URL must start with http:// or https://.',
      suggestion: `https://${configured}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return { ok: false, resolved: null, problem: 'The Base URL is not a valid URL.', suggestion: fallback };
  }

  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      resolved: null,
      problem: 'The Base URL must not carry a query string or a fragment — it is an endpoint root, not a link.',
      suggestion: stripTrailingSlashes(`${parsed.origin}${parsed.pathname}`),
    };
  }

  if (fallback) {
    const expected = new URL(fallback);
    const expectedPath = stripTrailingSlashes(expected.pathname);
    const actualPath = stripTrailingSlashes(parsed.pathname);

    // Same host, missing API path: the website was pasted instead of the API
    // root. This is the failure this file was written for.
    if (parsed.host === expected.host && expectedPath && !actualPath.startsWith(expectedPath)) {
      return {
        ok: false,
        resolved: null,
        problem:
          `${configured} is ${expected.host}'s website, not its API endpoint, so requests to it come back as web ` +
          `pages rather than data.`,
        suggestion: fallback,
      };
    }
  }

  return { ok: true, resolved: configured, problem: null, suggestion: null };
}

/**
 * A short description of what actually came back, for the case where a
 * response could not be parsed.
 *
 * The body itself is deliberately NOT included: an unparseable body is
 * usually a whole HTML document, and quoting it into an error message would
 * bury the one useful sentence. What it was, and how much of it there was, is
 * the actionable part.
 */
export function describeUnparsableBody(contentType: string | null, rawText: string): string {
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (!rawText.trim()) return 'an empty body';
  if (type.includes('html') || /^\s*<(!doctype|html)/i.test(rawText)) return 'an HTML web page';
  if (type.includes('xml')) return 'an XML document';
  if (type) return `a ${type} body that is not valid JSON`;
  return 'a body that is not valid JSON';
}
