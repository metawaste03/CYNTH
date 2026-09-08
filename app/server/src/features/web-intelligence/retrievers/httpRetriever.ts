import { createHash } from 'node:crypto';
import type { WebRetrieval, WebRetriever, WebSource } from '../webIntelligence.types.js';
import { isSourceAuthorised } from '../webSources.repository.js';

/**
 * A plain HTTP GET retriever (Milestone 17) — the first thing ever registered
 * in this registry.
 *
 * It implements the five obligations `retrievers/index.ts` set out for
 * whatever was added here first, and it is written so that each one is a
 * separate, checkable step rather than a claim:
 *
 *   1. It is given a WebSource, never a bare URL — that is the interface.
 *   2. `isPermitted()` refuses a source whose crawl permission is off, and
 *      refuses a URL whose host is not the source's own domain, so an
 *      authorisation for one site cannot be spent on another.
 *   3. It reads robots.txt and obeys it whenever the source says to. A
 *      robots.txt it cannot read is treated as a refusal, not as permission.
 *   4. It honours the source's rate limit, per source, in-process.
 *   5. Every fetch produces a WebRetrieval the caller persists, including the
 *      content hash and whether robots was actually checked.
 *
 * It fetches ONE named page. It follows no links, enumerates nothing, and
 * implements no `discover()` — there is no crawl here, only a read of a page
 * the user pointed at.
 */

/** One page, on a link the user is about to publish. Long enough for a slow retailer, short enough to fail visibly. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Refuses a response big enough to be a download rather than a page. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Redirect hops followed before Cynth gives up. Every hop is re-authorised; this only bounds a loop. */
const MAX_REDIRECTS = 5;

/**
 * Identifies Cynth honestly, with a contact path.
 *
 * Not a browser string: a retriever that disguises itself is a retriever
 * whose robots.txt compliance means nothing, since the rules it is obeying
 * are keyed to who it says it is.
 */
const USER_AGENT = 'CynthBot/1.0 (+editorial research; respects robots.txt)';

/** Last request time per source id, for the rate limit. Process-local, which matches Cynth being one local process. */
const lastRequestAt = new Map<number, number>();

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when `host` is the source's domain or a subdomain of it. */
function belongsToSource(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

interface RobotsRules {
  /** Path prefixes disallowed for us, longest-match-wins alongside `allow`. */
  disallow: string[];
  allow: string[];
  crawlDelaySeconds: number | null;
}

/**
 * Parses robots.txt for the groups that apply to us: our own user-agent if
 * named, otherwise `*`. A named group wins outright, which is what the
 * standard says and what a site owner expects.
 */
function parseRobots(text: string, userAgent: string): RobotsRules {
  const agent = userAgent.toLowerCase();
  const groups: { agents: string[]; disallow: string[]; allow: string[]; crawlDelay: number | null }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], disallow: [], allow: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;
    if (!current) continue;

    if (field === 'disallow') current.disallow.push(value);
    else if (field === 'allow') current.allow.push(value);
    else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }

  const named = groups.filter((group) => group.agents.some((a) => a !== '*' && agent.includes(a)));
  const wildcard = groups.filter((group) => group.agents.includes('*'));
  const applicable = named.length ? named : wildcard;

  return {
    // An empty Disallow value means "nothing is disallowed" — dropping it is
    // what turns a permissive robots.txt into a blocking one.
    disallow: applicable.flatMap((group) => group.disallow).filter((rule) => rule !== ''),
    allow: applicable.flatMap((group) => group.allow).filter((rule) => rule !== ''),
    crawlDelaySeconds: applicable.reduce<number | null>(
      (max, group) => (group.crawlDelay === null ? max : Math.max(max ?? 0, group.crawlDelay)),
      null,
    ),
  };
}

/** robots.txt path matching: `*` is a wildcard, a trailing `$` anchors the end. */
function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const pattern = anchored ? rule.slice(0, -1) : rule;
  const parts = pattern.split('*');

  let index = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === '') continue;
    const found = i === 0 ? (path.startsWith(part) ? 0 : -1) : path.indexOf(part, index);
    if (found === -1) return false;
    index = found + part.length;
  }

  return anchored ? index === path.length : true;
}

/** Longest matching rule wins; Allow wins a tie. Both are what the de-facto standard specifies. */
function robotsPermits(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) =>
    list.filter((rule) => ruleMatches(rule, path)).reduce((max, rule) => Math.max(max, rule.length), -1);

  const disallowed = longest(rules.disallow);
  if (disallowed === -1) return true;
  return longest(rules.allow) >= disallowed;
}

/** robots.txt per host, for this process. A retailer's robots.txt does not change between three product URLs. */
const robotsCache = new Map<string, { rules: RobotsRules | null; fetchedAt: number; reason: string }>();
const ROBOTS_CACHE_MS = 10 * 60 * 1000;

async function loadRobots(url: string): Promise<{ rules: RobotsRules | null; reason: string }> {
  const parsed = new URL(url);
  const key = parsed.origin;

  const cached = robotsCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_MS) {
    return { rules: cached.rules, reason: cached.reason };
  }

  let result: { rules: RobotsRules | null; reason: string };
  try {
    const response = await fetch(`${parsed.origin}/robots.txt`, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404 || response.status === 410) {
      // No robots.txt is a real answer: the site has published no rules.
      result = { rules: { disallow: [], allow: [], crawlDelaySeconds: null }, reason: 'No robots.txt is published.' };
    } else if (!response.ok) {
      result = { rules: null, reason: `robots.txt could not be read (HTTP ${response.status}).` };
    } else {
      result = { rules: parseRobots(await response.text(), USER_AGENT), reason: 'robots.txt was read.' };
    }
  } catch (error) {
    result = {
      rules: null,
      reason: `robots.txt could not be read (${error instanceof Error ? error.message : 'network error'}).`,
    };
  }

  robotsCache.set(key, { ...result, fetchedAt: Date.now() });
  return result;
}

