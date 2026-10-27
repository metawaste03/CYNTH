import { getArticleById } from '../articles/articles.repository.js';
import { buildGenerationContext } from '../generation/generationContext.service.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { classifyModel, evaluateSpend } from '../generation/generationPolicy.service.js';
import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import { ARTICLE_GENERATION_TASK } from '../generation/generation.service.js';
import {
  applyRevisedArticle,
  buildInternalLinkPrompt,
  parseArticle,
  buildVoiceBlock,
} from '../pipeline/stages/generationStages.service.js';
import type { GeneratedArticle } from '../pipeline/stages/generationStages.service.js';
import { listLinksForArticle } from '../cms/cmsLinks.repository.js';
import { listInternalLinksForArticle, setInternalLinkStatus } from './seo.repository.js';
import type { InternalLinkOpportunity } from './seo.types.js';

/**
 * TURNING AN APPROVED INTERNAL LINK INTO AN ACTUAL LINK.
 *
 * The gap this closes, reported plainly: the Opportunities panel offers
 * internal links between related articles, and approving one did nothing.
 * That was true and it was written down — `seoAdapter.ts` says "Nothing
 * downstream inserts these into the article body", and the table's own schema
 * said the status could never be 'inserted' because no code wrote a link.
 *
 * The evidence was unambiguous: ten approved links across six articles, and
 * those six article bodies contained zero `href`s between them.
 *
 * WHY A MODEL AND NOT A STRING REPLACE. The obvious implementation is to find
 * the anchor text in the body and wrap it. Measured against the real backlog,
 * that would have placed ONE of the ten: the anchor suggestions are target
 * article TITLES, which do not appear verbatim in the source prose. Worse, two
 * of the accidental matches were fragments sitting inside headings, where a
 * link has no business being. So placement is the model's job — find the
 * sentence that is already about the target, and link from there.
 *
 * ONE CALL PER ARTICLE, not one per link, for the same reason the SEO revision
 * is one call: each successive call would see a body the last one had changed.
 *
 * WHAT IT REFUSES TO LINK TO. A target that is not publicly readable on the
 * live site. A draft's URL is a `?p=340` query permalink that answers 404 for
 * a visitor, so linking to one would manufacture broken links inside finished
 * articles — worse than the missing link it replaced. Those stay approved and
 * say why, and a later run picks them up once the target is published.
 *
 * THE LINK IS THE SITE'S OWN URL, NEVER A GUESS. It comes from
 * `article_cms_links.external_url` — what WordPress answered with when the
 * article was pushed. Cynth does not model the site's permalink structure and
 * must not start now.
 */

/** A link that can be made: an approved opportunity with a live, public URL. */
export interface InternalLinkPlacement {
  linkId: number;
  targetArticleId: number;
  targetTitle: string;
  url: string;
  anchor: string | null;
  reason: string | null;
}

export interface InternalLinkApplyResult {
  /** Links this run wrote into the body. */
  inserted: { linkId: number; targetTitle: string; url: string }[];
  /** Already in the body before this run. Recorded, not rewritten. */
  alreadyPresent: { linkId: number; targetTitle: string; url: string }[];
  /** Approved, but not placeable yet — each with the reason. */
  held: { linkId: number; targetTitle: string; reason: string }[];
  /** Null when no model call was needed. */
  model: string | null;
  /** True when the article body changed and therefore needs re-pushing. */
  articleChanged: boolean;
}

/**
 * A URL a reader could actually follow, or null.
 *
 * `?p=` is the tell for an unpublished post: WordPress only mints a pretty
 * permalink once the post is public, and the query form 404s for anyone who is
 * not logged in. Requiring `publish` AND a clean path means a link Cynth makes
 * is one a visitor can use.
 */
