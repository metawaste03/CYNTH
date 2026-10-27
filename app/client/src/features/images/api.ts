import { api } from '../../shared/services/apiClient';
import type { MediaAsset, MediaSuggestionResult } from '../media/api';

/**
 * The featured-image client.
 *
 * Reading the state is free and calls nothing. Generating is the only paid
 * call, and `confirmedCost` is never sent as true on the first attempt — the
 * server asks, and only an answered question sends it.
 */

export interface ImageCandidate {
  id: string;
  url: string;
  byteSize: number;
  mimeType: string;
}

export interface FeaturedImageState {
  articleId: number;
  current: MediaAsset | null;
  suggestions: MediaSuggestionResult | null;
  candidates: ImageCandidate[];
  /** The batch before this one, kept so two ideas can be compared. */
  superseded: ImageCandidate[];
  canGenerate: boolean;
  generationIssue: string | null;
}

export interface ImageBrief {
  prompt: string;
  basis: {
    title: string;
    theme: string;
    topic: string;
    hasProducts: boolean;
    /** The scene the director chose, or null when the deterministic fallback was used. */
    scene: string | null;
    /** Which model chose it. Null on the fallback, and null for a scene the editor supplied. */
    directedBy: string | null;
    /** Set when the scene names something that would put lettering in the frame. */
    concern?: string | null;
  };
}

export interface GenerationResult {
  candidates: ImageCandidate[];
  prompt: string;
  model: string;
  /** What the provider said it cost. Null means it did not say — unknown, not free. */
  reportedCost: number | null;
}

export function fetchFeaturedImage(articleId: number): Promise<FeaturedImageState> {
  return api
    .get<{ featuredImage: FeaturedImageState }>(`/featured-image/${articleId}`)
    .then((response) => response.featuredImage);
}

export type ImageStyle = 'photograph' | 'illustration';

export function fetchImagePrompt(articleId: number, steer?: string, style?: ImageStyle): Promise<ImageBrief> {
  const query = new URLSearchParams();
  if (steer) query.set('steer', steer);
  if (style) query.set('style', style);
  const suffix = query.toString() ? `?${query}` : '';
  return api.get<{ brief: ImageBrief }>(`/featured-image/${articleId}/prompt${suffix}`).then((r) => r.brief);
}

export function generateFeaturedImages(
  articleId: number,
  input: {
    count: number;
    steer?: string | null;
    style?: ImageStyle;
    scene?: string | null;
    modelId?: number | null;
    allowText?: boolean;
    confirmedCost: boolean;
  },
): Promise<{ result: GenerationResult; featuredImage: FeaturedImageState }> {
  return api.post(`/featured-image/${articleId}/generate`, input);
}

export function selectFeaturedImage(
  articleId: number,
  candidateId: string,
  input: { altText?: string | null } = {},
): Promise<{ mediaId: number; featuredImage: FeaturedImageState }> {
  return api.post(`/featured-image/${articleId}/select`, { candidateId, ...input });
}

export function discardCandidates(articleId: number): Promise<{ removed: number; featuredImage: FeaturedImageState }> {
  return api.delete(`/featured-image/${articleId}/candidates`);
}

/**
 * Sends the chosen featured image to the CMS post.
 *
 * Safe on a published article: it uploads the file and points the post's
 * featured image at it, and writes nothing else — not the title, the body or
 * the status. Needed because an image chosen AFTER a push had no way to reach
 * the live post at all.
 */
export function pushFeaturedImageToCms(
  articleId: number,
  connectionId?: number | null,
): Promise<{ message: string; filename: string; post: { id: string; status: string; url: string | null } }> {
  return api.post(`/articles/${articleId}/cms/push-featured-image`, connectionId ? { connectionId } : {});
}

export interface SelectableImageModel {
  modelId: number;
  modelName: string;
  displayName: string | null;
  imageOutputPrice: number | null;
  assignedCapabilities: { purpose: string; isDefaultForPurpose: boolean }[];
}

/** The image models that could draw this, so the choice is per article rather than global. */
export function fetchImageModels(): Promise<SelectableImageModel[]> {
  return api
    .get<{ models: SelectableImageModel[] }>('/ai-providers/selectable-models?purpose=image_generation')
    .then((r) => r.models);
}
