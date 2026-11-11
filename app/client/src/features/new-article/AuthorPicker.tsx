import { useEffect, useState } from 'react';
import { fetchAuthors } from '../authors/api';
import type { Author } from '../../shared/types/author';
import { ApiError } from '../../shared/services/apiClient';

interface AuthorPickerProps {
  selectedAuthorId: number | null;
  onSelect: (authorId: number) => void;
  /**
   * Restricts the list to authors who cover the selected thematic area.
   *
   * Null means no thematic area is chosen yet, so every active author is
   * offered. This is a convenience only — the backend independently rejects
   * an author who is not assigned to the chosen area.
   */
  allowedAuthorIds?: number[] | null;
}

/** Selection list only — active authors, one at a time. Read-only detail display is a sibling in NewArticle.tsx. */
export function AuthorPicker({ selectedAuthorId, onSelect, allowedAuthorIds = null }: AuthorPickerProps) {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthors({ status: 'active' })
      .then(setAuthors)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load authors.'))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <p>Loading authors…</p>;
  if (error) {
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  }
  // An author with no thematic areas assigned is treated as available
  // everywhere, matching the backend rule — configuring coverage stays
  // optional rather than becoming a precondition for writing.
  const visible = allowedAuthorIds === null ? authors : authors.filter((a) => allowedAuthorIds.includes(a.id));

  if (authors.length === 0) {
    return <p>No active authors yet. Create one from the Authors page first.</p>;
  }
  if (visible.length === 0) {
    return (
      <p className="form-error" role="alert">
        No authors are assigned to this thematic area yet. Assign one from Thematic Areas, or pick a different area.
      </p>
    );
  }

  return (
    <div className="option-list" role="radiogroup" aria-label="Author">
      {visible.map((author) => (
        <label key={author.id} className={`option-list__item${selectedAuthorId === author.id ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name="author"
            checked={selectedAuthorId === author.id}
            onChange={() => onSelect(author.id)}
          />
          <span className="option-list__name">{author.name}</span>
          {author.category && <span className="option-list__meta">{author.category}</span>}
        </label>
      ))}
    </div>
  );
}
