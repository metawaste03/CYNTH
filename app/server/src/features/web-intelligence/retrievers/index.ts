import type { WebRetriever } from '../webIntelligence.types.js';
import { httpRetriever } from './httpRetriever.js';

/**
 * THE RETRIEVER REGISTRY.
 *
 * Where a crawler or site-search connector registers itself, mirroring how
 * `cms/connectors/index.ts` registers the WordPress connector and
 * `generation/providers/index.ts` registers the provider adapters.
 *
 * Empty for Milestones 14–16, which built the architecture for web
 * intelligence and no crawler at all. Milestone 17 registered the first
 * retriever, so `hasAnyRetriever()` is now true and Cynth can read a page.
 *
 * The obligations stated here before anything was registered still bind
 * everything that is. A retriever must, before its first request:
 *   - be given a WebSource the user created, never a bare URL;
 *   - refuse a source whose crawl/search permission is off;
 *   - honour robots.txt where the source says to;
 *   - honour the source's rate limit;
 *   - write a WebRetrieval row for every fetch, so every later finding can
 *     name where it came from.
 *
 * `httpRetriever` reads ONE named page. It implements no `discover()` and
 * follows no links: registering it did not turn Cynth into a crawler, and
 * nothing here enumerates a site.
 */
const RETRIEVERS: readonly WebRetriever[] = [httpRetriever];

export function getRetriever(retrieverType: string): WebRetriever | null {
  return RETRIEVERS.find((retriever) => retriever.retrieverType === retrieverType) ?? null;
}

export function listRetrievers(): { retrieverType: string; label: string }[] {
  return RETRIEVERS.map((retriever) => ({ retrieverType: retriever.retrieverType, label: retriever.label }));
}

/** True when Cynth has any ability to retrieve web content at all. False for Milestones 14–16; true since 17. */
export function hasAnyRetriever(): boolean {
  return RETRIEVERS.length > 0;
}
