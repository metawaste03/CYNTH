/**
 * The three supported provider types (Milestone 8). "Supported" curates
 * what the UI suggests — it does not restrict what can be stored: provider
 * records also accept any other freeform type string, so a future provider
 * can be added without a schema or validation change.
 */
export const SUPPORTED_PROVIDER_TYPES = ['openrouter', 'anthropic', 'openai'] as const;

/**
 * MODEL CAPABILITIES — the jobs a registered model may be assigned to.
 *
 * A model is identified by Provider -> Model -> Capability, and holds a SET
 * of these rather than one (Milestone 15): the best article writer is not
 * automatically the best SEO reviewer, but one model may legitimately be
 * both, and the registry must be able to say so.
 *
 * Adding a future capability is a one-line change here. Nothing downstream
 * enumerates these by hand: the meta endpoint publishes this list, the client
 * renders whatever it publishes, and the capability column is validated
 * against it rather than by a database constraint.
 */
export const MODEL_PURPOSES = [
  'article_generation',
  'seo_review',
  'research',
  'quality_review',
  'title_generation',
  'keyword_expansion',
  'image_generation',
] as const;

export type ModelPurpose = (typeof MODEL_PURPOSES)[number];

/**
 * How each capability is described to a person.
 *
 * Server-side so the label and the meaning travel together with the value —
 * a client that renders a purpose it has never heard of falls back to the raw
 * key rather than showing nothing.
 */
export const MODEL_PURPOSE_META: Record<
  ModelPurpose,
  { label: string; description: string; /** True where Cynth actually routes work to this capability today. */ implemented: boolean }
> = {
  article_generation: {
    label: 'Article Generation',
    description: 'Writes the article body from the assembled prompt.',
    implemented: true,
  },
  seo_review: {
    label: 'SEO Review',
    description: 'Assesses search intent, relevance and topical coverage in the AI SEO pass.',
    implemented: true,
  },
  research: {
    label: 'Research',
    description:
      'Works out what a product is for, from the metadata its page publishes, so an article can place it where it is relevant.',
    implemented: true,
  },
  quality_review: {
    label: 'Quality Review',
    description:
      'Model-assisted editorial review. Assignable now; the Quality Gate currently runs deterministic checks only and calls no model.',
    implemented: false,
  },
  title_generation: {
    label: 'Title Generation',
    description: 'Proposes working titles. Assignable now; not yet routed to by any workflow.',
    implemented: false,
  },
  keyword_expansion: {
    label: 'Keyword Expansion',
    description: 'Expands a seed keyword into related queries. Assignable now; not yet routed to by any workflow.',
    implemented: false,
  },
  image_generation: {
    label: 'Featured Image Generation',
    description:
      'Draws a featured image from the article. Priced per image rather than per token, so its cost is not known before the call and is read from what the provider reports afterwards.',
    implemented: true,
  },
};

export function isValidPurpose(value: unknown): value is ModelPurpose {
  return typeof value === 'string' && (MODEL_PURPOSES as readonly string[]).includes(value);
}

/** The capability list for the meta endpoint: value, label, description and whether anything routes to it yet. */
export function listPurposes() {
  return MODEL_PURPOSES.map((purpose) => ({ value: purpose, ...MODEL_PURPOSE_META[purpose] }));
}
