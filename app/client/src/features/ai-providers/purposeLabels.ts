import type { ModelPurpose } from '../../shared/types/aiProvider';

/**
 * Fallback wording for a model capability.
 *
 * The server owns the authoritative labels and serves them from
 * `/ai-providers/meta`, so a capability added there appears in the UI without
 * a client change. This map covers the moment before that request lands, and
 * anything it does not know renders as its own key rather than as nothing.
 */
export const PURPOSE_LABELS: Record<ModelPurpose, string> = {
  article_generation: 'Article Generation',
  seo_review: 'SEO Review',
  research: 'Research',
  quality_review: 'Quality Review',
  title_generation: 'Title Generation',
  keyword_expansion: 'Keyword Expansion',
  image_generation: 'Featured Image Generation',
};

export function purposeLabel(purpose: string | null): string {
  if (!purpose) return 'No capability set';
  return PURPOSE_LABELS[purpose as ModelPurpose] ?? purpose;
}
