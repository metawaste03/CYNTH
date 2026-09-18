import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../shared/services/apiClient';
import { attachMedia } from '../media/api';
import {
  discardCandidates,
  fetchFeaturedImage,
  fetchImagePrompt,
  generateFeaturedImages,
  selectFeaturedImage,
} from './api';
import type { FeaturedImageState } from './api';
import './FeaturedImage.css';

/**
 * THE FEATURED IMAGE.
 *
 * Ordered by cost, cheapest first:
 *
 *   1. What is already attached.
 *   2. What Cynth already owns that fits, ranked and explained. Free.
 *   3. Drawing a new one. Paid, per image, and never automatic.
 *
 * The generated candidates are shown as candidates — they are not in the
 * media library and will not be until one is chosen. Rejecting all four costs
 * what it cost and leaves nothing behind.
 */
interface FeaturedImagePanelProps {
  articleId: number;
  onChanged?: () => void;
}

export function FeaturedImagePanel({ articleId, onChanged }: FeaturedImagePanelProps) {
  const [state, setState] = useState<FeaturedImageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(3);
  const [steer, setSteer] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchFeaturedImage(articleId)
      .then(setState)
      .catch(() => setError('Could not load the featured image.'));
  }, [articleId]);

  useEffect(load, [load]);

  async function generate(confirmedCost: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await generateFeaturedImages(articleId, {
        count,
        steer: steer.trim() || null,
        confirmedCost,
      });
      setState(response.featuredImage);
      setNotice(
        response.result.reportedCost === null
          ? `${response.result.candidates.length} image(s) drawn on ${response.result.model}. The provider did not report a cost.`
          : `${response.result.candidates.length} image(s) drawn on ${response.result.model} for $${response.result.reportedCost.toFixed(4)}.`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'cost_confirmation_required') {
        if (window.confirm(`${err.errors.join(' ')}\n\nGenerate anyway?`)) {
          setBusy(false);
          return generate(true);
        }
        setNotice('Cancelled — nothing was spent.');
        return;
      }
      setError(err instanceof ApiError ? err.errors.join(' ') : 'The image could not be generated.');
    } finally {
      setBusy(false);
    }
  }

  async function choose(candidateId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await selectFeaturedImage(articleId, candidateId);
      setState(response.featuredImage);
      setNotice('Saved to the media library and set as the featured image. The other candidates were discarded.');
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'That image could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function useExisting(mediaId: number) {
    setBusy(true);
    setError(null);
    try {
      await attachMedia(articleId, mediaId, { role: 'featured', origin: 'suggested' });
      load();
      setNotice('Set as the featured image.');
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'That image could not be attached.');
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      const response = await discardCandidates(articleId);
      setState(response.featuredImage);
      setNotice(`${response.removed} candidate(s) discarded.`);
    } finally {
      setBusy(false);
    }
  }

  async function showPrompt() {
    try {
      const brief = await fetchImagePrompt(articleId, steer.trim() || undefined);
      setPrompt(brief.prompt);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'The prompt could not be built.');
    }
  }

  if (!state) return null;

  const suggestions = state.suggestions?.suggestions ?? [];

  return (
    <section className="content-section featured-image">
      <div className="content-section__head">
        <h2>Featured Image</h2>
        {state.current && <span className="status-badge">Set</span>}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      {/* 1. What is attached now. */}
      {state.current ? (
        <div className="featured-image__current">
          <img src={`/${state.current.url}`} alt={state.current.altText ?? state.current.title} />
          <div>
            <strong>{state.current.title}</strong>
            {state.current.credit && <p className="pipeline-muted">{state.current.credit}</p>}
            <p className="pipeline-muted">
              Change it by choosing another image below, or in the <Link to="/media">Media Library</Link>.
            </p>
          </div>
        </div>
      ) : (
        <p className="pipeline-muted">This article has no featured image yet.</p>
      )}

      {/* 2. What Cynth already owns. Free, so it comes first. */}
      <h3 className="featured-image__subhead">Images you already have</h3>
      {suggestions.length === 0 ? (
        <p className="pipeline-muted">
          {state.suggestions?.notes.join(' ') ?? 'Nothing in the library fits this article yet.'}
        </p>
      ) : (
        <ul className="featured-image__grid">
          {suggestions.map((suggestion) => (
            <li key={suggestion.asset.id}>
              <img src={`/${suggestion.asset.url}`} alt={suggestion.asset.altText ?? suggestion.asset.title} />
              <strong>{suggestion.asset.title}</strong>
              {/* Why it ranked where it did. A ranking without a reason is a
                  guess the editor cannot check. */}
              <ul className="featured-image__reasons">
                {suggestion.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <button
                type="button"
                className="button"
                disabled={busy || state.current?.id === suggestion.asset.id}
                onClick={() => useExisting(suggestion.asset.id)}
              >
                {state.current?.id === suggestion.asset.id ? 'In use' : 'Use this one'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 3. Drawing a new one. */}
      <h3 className="featured-image__subhead">Draw a new one</h3>

      {!state.canGenerate ? (
        <p className="form-error" role="alert">
          {state.generationIssue}{' '}
          <Link to="/settings/ai-providers">Assign a model with the Featured Image Generation capability</Link>.
        </p>
      ) : (
        <>
          <div className="featured-image__controls">
            <label className="wizard-field">
              How many
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} image{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>

            <label className="wizard-field featured-image__steer">
              Anything specific <span className="pipeline-muted">(optional)</span>
              <input
                value={steer}
                onChange={(e) => setSteer(e.target.value)}
                placeholder="e.g. early morning, cold light, no people"
              />
            </label>
          </div>

          {/* Said plainly rather than buried: this is what the constraint is
              and why, so nobody wonders why the picture has no product in it. */}
          <p className="pipeline-muted">
            Images are conceptual — a scene, a setting or an idea. Cynth will not draw a real product, a brand or a
            logo, because this article recommends things people actually buy and a drawn product would be a picture of
            something that does not exist. No text is rendered either; image models still misspell it.
          </p>

          <p className="pipeline-muted">
            Each image is charged separately, and the exact price is not known until the provider answers.
          </p>

          <div className="content-form__actions">
            <button type="button" className="button button--primary" disabled={busy} onClick={() => generate(false)}>
              {busy ? 'Drawing…' : `Generate ${count} image${count === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="button" onClick={showPrompt}>
              Show the prompt first
            </button>
          </div>

          {prompt && (
            <pre className="featured-image__prompt">{prompt}</pre>
          )}
        </>
      )}

      {state.candidates.length > 0 && (
        <>
          <h3 className="featured-image__subhead">Pick one</h3>
          <p className="pipeline-muted">
            These are not in the media library. Choosing one saves it and discards the rest.
          </p>
          <ul className="featured-image__grid">
            {state.candidates.map((candidate) => (
              <li key={candidate.id}>
                <img src={`/${candidate.url}`} alt="A generated candidate" />
                <button type="button" className="button button--primary" disabled={busy} onClick={() => choose(candidate.id)}>
                  Use this one
                </button>
              </li>
            ))}
          </ul>
          <div className="content-form__actions">
            <button type="button" className="button" disabled={busy} onClick={discard}>
              Discard all
            </button>
          </div>
        </>
      )}
    </section>
  );
}
