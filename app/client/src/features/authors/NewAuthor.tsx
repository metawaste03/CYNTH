import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { AuthorForm } from './AuthorForm';
import { createAuthor } from './api';

export function NewAuthor() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <PageHeader title="New Author" description="Create a new author identity for Cynth to keep consistent." />
      <AuthorForm
        submitLabel="Create Author"
        showSamplesEditor
        onSubmit={async (input) => {
          const author = await createAuthor(input);
          navigate(`/authors/${author.id}`, { state: { flash: `${author.name} was created.` } });
        }}
      />
    </div>
  );
}
