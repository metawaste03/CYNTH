import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../shared/services/apiClient';
import type { Theme } from '../../shared/types/content';
import { fetchAuthorThemes, fetchThemes, setAuthorThemes } from '../content/api';
import '../content/Content.css';

/**
 * The author's side of the author/theme relationship.
 *
 * The same many-to-many link is editable from a thematic area's own page;
 * this is the view from the other end, so coverage can be set up whichever
 * way round the user happens to be working. Nothing here enforces one theme
 * per author.
 */
export function AuthorThemes({ authorId }: { authorId: number }) {
  const [allThemes, setAllThemes] = useState<Theme[]>([]);
  const [assigned, setAssigned] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchThemes(), fetchAuthorThemes(authorId)])
      .then(([themes, mine]) => {
        setAllThemes(themes);
        setAssigned(new Set(mine.map((t) => t.id)));
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load thematic areas.'))
      .finally(() => setIsLoading(false));
  }, [authorId]);

  async function toggle(themeId: number, checked: boolean) {
    const next = new Set(assigned);
    if (checked) next.add(themeId);
    else next.delete(themeId);

    setAssigned(next);
    setIsSaving(true);
    setError(null);
    try {
      await setAuthorThemes(authorId, [...next]);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not save thematic areas.');
      setAssigned(assigned); // revert to what the server still believes
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <p>Loading thematic areas…</p>;

  return (
    <>
      <p className="content-hint">
        Which content areas this author writes for. An author can cover several areas, and an area can have several
        authors. Leave every box unticked to make this author available to all areas.
        {isSaving && ' Saving…'}
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {allThemes.length === 0 ? (
        <p className="article-list__empty">
          No thematic areas yet. <Link to="/content/themes">Create one</Link> to assign this author to it.
        </p>
      ) : (
        <ul className="content-checklist">
          {allThemes.map((theme) => (
            <li key={theme.id}>
              <label>
                <input
                  type="checkbox"
                  checked={assigned.has(theme.id)}
                  onChange={(e) => toggle(theme.id, e.target.checked)}
                />
                {theme.name}
                {!theme.isActive && <span className="content-list__badge">Inactive</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
