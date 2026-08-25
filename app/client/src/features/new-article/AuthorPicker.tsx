import { useEffect, useState } from 'react';
import { fetchAuthors } from '../authors/api';
import type { Author } from '../../shared/types/author';
import { ApiError } from '../../shared/services/apiClient';

interface AuthorPickerProps {
  selectedAuthorId: number | null;
  onSelect: (authorId: number) => void;
}

/** Selection list only — active authors, one at a time. Read-only detail display is a sibling in NewArticle.tsx. */
export function AuthorPicker({ selectedAuthorId, onSelect }: AuthorPickerProps) {
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
  if (authors.length === 0) {
    return <p>No active authors yet. Create one from the Authors page first.</p>;
  }

  return (
    <div className="option-list" role="radiogroup" aria-label="Author">
      {authors.map((author) => (
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
