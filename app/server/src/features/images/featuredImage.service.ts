import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import { classifyModel, evaluateSpend } from '../generation/generationPolicy.service.js';
import { recordGeneration } from '../generation/generationHistory.repository.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { getArticleById } from '../articles/articles.repository.js';
import { attachMedia, createMedia, getFeaturedImage } from '../media/media.repository.js';
import { MEDIA_IMAGES_DIR, ensureMediaUploadsDir } from '../media/media.upload.js';
import { suggestMedia } from '../media/mediaSuggest.service.js';
import { buildFeaturedImagePrompt } from './imagePrompt.service.js';

/**
 * DRAWING A FEATURED IMAGE (Milestone 25).
 *
 * The order of operations here is the whole design:
 *
 *   1. SUGGEST FIRST. An article whose theme already holds a suitable image
 *      does not need a new one drawn. The panel shows what Cynth already owns
 *      before it offers to spend anything.
 *   2. GENERATE ONLY WHEN ASKED. Nothing on this path runs as part of the
 *      pipeline. It costs money and it is never triggered by anything except
 *      a person pressing the button.
 *   3. CANDIDATES ARE NOT LIBRARY IMAGES. Generated candidates live in a
 *      pending folder until one is chosen. Only the chosen one becomes a
 *      media asset, so three rejected drafts do not silently accumulate in a
 *      library the editor curates by hand.
 *
 * COST. Image models are priced per image, so unlike every text stage there
 * is no honest up-front estimate — a token count cannot produce one. The
 * spend gate still runs (an image model is never free, so Test mode refuses
 * it and Production requires confirmation), and the figure recorded afterwards
 * is the one the PROVIDER reported, not one Cynth computed. Where the provider
 * reports nothing, the cost is recorded as unknown rather than as zero.
 */

const IMAGE_TIMEOUT_MS = 180_000;

/** Where candidates wait. Under the uploads root so they are servable, in their own folder so they are sweepable. */
const PENDING_DIR = path.join(MEDIA_IMAGES_DIR, 'pending');

const MIN_CANDIDATES = 1;
const MAX_CANDIDATES = 4;

export interface ImageCandidate {
  /** The filename, which is also the handle used to select or discard it. */
  id: string;
  /** Relative path as served under /uploads. */
  url: string;
  byteSize: number;
  mimeType: string;
}

export interface GenerationResult {
  candidates: ImageCandidate[];
  prompt: string;
  model: string;
  /** What the provider said this cost, in USD. Null means it did not say. */
  reportedCost: number | null;
}

function ensurePendingDir(): void {
  ensureMediaUploadsDir();
  fs.mkdirSync(PENDING_DIR, { recursive: true });
}

/** Candidate filenames carry the article id, so a sweep never touches another article's. */
function candidatePrefix(articleId: number): string {
  return `a${articleId}-`;
}

function relativePendingPath(filename: string): string {
  return path.posix.join('uploads', 'media', 'pending', filename);
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('jpeg')) return '.jpg';
  if (mimeType.includes('webp')) return '.webp';
  return '.png';
}

/** Removes an article's outstanding candidates. Never throws — a stale file must not fail a request. */
export function discardCandidates(articleId: number, except?: string): number {
  let removed = 0;
  try {
    if (!fs.existsSync(PENDING_DIR)) return 0;
    for (const name of fs.readdirSync(PENDING_DIR)) {
      if (!name.startsWith(candidatePrefix(articleId))) continue;
      if (except && name === except) continue;
      fs.rmSync(path.join(PENDING_DIR, name), { force: true });
      removed += 1;
    }
  } catch {
    // An orphaned file is harmless; failing the request over one is not.
  }
  return removed;
}