async function respectRateLimit(source: WebSource, robotsDelaySeconds: number | null): Promise<void> {
  // The stricter of the two applies: the user's ceiling and the site's own
  // stated delay are both limits, not competing preferences.
  const fromSource = source.rateLimitPerMinute ? 60_000 / source.rateLimitPerMinute : 0;
  const fromRobots = robotsDelaySeconds ? robotsDelaySeconds * 1000 : 0;
  const minimumGap = Math.max(fromSource, fromRobots);
  if (minimumGap <= 0) return;

  const last = lastRequestAt.get(source.id);
  if (last === undefined) return;

  const wait = last + minimumGap - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export const httpRetriever: WebRetriever = {
  retrieverType: 'http',
  label: 'HTTP page read',

  async isPermitted(source: WebSource, url: string): Promise<{ permitted: boolean; reason: string }> {
    const authorised = isSourceAuthorised(source, 'crawl');
    if (!authorised.permitted) return authorised;

    const host = hostOf(url);
    if (!host) return { permitted: false, reason: 'Only http and https URLs can be read.' };

    // An authorisation for one site must not be spendable on another.
    if (!belongsToSource(host, source.domain)) {
      return {
        permitted: false,
        reason: `${host} is not covered by the authorisation for ${source.domain}. Add it as its own source if you want Cynth to read it.`,
      };
    }

    if (!source.respectRobots) {
      return { permitted: true, reason: `${source.domain} permits crawling, and robots.txt is not enforced for it.` };
    }

    const { rules, reason } = await loadRobots(url);
    // Unreadable robots.txt is a refusal. Treating it as permission would
    // make the setting decorative exactly when it matters.
    if (!rules) return { permitted: false, reason: `${reason} Cynth will not read the page without it.` };

    const path = new URL(url).pathname + new URL(url).search;
    if (!robotsPermits(rules, path)) {
      return {
        permitted: false,
        reason: `${source.domain}/robots.txt disallows ${path} for automated readers. Cynth will not read it. Enter the product details by hand, or use a source that permits it.`,
      };
    }

    return { permitted: true, reason: `${reason} It permits ${path}.` };
  },

  async fetch(source: WebSource, url: string): Promise<{ retrieval: Omit<WebRetrieval, 'id'>; content: string }> {
    // Checked again here rather than trusted from the caller: this is the
    // function that makes the request, so this is where the guarantee has to
    // hold.
    const permission = await this.isPermitted(source, url);
    if (!permission.permitted) throw new Error(permission.reason);

    /**
     * REDIRECTS ARE FOLLOWED BY HAND, AND EVERY HOP IS RE-AUTHORISED.
     *
     * This used to be `redirect: 'follow'`, which was a hole: authorisation
     * was checked against the URL the user typed and never against the URL
     * actually fetched, so an authorised domain redirecting to an
     * unauthorised one would have been read anyway. Consent is per-URL, and
     * a redirect is a different URL.
     *
     * The practical benefit is the same rule read forwards: a link shortener
     * on its own authorised domain can now resolve to a destination that is
     * also authorised, and Cynth follows it — because both were permitted,
     * not because redirects are exempt.
     */
    let currentUrl = url;
    let response: Response | null = null;
    const chain: string[] = [];

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const robotsDelay = source.respectRobots ? (await loadRobots(currentUrl)).rules?.crawlDelaySeconds ?? null : null;
      await respectRateLimit(source, robotsDelay);
      lastRequestAt.set(source.id, Date.now());

      response = await fetch(currentUrl, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (!location) break;

      const next = new URL(location, currentUrl).toString();
      chain.push(next);

      // The destination has to be permitted in its own right. A redirect is
      // not a licence, and the source that authorised the first URL does not
      // automatically authorise wherever it points.
      const onward = await this.isPermitted(source, next);
      if (!onward.permitted) {
        throw new Error(
          `${currentUrl} redirected to ${next}, which is not permitted: ${onward.reason} Cynth stopped rather than following it.`,
        );
      }

      currentUrl = next;
      if (hop === MAX_REDIRECTS) {
        throw new Error(`${url} redirected more than ${MAX_REDIRECTS} times. Cynth stopped following it.`);
      }
    }

    if (!response) throw new Error(`No response was received from ${url}.`);

    const contentType = response.headers.get('content-type');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      throw new Error(`The page at ${currentUrl} is larger than Cynth will read (${MAX_BYTES} bytes).`);
    }

    const content = new TextDecoder('utf-8').decode(buffer);
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(content);

    return {
      retrieval: {
        webSourceId: source.id,
        // The URL actually read, not the one asked for. A provenance record
        // naming a URL that was never fetched would be worse than none.
        url: currentUrl,
        httpStatus: response.status,
        retrievedAt: new Date().toISOString(),
        contentType,
        contentHash: createHash('sha256').update(content).digest('hex'),
        title: titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 300) : null,
        retrievalMethod: 'http_get',
        // True because it was actually checked above, or null when the source
        // says not to check. Never true on assumption.
        robotsAllowed: source.respectRobots ? true : null,
        notes: chain.length ? `${permission.reason} Redirected via: ${chain.join(' -> ')}` : permission.reason,
      },
      content,
    };
  },
};
