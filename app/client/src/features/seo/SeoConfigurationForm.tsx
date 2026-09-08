import { useEffect, useState } from 'react';
import type { SearchIntent, SeoConfiguration } from '../../shared/types/seo';

/**
 * The article's SEO configuration.
 *
 * Everything here is the user's. Cynth reads it and reasons about it, and
 * never fills it in on the user's behalf — including the target query, which
 * is deliberately optional: a topic-oriented article with no exact-match
 * keyword is a normal article, and the engine analyses it semantically.
 */

const INTENT_OPTIONS: { value: SearchIntent; label: string; hint: string }[] = [
  { value: 'informational', label: 'Informational', hint: 'The reader wants to understand something.' },
  {
    value: 'commercial_investigation',
    label: 'Commercial investigation',
    hint: 'The reader is comparing options before buying.',
  },
  { value: 'transactional', label: 'Transactional', hint: 'The reader intends to act or buy now.' },
  { value: 'navigational', label: 'Navigational', hint: 'The reader is looking for a specific place.' },
  { value: 'hybrid', label: 'Hybrid', hint: 'Genuinely more than one — name the others below.' },
];

interface Props {
  configuration: SeoConfiguration;
  onSave: (configuration: SeoConfiguration) => Promise<void>;
  isSaving: boolean;
}

const listToText = (values: string[]) => values.join(', ');
const textToList = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export function SeoConfigurationForm({ configuration, onSave, isSaving }: Props) {
  const [draft, setDraft] = useState(configuration);
  const [secondaryKeywords, setSecondaryKeywords] = useState(listToText(configuration.secondaryKeywords));
  const [semanticTopics, setSemanticTopics] = useState(listToText(configuration.semanticTopics));

  useEffect(() => {
    setDraft(configuration);
    setSecondaryKeywords(listToText(configuration.secondaryKeywords));
    setSemanticTopics(listToText(configuration.semanticTopics));
  }, [configuration]);

  const set = <K extends keyof SeoConfiguration>(key: K, value: SeoConfiguration[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const toggleSecondaryIntent = (intent: SearchIntent) => {
    const present = draft.secondaryIntents.includes(intent);
    set(
      'secondaryIntents',
      present ? draft.secondaryIntents.filter((entry) => entry !== intent) : [...draft.secondaryIntents, intent],
    );
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void onSave({
      ...draft,
      secondaryKeywords: textToList(secondaryKeywords),
      semanticTopics: textToList(semanticTopics),
    });
  }

  return (
    <form className="seo-form" onSubmit={submit}>
      <div className="seo-form__field">
        <label htmlFor="seo-target-query">Target search query</label>
        <input
          id="seo-target-query"
          type="text"
          value={draft.targetQuery ?? ''}
          onChange={(e) => set('targetQuery', e.target.value || null)}
          placeholder="Leave empty for a topic-oriented article"
        />
        <p className="seo-form__hint">
          Optional. Not every article has one exact-match keyword, and leaving this empty is a valid configuration —
          the engine will analyse the article topically instead.
        </p>
      </div>

      <div className="seo-form__field">
        <label htmlFor="seo-intent">Search intent</label>
        <select
          id="seo-intent"
          value={draft.searchIntent ?? ''}
          onChange={(e) => set('searchIntent', (e.target.value || null) as SearchIntent | null)}
        >
          <option value="">Not set — let the analysis infer it</option>
          {INTENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="seo-form__hint">
          {INTENT_OPTIONS.find((option) => option.value === draft.searchIntent)?.hint ??
            'The analysis will detect the intent the article actually serves and report it.'}
        </p>
      </div>

      {draft.searchIntent === 'hybrid' && (
        <fieldset className="seo-form__field seo-form__fieldset">
          <legend>Which intents does it combine?</legend>
          {INTENT_OPTIONS.filter((option) => option.value !== 'hybrid').map((option) => (
            <label key={option.value} className="seo-form__checkbox">
              <input
                type="checkbox"
                checked={draft.secondaryIntents.includes(option.value)}
                onChange={() => toggleSecondaryIntent(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      )}

      <div className="seo-form__field">
        <label htmlFor="seo-secondary">Supporting queries</label>
        <input
          id="seo-secondary"
          type="text"
          value={secondaryKeywords}
          onChange={(e) => setSecondaryKeywords(e.target.value)}
          placeholder="comma, separated"
        />
        <p className="seo-form__hint">
          Related searches this article should also serve. These are topics, not a quota — nothing rewards repeating
          them.
        </p>
      </div>

      <div className="seo-form__field">
        <label htmlFor="seo-semantic">Concepts to cover</label>
        <input
          id="seo-semantic"
          type="text"
          value={semanticTopics}
          onChange={(e) => setSemanticTopics(e.target.value)}
          placeholder="comma, separated"
        />
        <p className="seo-form__hint">
          Ideas and entities the article should address regardless of exact wording. This is what topical coverage is
          judged against.
        </p>
      </div>

      <div className="seo-form__row">
        <div className="seo-form__field">
          <label htmlFor="seo-audience">SEO target audience</label>
          <input
            id="seo-audience"
            type="text"
            value={draft.targetAudience ?? ''}
            onChange={(e) => set('targetAudience', e.target.value || null)}
          />
        </div>
        <div className="seo-form__field">
          <label htmlFor="seo-geo">Geographic target</label>
          <input
            id="seo-geo"
            type="text"
            value={draft.geoTarget ?? ''}
            onChange={(e) => set('geoTarget', e.target.value || null)}
            placeholder="Leave empty if there isn’t one"
          />
        </div>
      </div>

      <div className="seo-form__field">
        <label htmlFor="seo-objectives">SEO objectives</label>
        <textarea
          id="seo-objectives"
          rows={2}
          value={draft.seoObjectives ?? ''}
          onChange={(e) => set('seoObjectives', e.target.value || null)}
          placeholder="What this article is meant to achieve in search"
        />
      </div>

      <div className="seo-form__field">
        <label htmlFor="seo-notes">Notes</label>
        <textarea
          id="seo-notes"
          rows={2}
          value={draft.notes ?? ''}
          onChange={(e) => set('notes', e.target.value || null)}
        />
      </div>

      <button type="submit" className="button button--primary" disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Save SEO configuration'}
      </button>
    </form>
  );
}
