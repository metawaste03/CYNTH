import { useEffect, useState } from 'react';
import type { SeoMetadata, SeoRecommendation } from '../../shared/types/seo';

/**
 * SEO metadata, and the proposals waiting on a decision.
 *
 * The distinction the panel keeps in front of the user:
 *
 *   RECOMMENDATION — what Cynth thinks should change.
 *   PROPOSED CHANGE — concrete text it suggests.
 *   APPROVED CHANGE — what you accepted, which is the only thing that is
 *   ever written into a field.
 *
 * Nothing proposed here is applied until the Approve button is pressed, and a
 * proposal about the article body has no Approve-and-apply at all, because
 * Cynth does not edit article content.
 */

const SEO_TITLE_LIMIT = 60;
const META_LIMIT = 160;

interface Props {
  metadata: SeoMetadata;
  /** The editorial title, shown alongside so the two jobs stay visibly separate. */
  articleTitle: string | null;
  articleSlug: string | null;
  recommendations: SeoRecommendation[];
  onSave: (metadata: SeoMetadata) => Promise<void>;
  onDecide: (id: number, status: 'approved' | 'rejected') => Promise<void>;
  isSaving: boolean;
  busyRecommendationId: number | null;
}

function CharacterCount({ value, limit }: { value: string; limit: number }) {
  const length = value.trim().length;
  const state = length === 0 ? 'empty' : length > limit ? 'over' : 'ok';
  return (
    <span className={`seo-count seo-count--${state}`}>
      {length} / ~{limit} characters
      {state === 'over' && ' — likely to be truncated in search results'}
    </span>
  );
}

const FIELD_LABEL: Record<string, string> = {
  seo_title: 'SEO title',
  meta_description: 'Meta description',
  seo_slug: 'Slug',
  canonical_url: 'Canonical URL',
  structured_data: 'Structured data',
  heading: 'Heading',
  content: 'Article content',
  image_alt: 'Image alt text',
  internal_link: 'Internal link',
  external_link: 'External link',
};

export function SeoMetadataForm({
  metadata,
  articleTitle,
  articleSlug,
  recommendations,
  onSave,
  onDecide,
  isSaving,
  busyRecommendationId,
}: Props) {
  const [draft, setDraft] = useState(metadata);

  useEffect(() => setDraft(metadata), [metadata]);

  const set = <K extends keyof SeoMetadata>(key: K, value: SeoMetadata[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const open = recommendations.filter((recommendation) => recommendation.status === 'proposed');

  return (
    <div className="seo-metadata">
      {open.length > 0 && (
        <section className="seo-proposals">
          <h4>Proposals awaiting your decision</h4>
          <p className="seo-form__hint">
            Nothing below has been applied. Approving a metadata proposal writes it into the field; approving advice
            about the article body records your decision and changes no prose.
          </p>
          <ul>
            {open.map((recommendation) => {
              const isMetadata = ['seo_title', 'meta_description', 'seo_slug', 'canonical_url'].includes(
                recommendation.field,
              );
              return (
                <li key={recommendation.id} className="seo-proposal">
                  <div className="seo-proposal__head">
                    <span className="seo-badge seo-badge--field">
                      {FIELD_LABEL[recommendation.field] ?? recommendation.field}
                    </span>
                    <span className="seo-finding__origin">
                      {recommendation.origin === 'deterministic'
                        ? 'Checked by Cynth'
                        : `Model proposal${
                            recommendation.confidence !== null
                              ? ` · ${Math.round(recommendation.confidence * 100)}% confidence`
                              : ''
                          }`}
                    </span>
                  </div>

                  <p className="seo-proposal__recommendation">{recommendation.recommendation}</p>

                  {recommendation.proposedValue ? (
                    <div className="seo-proposal__diff">
                      <div>
                        <span className="seo-proposal__label">Now</span>
                        <p className="seo-proposal__value seo-proposal__value--current">
                          {recommendation.currentValue || <em>Not set</em>}
                        </p>
                      </div>
                      <div>
                        <span className="seo-proposal__label">Proposed</span>
                        <p className="seo-proposal__value">{recommendation.proposedValue}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="seo-form__hint">
                      No replacement text is proposed — this is advice to act on yourself.
                    </p>
                  )}

                  {recommendation.rationale && <p className="seo-proposal__rationale">{recommendation.rationale}</p>}

                  <div className="seo-finding__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busyRecommendationId === recommendation.id}
                      onClick={() => void onDecide(recommendation.id, 'approved')}
                    >
                      {isMetadata && recommendation.proposedValue ? 'Approve and apply' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busyRecommendationId === recommendation.id}
                      onClick={() => void onDecide(recommendation.id, 'rejected')}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form
        className="seo-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(draft);
        }}
      >
        <div className="seo-form__field">
          <label htmlFor="seo-title">SEO title</label>
          <input
            id="seo-title"
            type="text"
            value={draft.seoTitle ?? ''}
            onChange={(e) => set('seoTitle', e.target.value || null)}
            placeholder={articleTitle ?? 'Leave empty to use the article title'}
          />
          <CharacterCount value={draft.seoTitle ?? articleTitle ?? ''} limit={SEO_TITLE_LIMIT} />
          {/* The two titles do different jobs, so the panel shows both. */}
          <p className="seo-form__hint">
            The article’s own title (the H1) is <strong>{articleTitle || 'not set'}</strong>. Leave this empty unless
            the editorial headline reads poorly as a search result — Cynth will not overwrite the editorial title
            either way.
          </p>
        </div>

        <div className="seo-form__field">
          <label htmlFor="seo-meta">Meta description</label>
          <textarea
            id="seo-meta"
            rows={3}
            value={draft.metaDescription ?? ''}
            onChange={(e) => set('metaDescription', e.target.value || null)}
          />
          <CharacterCount value={draft.metaDescription ?? ''} limit={META_LIMIT} />
        </div>

        <div className="seo-form__field">
          <label htmlFor="seo-slug">SEO slug</label>
          <input
            id="seo-slug"
            type="text"
            value={draft.seoSlug ?? ''}
            onChange={(e) => set('seoSlug', e.target.value || null)}
            placeholder={articleSlug ?? 'Leave empty to use the article slug'}
          />
          <p className="seo-form__hint">
            The article’s slug is <code>{articleSlug || 'not set'}</code>. Setting one here does not change it. Once a
            URL is published, changing it costs whatever that URL has earned — Cynth reports a slug change on a
            published article as a blocking finding rather than pushing it.
          </p>
        </div>

        <div className="seo-form__field">
          <label htmlFor="seo-canonical">Canonical URL</label>
          <input
            id="seo-canonical"
            type="url"
            value={draft.canonicalUrl ?? ''}
            onChange={(e) => set('canonicalUrl', e.target.value || null)}
            placeholder="https://…"
          />
        </div>

        <button type="submit" className="button button--primary" disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save SEO metadata'}
        </button>
      </form>
    </div>
  );
}