export function resolvePublicUrl(targetArticleId: number): string | null {
  const candidates = listLinksForArticle(targetArticleId)
    .filter((link) => link.externalStatus === 'publish')
    .filter((link) => typeof link.externalUrl === 'string' && /^https?:\/\//i.test(link.externalUrl))
    .filter((link) => !/[?&]p=\d/i.test(link.externalUrl!))
    // https over http, then the most recent push. Deliberately NOT the default
    // connection: the default here is a dead local install, so trusting that
    // flag would link every article to everyfivedays.local.
    .sort((a, b) => {
      const secure = Number(b.externalUrl!.startsWith('https://')) - Number(a.externalUrl!.startsWith('https://'));
      if (secure !== 0) return secure;
      return (b.lastPushedAt ?? '').localeCompare(a.lastPushedAt ?? '');
    });

  return candidates[0]?.externalUrl ?? null;
}

/** Every piece of prose a link could live in. Headings are not among them. */
function proseOf(article: GeneratedArticle): string {
  return [
    ...article.sections.map((section) => section.body),
    ...article.faq.map((entry) => entry.answer),
  ].join('\n\n');
}

const PRODUCT_MARKER = /\[\[product:\d+\]\]/g;

function countMarkers(article: GeneratedArticle): number {
  return (proseOf(article).match(PRODUCT_MARKER) ?? []).length;
}

function classify(links: InternalLinkOpportunity[], article: GeneratedArticle) {
  const prose = proseOf(article);
  const placements: InternalLinkPlacement[] = [];
  const alreadyPresent: InternalLinkApplyResult['alreadyPresent'] = [];
  const held: InternalLinkApplyResult['held'] = [];

  for (const link of links) {
    const url = resolvePublicUrl(link.targetArticleId);

    if (!url) {
      held.push({
        linkId: link.id,
        targetTitle: link.targetTitle,
        reason:
          'The target article is not published on the live site yet, so any link to it would 404. ' +
          'Publish it and run this again.',
      });
      continue;
    }

    if (prose.includes(url)) {
      alreadyPresent.push({ linkId: link.id, targetTitle: link.targetTitle, url });
      continue;
    }

    placements.push({
      linkId: link.id,
      targetArticleId: link.targetArticleId,
      targetTitle: link.targetTitle,
      url,
      anchor: link.anchorSuggestion,
      reason: link.reason,
    });
  }

  return { placements, alreadyPresent, held };
}

export async function applyApprovedInternalLinks(
  articleId: number,
  options: { confirmedCost?: boolean; modelId?: number | null } = {},
): Promise<InternalLinkApplyResult> {
  const article = getArticleById(articleId);
  if (!article) throw new GenerationError('invalid_configuration', 'Article not found.');

  const stored = article.structuredContent;
  if (!stored) {
    throw new GenerationError(
      'invalid_configuration',
      'This article has no generated content, so there is nothing to link from.',
    );
  }

  const approved = listInternalLinksForArticle(articleId).filter((link) => link.status === 'approved');
  if (!approved.length) {
    throw new GenerationError(
      'invalid_configuration',
      'No approved internal link is waiting on this article. Approve one in Opportunities first.',
    );
  }

  const current = JSON.parse(stored) as GeneratedArticle;
  const { placements, alreadyPresent, held } = classify(approved, current);

  // A link that was already in the body is linked, whatever the row said.
  for (const entry of alreadyPresent) setInternalLinkStatus(entry.linkId, 'inserted');

  // Nothing to place is a result, not an error — and it must not spend.
  if (!placements.length) {
    return { inserted: [], alreadyPresent, held, model: null, articleChanged: false };
  }

  const resolution = resolveProviderTarget(ARTICLE_GENERATION_TASK, options.modelId ?? null, 'internal linking');
  if (resolution.error) throw resolution.error;

  const target = resolution.target!;
  const routed = resolution.route!.model!;

  const decision = evaluateSpend(classifyModel(routed), options.confirmedCost === true);
  if (!decision.allowed) {
    throw new GenerationError(
      decision.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      decision.reason ??
        `Placing ${placements.length} internal link(s) is one paid call on ${target.modelName}. Confirm to continue.`,
    );
  }

  try {
    const response = await target.adapter.generate(
      {
        prompt: buildInternalLinkPrompt(current, placements, buildVoiceBlock(buildGenerationContext(articleId))),
        model: target.modelName,
        timeoutMs: 300_000,
      },
      { apiKey: target.apiKey, baseUrl: target.baseUrl },
    );

    const revised = parseArticle(response.text ?? '');
    const revisedProse = proseOf(revised);

    /**
     * Two guards, because the expected change here is a handful of characters.
     *
     * A link insertion that shortens the article or loses a product marker has
     * not inserted a link — it has rewritten the article and dropped things on
     * the way. The article on disk is the only copy, so it is better to refuse
     * and keep it than to save a body nobody asked for. 2% allows for
     * whitespace normalisation and nothing more.
     */
    const before = proseOf(current).length;
    if (revisedProse.length < before * 0.98) {
      throw new GenerationError(
        'provider_error',
        `The link pass returned a shorter article (${revisedProse.length} characters against ${before}), ` +
          'so it rewrote rather than linked. Nothing was saved.',
      );
    }

    const markersBefore = countMarkers(current);
    const markersAfter = countMarkers(revised);
    if (markersAfter < markersBefore) {
      throw new GenerationError(
        'provider_error',
        `The link pass lost ${markersBefore - markersAfter} product marker(s). Nothing was saved.`,
      );
    }

    // Claim only what is actually there. A link reported as inserted against a
    // body that never got it is the exact failure this feature exists to fix.
    const landed = placements.filter((placement) => revisedProse.includes(placement.url));
    const missed = placements.filter((placement) => !landed.includes(placement));

    /**
     * NOT PLACING A LINK IS A LEGITIMATE ANSWER, and it must not read as a
     * failure.
     *
     * Two of the first five real attempts came back with no link, and both
     * were right to. The opportunity finder had matched those pairs on shared
     * thematic vocabulary and said so in its own reason — "No matching phrase
     * exists in this article yet, so the anchor text would need to be written
     * in." The prompt forbids writing text in, so the model correctly declined.
     *
     * The alternative — appending a "Related reading" list — was rejected
     * because the site already renders exactly that automatically, from the
     * post's category, through `[efd_related_articles]`. Duplicating it inside
     * the body would add a second, worse copy of a section that is already
     * there. An article that genuinely does not discuss the target gets no
     * link, and that is the correct outcome rather than a missing feature.
     */
    if (!landed.length) {
      return {
        inserted: [],
        alreadyPresent,
        held: [
          ...held,
          ...missed.map((p) => ({
            linkId: p.linkId,
            targetTitle: p.targetTitle,
            reason:
              'The article never discusses this subject, so there are no existing words to link from. ' +
              'Placing it would mean writing a new sentence, which this pass will not do. ' +
              'Add a line about it yourself and run this again.',
          })),
        ],
        model: target.modelName,
        articleChanged: false,
      };
    }

    applyRevisedArticle(articleId, revised, target.modelName);
    for (const placement of landed) setInternalLinkStatus(placement.linkId, 'inserted');

    return {
      inserted: landed.map((p) => ({ linkId: p.linkId, targetTitle: p.targetTitle, url: p.url })),
      alreadyPresent,
      held: [
        ...held,
        ...missed.map((p) => ({
          linkId: p.linkId,
          targetTitle: p.targetTitle,
          reason:
            'Not placed: the article has no existing words about this subject to link from, ' +
            'and this pass will not write a new sentence to carry a link.',
        })),
      ],
      model: target.modelName,
      articleChanged: true,
    };
  } catch (error) {
    if (isGenerationError(error)) throw error;
    const message = truncateForDisplay(
      redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]),
    );
    throw new GenerationError('provider_error', `Placing the internal links failed: ${message}`);
  }
}
