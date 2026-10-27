import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../shared/services/apiClient';
import { attachMedia } from '../media/api';
import type { ImageStyle, SelectableImageModel } from './api';
import {
  discardCandidates,
  fetchFeaturedImage,
  fetchImageModels,
  fetchImagePrompt,
  generateFeaturedImages,
  pushFeaturedImageToCms,
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
  // One by default: some image models (Seedream among them) return a single
  // image per request whatever this says, and now that the scene is chosen
  // upstream, extra candidates are the same scene redrawn rather than a
  // different idea. More is still offered, it is just not assumed.
  const [count, setCount] = useState(1);
  const [steer, setSteer] = useState('');
  // A photograph suits nearly every article. An illustration is for the ideas a
  // camera cannot see: what somebody is weighing up, a comparison, a cost over
  // time. Asking for one of those as a photograph produces a composite.
  const [style, setStyle] = useState<ImageStyle>('photograph');
  const [models, setModels] = useState<SelectableImageModel[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  /**
   * Whether to let lettering into the frame.
   *
   * Off by default, and that default is about the MODEL rather than the
   * article: every image model Cynth has used garbles text, which is why the
   * art director bans books facing the camera, labels, packaging and signage.
   * On a model that can spell, the ban costs most of the scenes a product
   * publication would naturally shoot.
   */
  const [allowText, setAllowText] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  /**
   * The scene behind the previewed prompt.
   *
   * Previewing and drawing used to be two separate runs of the art director,
   * so the scene an editor read was never the one drawn — which made "try
   * again" a four-cent lottery on any article without an obvious image. Held
   * here so the picture drawn is the picture approved.
   */
  const [scene, setScene] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchFeaturedImage(articleId)
      .then(setState)
      .catch(() => setError('Could not load the featured image.'));
  }, [articleId]);

  useEffect(load, [load]);

  // Failing to load the list leaves the assigned model in charge, which is
  // what happened before there was a choice at all.
  useEffect(() => {
    fetchImageModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  async function generate(confirmedCost: boolean, useScene = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await generateFeaturedImages(articleId, {
        count,
        steer: steer.trim() || null,
        style,
        scene: useScene ? scene : null,
        modelId,
        allowText,
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
          return generate(true, useScene);
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

  /**
   * Sends the attached image to the CMS post on its own.
   *
   * Separate from the article push because it is allowed where that is not:
   * on a published post. An image chosen after publication previously had no
   * route to the live article at all.
   */
  async function sendToCms() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await pushFeaturedImageToCms(articleId);
      setNotice(response.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'The image could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function showPrompt() {
    try {
      const brief = await fetchImagePrompt(articleId, steer.trim() || undefined, style);
      setPrompt(brief.prompt);
      setScene(brief.basis?.scene ?? null);
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
            {/* Attaching an image in Cynth does not put it on the site. For an
                article pushed before its image was chosen, this is the only
                way the picture reaches the live post. */}
            <button type="button" className="button" disabled={busy} onClick={sendToCms}>
              Send this image to the site
            </button>
            <p className="pipeline-muted">
              Safe on a published article — it attaches the image and changes nothing else.
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

            {models.length > 1 && (
              <label className="wizard-field">
                Model
                <select
                  value={modelId ?? ''}
                  onChange={(e) => setModelId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">
                    {models.find((m) => m.assignedCapabilities.some((c) => c.isDefaultForPurpose))?.displayName ??
                      'Assigned model'}{' '}
                    (assigned)
                  </option>
                  {models
                    .filter((m) => !m.assignedCapabilities.some((c) => c.isDefaultForPurpose))
                    .map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.displayName ?? m.modelName}
                      </option>
                    ))}
                </select>
              </label>
            )}

            <label className="wizard-field">
              Style
              <select value={style} onChange={(e) => setStyle(e.target.value as ImageStyle)}>
                <option value="photograph">Photograph</option>
                <option value="illustration">Illustration</option>
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
          <label className="wizard-field featured-image__steer">
            <input type="checkbox" checked={allowText} onChange={(e) => setAllowText(e.target.checked)} /> Allow words
            in the image
          </label>
          <p className="pipeline-muted">
            Leave this off unless the chosen model renders text cleanly. Most image models misspell it, which is why
            Cynth otherwise keeps book spines turned away and labels out of shot.
          </p>

          <p className="pipeline-muted">
            Pick <strong>Illustration</strong> for anything a camera cannot see — what someone is weighing up, two
            options compared, a cost adding up. Asked for as a photograph, those come back as a real room with a
            drawing pasted into it.
          </p>

          <p className="pipeline-muted">
            Images are conceptual — a scene, a setting or an idea. Cynth will not draw a real product, a brand or a
            logo, because this article recommends things people actually buy and a drawn product would be a picture of
            something that does not exist. No text is rendered either; image models still misspell it.
          </p>

          <p className="pipeline-muted">
            Each image is charged separately, and the exact price is not known until the provider answers. Some models
            return one image per request however many you ask for — you are only charged for what comes back.
          </p>

          <div className="content-form__actions">
            <button type="button" className="button button--primary" disabled={busy} onClick={() => generate(false)}>
              {busy ? 'Drawing…' : `Generate ${count} image${count === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="button" onClick={showPrompt}>
              Suggest a scene (free)
            </button>
          </div>

          {prompt && (
            <>
              <pre className="featured-image__prompt">{prompt}</pre>
              {/* Suggesting costs nothing, so an editor can keep asking until
                  the scene is right and pay only once — rather than paying per
                  attempt and hoping. */}
              <div className="content-form__actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy || !scene}
                  onClick={() => generate(false, true)}
                >
                  {busy ? 'Drawing…' : 'Draw this scene'}
                </button>
                <button type="button" className="button" disabled={busy} onClick={showPrompt}>
                  Suggest another
                </button>
              </div>
            </>
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

      {/* The batch before this one. Generating again used to delete it
          outright, which was fine when a batch meant three versions of one
          idea and wrong once each generation became a different idea an
          editor had paid for. */}
      {state.superseded.length > 0 && (
        <>
          <h3 className="featured-image__subhead">Previous suggestion</h3>
          <p className="pipeline-muted">
            Kept so you can compare. It goes when you generate again, or when you discard.
          </p>
          <ul className="featured-image__grid">
            {state.superseded.map((candidate) => (
              <li key={candidate.id}>
                <img src={`/${candidate.url}`} alt="The previous generated candidate" />
                <button type="button" className="button" disabled={busy} onClick={() => choose(candidate.id)}>
                  Use this one instead
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