export function listCandidates(articleId: number): ImageCandidate[] {
  try {
    if (!fs.existsSync(PENDING_DIR)) return [];
    return fs
      .readdirSync(PENDING_DIR)
      .filter((name) => name.startsWith(candidatePrefix(articleId)))
      .map((name) => {
        const stats = fs.statSync(path.join(PENDING_DIR, name));
        return {
          id: name,
          url: relativePendingPath(name),
          byteSize: stats.size,
          mimeType: name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.webp') ? 'image/webp' : 'image/png',
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ what exists --- */

export interface FeaturedImageState {
  articleId: number;
  /** The image currently attached, if any. */
  current: ReturnType<typeof getFeaturedImage>;
  /** Images Cynth already owns that fit this article, ranked and explained. */
  suggestions: ReturnType<typeof suggestMedia>;
  candidates: ImageCandidate[];
  /** Whether a model is configured to draw one at all. */
  canGenerate: boolean;
  generationIssue: string | null;
}

export function getFeaturedImageState(articleId: number): FeaturedImageState | null {
  const article = getArticleById(articleId);
  if (!article) return null;

  const resolution = resolveProviderTarget('image_generation', null, 'featured image generation');
  const adapterSupports = resolution.target?.adapter.generateImages !== undefined;

  return {
    articleId,
    current: getFeaturedImage(articleId),
    // Suggested first, deliberately: the cheapest good image is one already
    // owned.
    suggestions: suggestMedia(articleId, { role: 'featured' }),
    candidates: listCandidates(articleId),
    canGenerate: resolution.error === null && adapterSupports,
    generationIssue: resolution.error
      ? resolution.error.message
      : adapterSupports
        ? null
        : 'The provider behind the assigned image model cannot generate images.',
  };
}

/* -------------------------------------------------------------- drawing --- */

export interface GenerateOptions {
  count?: number;
  steer?: string | null;
  modelId?: number | null;
  confirmedCost?: boolean;
}

export async function generateFeaturedImages(
  articleId: number,
  options: GenerateOptions = {},
): Promise<GenerationResult> {
  const brief = buildFeaturedImagePrompt(articleId, options.steer);
  if ('error' in brief) throw new GenerationError('invalid_configuration', brief.error);

  const resolution = resolveProviderTarget('image_generation', options.modelId ?? null, 'featured image generation');
  if (resolution.error) throw resolution.error;

  const target = resolution.target!;
  if (!target.adapter.generateImages) {
    throw new GenerationError(
      'unsupported_provider',
      `${target.providerName} cannot generate images. Assign the Featured Image Generation capability to a model on a provider that can.`,
    );
  }

  // THE SPEND GATE. The same one every paid path uses. Test mode refuses a
  // paid model outright and Production requires an explicit confirmation that
  // is never defaulted to true.
  const model = resolution.route!.model!;

  /**
   * Classification here reads the IMAGE price, and treats its absence as
   * unknown rather than as free.
   *
   * Both halves matter. Image models routinely publish zero per-token prices
   * and charge for image output instead — OpenRouter lists Seedream 4.5 at
   * prompt 0, completion 0, image output $9.58/M tokens — so reading the
   * per-token prices alone calls a paid model free and skips this gate
   * entirely. And a model registered before Cynth stored image pricing has
   * NULL there, which is genuinely unknown: the honest answer is to gate it,
   * not to assume the best.
   */
  const costClass =
    model.imageOutputPrice === null
      ? 'unknown'
      : classifyModel({
          promptPrice: model.promptPrice,
          completionPrice: model.completionPrice,
          requestPrice: null,
          imageOutputPrice: model.imageOutputPrice,
        });

  const decision = evaluateSpend(costClass, options.confirmedCost === true);
  if (!decision.allowed) {
    throw new GenerationError(
      decision.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      decision.requiresConfirmation
        ? `Images are charged per image, so the exact cost is not known until the provider answers. ${
            options.count ?? MAX_CANDIDATES
          } image(s) will be generated on ${model.modelName}. Confirm to continue.`
        : (decision.reason ?? 'Image generation is not permitted in the current mode.'),
    );
  }

  const count = Math.min(MAX_CANDIDATES, Math.max(MIN_CANDIDATES, Math.trunc(options.count ?? 3)));
  const startedAt = Date.now();

  try {
    const result = await target.adapter.generateImages(
      { prompt: brief.prompt, model: target.modelName, count, aspectRatio: '16:9', timeoutMs: IMAGE_TIMEOUT_MS },
      { apiKey: target.apiKey, baseUrl: target.baseUrl },
    );

    // A new batch replaces the last one. Keeping both would mean choosing
    // between candidates generated from two different prompts.
    discardCandidates(articleId);
    ensurePendingDir();

    const candidates: ImageCandidate[] = result.images.map((image) => {
      const filename = `${candidatePrefix(articleId)}${randomUUID()}${extensionFor(image.mimeType)}`;
      fs.writeFileSync(path.join(PENDING_DIR, filename), image.data);
      return {
        id: filename,
        url: relativePendingPath(filename),
        byteSize: image.data.length,
        mimeType: image.mimeType,
      };
    });

    recordGeneration({
      articleId,
      taskType: 'image_generation',
      providerName: target.providerName,
      providerType: target.providerType,
      model: result.reportedModel ?? target.modelName,
      status: 'success',
      durationMs: Date.now() - startedAt,
      // The cost the provider reported, kept in the metadata because the
      // history table counts tokens and this charge is not a token charge.
      // Absent stays absent: an unreported cost is unknown, not free.
      // The prompt text is not stored, matching every other history record:
      // it is assembled deterministically from the article, so it can be
      // rebuilt from GET /prompt rather than duplicated into the log.
      metadata: {
        images: candidates.length,
        reportedCostUsd: result.reportedCost,
        costBasis: result.reportedCost === null ? 'unreported' : 'provider_reported',
        promptCharacterCount: brief.prompt.length,
      },
    });

    return {
      candidates,
      prompt: brief.prompt,
      model: result.reportedModel ?? target.modelName,
      reportedCost: result.reportedCost,
    };
  } catch (error) {
    const failure = isGenerationError(error)
      ? error
      : new GenerationError(
          'provider_error',
          truncateForDisplay(
            redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]),
          ),
        );

    recordGeneration({
      articleId,
      taskType: 'image_generation',
      providerName: target.providerName,
      providerType: target.providerType,
      model: target.modelName,
      status: 'failure',
      errorCode: failure.code,
      errorMessage: failure.message,
      durationMs: Date.now() - startedAt,
    });

    throw failure;
  }
}

/* ------------------------------------------------------------- choosing --- */

/**
 * Promotes one candidate into the media library and attaches it.
 *
 * The file MOVES rather than being copied, and the rest of the batch is
 * deleted: a candidate that was not chosen is not a library image, and
 * leaving it on disk would eventually fill the uploads folder with pictures
 * nobody selected.
 */
export function selectCandidate(
  articleId: number,
  candidateId: string,
  input: { title?: string; altText?: string | null } = {},
): { mediaId: number } | { error: string } {
  const article = getArticleById(articleId);
  if (!article) return { error: 'Article not found.' };

  // The id is a filename Cynth generated. It is still checked rather than
  // trusted: a path separator here would write outside the uploads folder.
  if (!/^[A-Za-z0-9._-]+$/.test(candidateId) || !candidateId.startsWith(candidatePrefix(articleId))) {
    return { error: 'That is not a candidate for this article.' };
  }

  const source = path.join(PENDING_DIR, candidateId);
  if (!fs.existsSync(source)) return { error: 'That image is no longer available. Generate a new set.' };

  const filename = `${randomUUID()}${path.extname(candidateId)}`;
  const destination = path.join(MEDIA_IMAGES_DIR, filename);

  ensureMediaUploadsDir();
  fs.renameSync(source, destination);

  const title = input.title?.trim() || article.title?.trim() || article.generated?.title?.trim() || 'Generated image';
  const asset = createMedia({
    filePath: path.posix.join('uploads', 'media', filename),
    originalFilename: null,
    mimeType: candidateId.endsWith('.jpg') ? 'image/jpeg' : candidateId.endsWith('.webp') ? 'image/webp' : 'image/png',
    byteSize: fs.statSync(destination).size,
    title,
    // Recorded on the asset itself, so an AI-generated image is identifiable
    // as one for as long as it exists — including by whoever finds it in the
    // library a year from now.
    description: `Generated by Cynth for "${title}".`,
    altText: input.altText ?? null,
    themeId: article.themeId ?? null,
    kind: 'featured',
    tags: 'ai-generated',
    credit: 'AI-generated',
  });

  const attached = attachMedia({ articleId, mediaId: asset.id, role: 'featured', origin: 'suggested' });
  if ('error' in attached) return { error: attached.error };

  discardCandidates(articleId);
  return { mediaId: asset.id };
}
