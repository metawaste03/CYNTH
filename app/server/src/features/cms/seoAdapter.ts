import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { getArticleSeo } from '../seo/seo.repository.js';
import { listInternalLinksForArticle, listExternalSourcesForArticle } from '../seo/seo.repository.js';
import type { CmsLinkRecommendation, CmsSeoMetadata } from './cms.types.js';

/**
 * THE CMS SEO ADAPTER.
 *
 *   Cynth SEO Metadata  ->  CMS SEO Adapter  ->  WordPress SEO Plugin
 *
 * Cynth holds SEO metadata in its own vocabulary. Every CMS, and every SEO
 * plugin within a CMS, stores it somewhere different — a Yoast install keeps
 * a meta description in one post-meta key, a Rank Math install in another, a
 * headless CMS in a field, a static generator in front-matter. This module is
 * the seam between the two.
 *
 * What it deliberately does NOT do is name a plugin. `SeoFieldMapping` below
 * describes what a target expects; no mapping is registered, because
 * EveryFiveDays' SEO stack has not been chosen and inventing a plugin's API
 * would mean writing post-meta keys that may not exist. When the stack is
 * decided, one mapping is added here and nothing else in Cynth changes.
 *
 * The other rule this file holds: ONLY APPROVED VALUES TRAVEL. A proposed SEO
 * title that a human has not accepted is not sent anywhere. Links are sent
 * only when approved, and never inserted into the article body — see
 * `internalLinks`/`externalLinks`, which carry `approved` on every entry.
 */

/**
 * How one CMS/plugin combination expects SEO metadata to arrive.
 *
 * Declared so that adding Yoast, Rank Math, SEOPress, or a headless CMS is
 * one object rather than a change to the connector. The value shapes are
 * intentionally loose (a record of keys to values) because that is genuinely
 * what the targets differ on.
 */
export interface SeoFieldMapping {
  /** Matches cms_connections.connector_type, e.g. 'wordpress'. */
  readonly connectorType: string;
  /** Which SEO stack this mapping targets, e.g. a plugin slug. Free text; never assumed. */
  readonly target: string;
  readonly label: string;
  /**
   * Translates Cynth's SEO metadata into whatever the target stores it in —
   * post meta, custom fields, front-matter. Returning an empty object is a
   * valid answer for a target that stores nothing.
   */
  map(metadata: CmsSeoMetadata): Record<string, unknown>;
}

/**
 * Rank Math (Milestone 37).
 *
 * Rank Math stores its per-post SEO fields as ordinary post meta under these
 * keys. They are stable and long-standing, which is why they can be written
 * without a plugin-specific API.
 *
 * WHAT THIS BUYS. Rank Math falls back to its `%excerpt%` template when a post
 * has no description of its own — so a post already shows the article's
 * excerpt in search results. Writing `rank_math_description` replaces that
 * fallback with copy written to be read on a results page, which is a
 * different job from a listing blurb.
 *
 * ONE PRECONDITION, and it is on the WordPress side: these keys are not
 * registered with `show_in_rest`, so the REST API silently drops them unless
 * the site registers them. `docs/rank-math-rest-meta.php` is the mu-plugin
 * that does it. Without that file installed, this mapping produces fields
 * WordPress ignores — no error, no effect. `cmsPublish` reports what it sent
 * so the difference is visible.
 *
 * Only non-empty values are emitted. An empty string here would overwrite
 * something a human had written in Rank Math's own editor, which is the one
 * outcome worse than sending nothing.
 */
const RANK_MATH: SeoFieldMapping = {
  connectorType: 'wordpress',
  target: 'rankmath',
  label: 'Rank Math SEO',
  map(metadata) {
    const fields: Record<string, unknown> = {};

    if (metadata.metaDescription) fields.rank_math_description = metadata.metaDescription;
    if (metadata.seoTitle) fields.rank_math_title = metadata.seoTitle;
    if (metadata.canonicalUrl) fields.rank_math_canonical_url = metadata.canonicalUrl;
    // Rank Math's "focus keyword" is what its own on-page scoring grades
    // against. Cynth's target query is exactly that, so the two are the same
    // field under two names.
    if (metadata.targetQuery) fields.rank_math_focus_keyword = metadata.targetQuery;

    return fields;
  },
};

