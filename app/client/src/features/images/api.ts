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
  canGenerate: boolean;
  generationIssue: string | null;
}

export interface ImageBrief {
  prompt: string;
  basis: { title: string; theme: string; topic: string; hasProducts: boolean };
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

export function fetchImagePrompt(articleId: number, steer?: string): Promise<ImageBrief> {
  const query = steer ? `?steer=${encodeURIComponent(steer)}` : '';
  return api.get<{ brief: ImageBrief }>(`/featured-image/${articleId}/prompt${query}`).then((r) => r.brief);
}

export function generateFeaturedImages(
  articleId: number,
  input: { count: number; steer?: string | null; confirmedCost: boolean },
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
