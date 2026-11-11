import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { api, ApiError } from '../../shared/services/apiClient';
import '../content/Content.css';

/**
 * EDITORIAL DEFAULTS.
 *
 * One setting so far: how long an article may be. It belongs here rather than
 * on the Generate Article screen because it is a publication-wide standard,
 * not a per-run choice — and because three separate things read it (the
 * writer, the reviewer, and final validation), so there is exactly one place
 * it can be changed.
 */

interface ArticleLength {
  maxWords: number;
  default: number;
  min: number;
  max: number;
}

export function EditorialSettings() {
  const [limits, setLimits] = useState<ArticleLength | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ArticleLength>('/generation/article-length')
      .then((loaded) => {
        setLimits(loaded);
        setValue(String(loaded.maxWords));
      })
      .catch(() => setError('Could not load the editorial defaults.'));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api.put<ArticleLength>('/generation/article-length', { maxWords: Number(value) });
      setLimits(saved);
      setValue(String(saved.maxWords));
      setNotice(`Articles are now capped at ${saved.maxWords} words.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  if (!limits) {
    return (
      <div className="page">
        <PageHeader title="Editorial" description="Publication-wide editorial standards." />
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p>Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Editorial"
        description="Publication-wide standards. These apply to every article Cynth writes, in every thematic area."
      />

      <p className="article-view__back">
        <Link to="/settings">← Back to Settings</Link>
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      <form className="content-section" onSubmit={save}>
        <h2>Article length</h2>

        <p className="content-hint">
          EveryFiveDays is short-form. This is a <strong>ceiling</strong>, not a target — the writer is told to cover
          the subject properly within it rather than padding to fill it.
        </p>

        <label className="wizard-field">
          Maximum words per article
          <input
            type="number"
            min={limits.min}
            max={limits.max}
            step={50}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>

        <p className="pipeline-muted">
          Between {limits.min} and {limits.max}. The default is {limits.default}.
        </p>

        {/* Said plainly, because the interaction between the two limits is the
            thing most likely to surprise: a template can be shorter than this,
            never longer. */}
        <p className="pipeline-muted">
          Each article type also has its own range, and the shorter of the two always wins. A review is capped at 1,300
          words and a buying guide at 1,500, so lowering this figure shortens everything, while raising it above 1,500
          changes nothing on its own.
        </p>

        <p className="pipeline-muted">
          Three things read this: the model that writes the article, the model that reviews it, and the final
          validation check. An article that runs over is reported rather than cut — Cynth never truncates an argument
          to meet a number.
        </p>

        <div className="content-form__actions">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {limits.maxWords !== limits.default && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setValue(String(limits.default))}
            >
              Reset to {limits.default}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
