import { getArticleById } from '../articles/articles.repository.js';
import { buildGenerationContext } from '../generation/generationContext.service.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { classifyModel, evaluateSpend } from '../generation/generationPolicy.service.js';
import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import { ARTICLE_GENERATION_TASK } from '../generation/generation.service.js';
import {
  applyRevisedArticle,
  buildSeoRevisionPrompt,
  parseArticle,
  buildVoiceBlock,
} from '../pipeline/stages/generationStages.service.js';
import type { GeneratedArticle } from '../pipeline/stages/generationStages.service.js';
import { getLatestAnalysisRun, listFindingsForAnalysis, setFindingStatus } from './seo.repository.js';
import type { StoredSeoFinding } from './seo.types.js';

/**
 * APPLYING SEO FINDINGS TO THE ARTICLE ITSELF.
 *
 * The gap this closes, reported plainly: the Findings panel lists warnings and
 * recommendations and there is no way to correct any of them. That was true,
 * and it was by design — approving a finding recorded a decision and changed
 * nothing, because nothing in Cynth could edit a written article. Only the
 * pipeline's single automatic revision had ever rewritten a body.
 *
 * On one real article, 13 of 17 findings needed body edits: seven FAQ answers
 * too thin to be quoted, an answer buried in a 631-word section, an empty FAQ
 * heading, a missing definition sentence, and a target query that never
 * appeared in the prose. Every one of them was unactionable.
 *
 * ONE PASS, NOT THIRTEEN. The findings are handed over as a single
 * specification and applied in one model call, the same way the reviewer's
 * specification is. Thirteen separate calls would cost thirteen times as much
 * and — worse — each would see an article the previous one had already
 * changed, so a later fix could undo an earlier one.
 *
 * WHAT IT WILL NOT DO. It edits; it does not rewrite. Findings that Cynth
 * itself marks "no action required" are never sent. Metadata findings are not
 * sent either: those already have a path that writes the field directly, and
 * asking a model to rewrite prose to fix a meta description would be the wrong
 * tool. Product markers survive exactly where they are.
 *
 * NEVER AUTOMATIC. The pipeline caps itself at one revision on purpose. This
 * is an editor pressing a button on a finished article, outside that cap and
 * outside the pipeline, and it passes the same spend gate as any paid call.
 */

/** Findings whose remedy is metadata, not prose. They have their own path. */
const METADATA_CODES = new Set([
  'seo_title_absent',
  'seo_title_too_long',
  'meta_description_absent',
  'meta_description_too_long',
  'meta_description_too_short',
  'canonical_absent',
  'slug_absent',
  'slug_too_long',
]);

/**
 * Findings Cynth raises for information and answers itself with "no action".
 *
 * Sending these would ask a model to fix something nobody thinks is broken,
 * and the most likely result is an edit for its own sake.
 */
function isActionable(finding: StoredSeoFinding): boolean {
  if (finding.status !== 'open') return false;
  if (METADATA_CODES.has(finding.code)) return false;
  if (finding.severity === 'info') return false;

  const recommendation = (finding.recommendation ?? '').toLowerCase();
  if (recommendation.startsWith('no action')) return false;

  return true;
}

export interface SeoRevisionResult {
  applied: number;
  skipped: number;
  model: string;
  findings: { id: number; code: string; summary: string }[];
}

export async function runSeoRevision(
  articleId: number,
  options: { confirmedCost?: boolean; modelId?: number | null } = {},
): Promise<SeoRevisionResult> {
  const article = getArticleById(articleId);
  if (!article) throw new GenerationError('invalid_configuration', 'Article not found.');

  const stored = article.structuredContent;
  if (!stored) {
    throw new GenerationError(
      'invalid_configuration',
      'This article has no generated content to revise. Generate it first.',
    );
  }

  const run = getLatestAnalysisRun(articleId);
  if (!run) {
    throw new GenerationError('invalid_configuration', 'Run an SEO analysis first — there are no findings to apply.');
  }

  const all = listFindingsForAnalysis(run.id);
  const actionable = all.filter(isActionable);

  if (!actionable.length) {
    throw new GenerationError(
      'invalid_configuration',
      'No open finding needs a change to the article. Metadata findings are fixed under SEO metadata, and the rest are marked "no action required".',
    );
  }

  const resolution = resolveProviderTarget(ARTICLE_GENERATION_TASK, options.modelId ?? null, 'SEO revision');
  if (resolution.error) throw resolution.error;

  const target = resolution.target!;
  const routed = resolution.route!.model!;

  // The same gate as every paid path. A refusal sends nothing.
  const decision = evaluateSpend(classifyModel(routed), options.confirmedCost === true);
  if (!decision.allowed) {
    throw new GenerationError(
      decision.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      decision.reason ??
        `Applying ${actionable.length} finding(s) is one paid call on ${target.modelName}. Confirm to continue.`,
    );
  }

  const current = JSON.parse(stored) as GeneratedArticle;

  try {
    const response = await target.adapter.generate(
      {
        prompt: buildSeoRevisionPrompt(current, actionable, buildVoiceBlock(buildGenerationContext(articleId))),
        model: target.modelName,
        timeoutMs: 300_000,
      },
      { apiKey: target.apiKey, baseUrl: target.baseUrl },
    );

    /**
     * Parsed WITHOUT a template on purpose.
     *
     * The writer is held to the template because it is producing the article
     * from nothing. This is an edit of an article that already satisfied it,
     * and the prompt requires every section back — so a template check here
     * would add nothing and would fail an otherwise good edit over a section
     * the original never had.
     */
    const revised = parseArticle(response.text ?? '');
    applyRevisedArticle(articleId, revised, target.modelName);

    // Marked resolved only after the article is actually saved. A finding
    // recorded as fixed against an article that never changed is worse than
    // one still showing as open.
    for (const finding of actionable) setFindingStatus(finding.id, 'resolved');

    return {
      applied: actionable.length,
      skipped: all.length - actionable.length,
      model: target.modelName,
      findings: actionable.map((f) => ({ id: f.id, code: f.code, summary: f.summary })),
    };
  } catch (error) {
    if (isGenerationError(error)) throw error;
    const message = truncateForDisplay(
      redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]),
    );
    throw new GenerationError('provider_error', `The SEO revision failed: ${message}`);
  }
}