/**
 * THE MAPPING REGISTRY.
 *
 * A mapping is registered only for a stack that has actually been chosen.
 * `getSeoFieldMapping()` returns null for anything else, so the connector
 * sends no plugin fields — the only honest behaviour while a target is
 * unknown.
 */
const MAPPINGS: readonly SeoFieldMapping[] = [RANK_MATH];

export function getSeoFieldMapping(connectorType: string, target: string): SeoFieldMapping | null {
  return MAPPINGS.find((mapping) => mapping.connectorType === connectorType && mapping.target === target) ?? null;
}

export function listSeoFieldMappings(): { connectorType: string; target: string; label: string }[] {
  return MAPPINGS.map((mapping) => ({
    connectorType: mapping.connectorType,
    target: mapping.target,
    label: mapping.label,
  }));
}

/**
 * Assembles the CMS-independent SEO metadata for one article.
 *
 * Returns null when Cynth holds nothing worth sending — an article with no
 * SEO metadata must produce no SEO fields at all, rather than empty strings
 * that would overwrite whatever a human had written in the CMS.
 *
 * Only values a human owns are included: metadata the user saved or approved.
 * A model's proposal that has not been accepted is not metadata yet.
 */
export function buildCmsSeoMetadata(article: ArticleDraftDto): CmsSeoMetadata | null {
  const record = getArticleSeo(article.id);
  const { metadata, configuration } = record;

  const seoTitle = metadata.seoTitle?.trim() || null;
  const metaDescription = metadata.metaDescription?.trim() || null;
  const canonicalUrl = metadata.canonicalUrl?.trim() || null;
  const targetQuery = configuration.targetQuery?.trim() || null;

  // Structured data travels only when a human accepted a type for this
  // article. An eligibility assessment is not an acceptance.
  const structuredData = metadata.structuredDataTypes.length && metadata.structuredData ? metadata.structuredData : null;

  const internalLinks = approvedLinks(article.id, 'internal');
  const externalLinks = approvedLinks(article.id, 'external');

  const hasAnything =
    seoTitle !== null ||
    metaDescription !== null ||
    canonicalUrl !== null ||
    targetQuery !== null ||
    structuredData !== null ||
    internalLinks.length > 0 ||
    externalLinks.length > 0;

  if (!hasAnything) return null;

  return {
    seoTitle,
    metaDescription,
    canonicalUrl,
    targetQuery,
    structuredData,
    internalLinks,
    externalLinks,
  };
}

/**
 * Link recommendations a human approved.
 *
 * Every entry carries `approved: true` because nothing else is returned:
 * a proposed link is a suggestion inside Cynth and must not reach a CMS
 * payload.
 *
 * THIS LIST IS STILL ONLY METADATA. `internalLinks.service.ts` is what writes
 * an approved link into the body, and it writes it into the ARTICLE — so by
 * the time a push happens the link is already part of the content the
 * connector maps. Nothing here inserts anything; that separation is why a
 * link can be inspected in Cynth before it reaches a reader.
 */
function approvedLinks(articleId: number, kind: 'internal' | 'external'): CmsLinkRecommendation[] {
  if (kind === 'internal') {
    return listInternalLinksForArticle(articleId)
      .filter((link) => link.status === 'approved')
      .map((link) => ({
        // A Cynth-relative URL: the CMS decides its own permalink structure,
        // so a slug is the most Cynth can honestly assert.
        url: link.targetSlug ? `/${link.targetSlug}` : `#article-${link.targetArticleId}`,
        anchorText: link.anchorSuggestion,
        rationale: link.reason,
        approved: true,
      }));
  }

  return listExternalSourcesForArticle(articleId)
    .filter((source) => source.status === 'approved' && source.suggestedUrl !== null)
    .map((source) => ({
      url: source.suggestedUrl!,
      anchorText: null,
      // The verification state travels with the link, so a downstream
      // consumer can never mistake a suggestion for a checked source.
      rationale: source.rationale
        ? `${source.rationale} (verification: ${source.verificationStatus})`
        : `Verification: ${source.verificationStatus}`,
      approved: true,
    }));
}
