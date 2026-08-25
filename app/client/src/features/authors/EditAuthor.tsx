import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { AuthorForm } from './AuthorForm';
import { fetchAuthor, updateAuthor } from './api';
import type { AuthorDetail } from '../../shared/types/author';

export function EditAuthor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const authorId = Number(id);

  const [author, setAuthor] = useState<AuthorDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchAuthor(authorId)
      .then(setAuthor)
      .catch(() => setError('Author not found.'))
      .finally(() => setIsLoading(false));
  }, [authorId]);

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );
  }

  if (error || !author) {
    return (
      <div className="page">
        <PageHeader title="Author not found" description="This author may have been deleted." />
        <Link to="/authors">Back to Authors</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title={`Edit ${author.name}`} description="Update this author's profile. Writing samples are managed from the detail page." />
      <AuthorForm
        submitLabel="Save Changes"
        initialValues={{
          name: author.name,
          category: author.category ?? '',
          shortBiography: author.shortBiography ?? '',
          philosophy: author.philosophy ?? '',
          writingStyle: author.writingStyle ?? '',
          tone: author.tone ?? '',
          targetAudience: author.targetAudience ?? '',
          preferredExpressions: author.preferredExpressions ?? '',
          prohibitedExpressions: author.prohibitedExpressions ?? '',
          writingNotes: author.writingNotes ?? '',
          isActive: author.isActive,
        }}
        onSubmit={async (input) => {
          const updated = await updateAuthor(authorId, input);
          navigate(`/authors/${updated.id}`, { state: { flash: 'Changes saved.' } });
        }}
      />
    </div>
  );
}
