import { useState } from 'react';
import { ApiError } from '../../shared/services/apiClient';
import { deleteArticle, fetchDeletionPreflight } from './api';
import type { DeletionPreflight } from './api';
import './ArticleList.css';

/**
 * Deleting a draft.
 *
 * Deletion is irreversible and Cynth has no undo, so the flow is: ask what
 * would happen, show it, and only then destroy anything. The user sees what
 * goes and what survives before they confirm — never a bare "are you sure?".
 *
 * The one blocker is a CMS link, and it is overridable rather than absolute:
 * Cynth cannot delete a remote post, but "I already deleted it in WordPress"
 * is a real situation only the user can know about.
 */
interface DeleteArticleButtonProps {
  articleId: number;
  title: string;
  onDeleted: () => void;
  className?: string;
  label?: string;
}

export function DeleteArticleButton({
  articleId,
  title,
  onDeleted,
  className = 'button button--danger',
  label = 'Delete',
}: DeleteArticleButtonProps) {
  const [preflight, setPreflight] = useState<DeletionPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      setPreflight(await fetchDeletionPreflight(articleId));
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not check this draft.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      await deleteArticle(articleId, force);
      setPreflight(null);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not delete this draft.');
    } finally {
      setBusy(false);
    }
  }

  if (!preflight) {
    return (
      <>
        <button type="button" className={className} disabled={busy} onClick={open}>
          {busy ? 'Checking…' : label}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="delete-confirm" role="dialog" aria-label={`Delete ${title}`}>
      <p className="delete-confirm__title">
        Delete <strong>{preflight.title || title}</strong>?
      </p>

      {preflight.blockers.map((blocker) => (
        <p key={blocker} className="form-error" role="alert">
          {blocker}
        </p>
      ))}

      {preflight.warnings.map((warning) => (
        <p key={warning} className="delete-confirm__warning">
          {warning}
        </p>
      ))}

      <div className="delete-confirm__columns">
        <div>
          <h4>This removes</h4>
          <ul>
            {preflight.removes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>This keeps</h4>
          <ul>
            {preflight.keeps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="delete-confirm__final">This cannot be undone.</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="delete-confirm__actions">
        <button type="button" className="button" disabled={busy} onClick={() => setPreflight(null)}>
          Cancel
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={busy}
          onClick={() => confirm(!preflight.canDelete)}
        >
          {busy
            ? 'Deleting…'
            : preflight.canDelete
              ? 'Delete permanently'
              : 'Delete anyway, and break the CMS link'}
        </button>
      </div>
    </div>
  );
}
