import type { ModelPurpose } from '../../shared/types/aiProvider';

export const PURPOSE_LABELS: Record<ModelPurpose, string> = {
  article_generation: 'Article Generation',
  seo_review: 'SEO Review',
  quality_review: 'Quality Review',
  title_generation: 'Title Generation',
  keyword_expansion: 'Keyword Expansion',
};

export function purposeLabel(purpose: string | null): string {
  if (!purpose) return 'No purpose set';
  return PURPOSE_LABELS[purpose as ModelPurpose] ?? purpose;
}
