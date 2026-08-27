import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { AuthorThemes } from './AuthorThemes';
import {
  fetchAuthor,
  deleteAuthor,
  setAuthorStatus,
  addWritingSample,
  updateWritingSample,
  deleteWritingSample,
} from './api';
import type { AuthorDetail as AuthorDetailType, WritingSample } from '../../shared/types/author';
import { ApiError } from '../../shared/services/apiClient';
import './AuthorDetail.css';

interface SampleDraft {
  title: string;
  notes: string;
  fullText: string;
}

const EMPTY_DRAFT: SampleDraft = { title: '', notes: '', fullText: '' };

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="author-detail__field">
      <dt>{label}</dt>
      <dd>{value?.trim() ? value : <span className="author-detail__empty">Not set</span>}</dd>
    </div>
  );
}

export function AuthorDetail() {
  const { id } = useParams();
  const authorId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();

  const [author, setAuthor] = useState<AuthorDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const [isAddingSample, setIsAddingSample] = useState(false);
  const [sampleDraft, setSampleDraft] = useState<SampleDraft>(EMPTY_DRAFT);
  const [editingSampleId, setEditingSampleId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<SampleDraft>(EMPTY_DRAFT);

  useEffect(() => {
    setIsLoading(true);
    fetchAuthor(authorId)
      .then(setAuthor)
      .catch(() => setError('Author not found.'))
      .finally(() => setIsLoading(false));
  }, [authorId]);

  async function handleToggleStatus() {
    if (!author) return;
    const updated = await setAuthorStatus(author.id, !author.isActive);
    setAuthor(updated);
  }

  async function handleDelete() {
    if (!author) return;
    if (!window.confirm(`Delete ${author.name}? This also deletes their writing samples.`)) return;
    await deleteAuthor(author.id);
    navigate('/authors', { state: { flash: `${author.name} was deleted.` } });
  }

  async function handleAddSample(event: FormEvent) {
    event.preventDefault();
    setSampleError(null);
    if (!sampleDraft.title.trim() || !sampleDraft.fullText.trim()) {
      setSampleError('Title and full text are required.');
      return;
    }
    try {
      const sample = await addWritingSample(authorId, sampleDraft);
      setAuthor((prev) => (prev ? { ...prev, writingSamples: [...prev.writingSamples, sample] } : prev));
      setSampleDraft(EMPTY_DRAFT);
      setIsAddingSample(false);
    } catch (err) {
      setSampleError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to add sample.');
    }
  }

  function startEditSample(sample: WritingSample) {
    setEditingSampleId(sample.id);
    setEditDraft({ title: sample.title, notes: sample.notes ?? '', fullText: sample.fullText ?? '' });
    setSampleError(null);
  }

  async function handleSaveSample(sampleId: number) {
    if (!editDraft.title.trim() || !editDraft.fullText.trim()) {
      setSampleError('Title and full text are required.');
      return;
    }
    try {
      const updated = await updateWritingSample(authorId, sampleId, editDraft);
      setAuthor((prev) =>
        prev
          ? { ...prev, writingSamples: prev.writingSamples.map((sample) => (sample.id === sampleId ? updated : sample)) }
          : prev,
      );
      setEditingSampleId(null);
    } catch (err) {
      setSampleError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to save sample.');
    }
  }

  async function handleDeleteSample(sampleId: number) {
    if (!window.confirm('Delete this writing sample?')) return;
    await deleteWritingSample(authorId, sampleId);
    setAuthor((prev) => (prev ? { ...prev, writingSamples: prev.writingSamples.filter((s) => s.id !== sampleId) } : prev));
  }

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
      {flash && (
        <div className="flash-banner" role="status">
          {flash}
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="author-detail__header">
        <PageHeader title={author.name} description={author.category || 'No category set'} />
        <div className="author-detail__actions">
          <span className={`status-badge ${author.isActive ? 'is-active' : 'is-inactive'}`}>
            {author.isActive ? 'Active' : 'Inactive'}
          </span>
          <button type="button" className="button" onClick={handleToggleStatus}>
            {author.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <Link to={`/authors/${author.id}/edit`} className="button">
            Edit
          </Link>
          <button type="button" className="button button--danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      <section className="author-detail__section">
        <h2>General</h2>
        <dl>
          <Field label="Short Biography" value={author.shortBiography} />
        </dl>
      </section>

      <section className="author-detail__section">
        <h2>Editorial</h2>
        <dl>
          <Field label="Philosophy" value={author.philosophy} />
          <Field label="Writing Style" value={author.writingStyle} />
          <Field label="Tone" value={author.tone} />
          <Field label="Target Audience" value={author.targetAudience} />
        </dl>
      </section>

      <section className="author-detail__section">
        <h2>Persona</h2>
        <p className="content-hint">
          The editorial identity the model writes as. Everything here is sent as generation guidance.
        </p>
        <dl>
          <Field label="Expertise" value={author.expertise} />
          <Field label="Perspective" value={author.perspective} />
          <Field label="Editorial Principles" value={author.editorialPrinciples} />
          <Field label="Boundaries" value={author.boundaries} />
        </dl>
      </section>

      <section className="author-detail__section">
        <h2>Thematic Areas</h2>
        <AuthorThemes authorId={author.id} />
      </section>

      <section className="author-detail__section">
        <h2>AI Guidance</h2>
        <dl>
          <Field label="Preferred Recurring Expressions" value={author.preferredExpressions} />
          <Field label="Prohibited Expressions" value={author.prohibitedExpressions} />
          <Field label="Writing Notes" value={author.writingNotes} />
        </dl>
      </section>

      <section className="author-detail__section">
        <div className="author-detail__samples-header">
          <h2>Writing Samples</h2>
          <button
            type="button"
            className="button"
            onClick={() => {
              setIsAddingSample((v) => !v);
              setSampleError(null);
            }}
          >
            {isAddingSample ? 'Cancel' : 'Add Sample'}
          </button>
        </div>

        {sampleError && (
          <p className="form-error" role="alert">
            {sampleError}
          </p>
        )}

        {isAddingSample && (
          <form className="author-form author-detail__sample-form" onSubmit={handleAddSample}>
            <label>
              Title
              <input value={sampleDraft.title} onChange={(e) => setSampleDraft((d) => ({ ...d, title: e.target.value }))} />
            </label>
            <label>
              Notes
              <input value={sampleDraft.notes} onChange={(e) => setSampleDraft((d) => ({ ...d, notes: e.target.value }))} />
            </label>
            <label>
              Full Text
              <textarea
                rows={4}
                value={sampleDraft.fullText}
                onChange={(e) => setSampleDraft((d) => ({ ...d, fullText: e.target.value }))}
              />
            </label>
            <div className="author-form__actions">
              <button type="submit" className="button button--primary">
                Save Sample
              </button>
            </div>
          </form>
        )}

        {author.writingSamples.length === 0 ? (
          <p>No writing samples yet.</p>
        ) : (
          <ul className="author-detail__samples">
            {author.writingSamples.map((sample) => (
              <li key={sample.id} className="author-detail__sample">
                {editingSampleId === sample.id ? (
                  <div className="author-form author-detail__sample-form">
                    <label>
                      Title
                      <input value={editDraft.title} onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))} />
                    </label>
                    <label>
                      Notes
                      <input value={editDraft.notes} onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))} />
                    </label>
                    <label>
                      Full Text
                      <textarea
                        rows={4}
                        value={editDraft.fullText}
                        onChange={(e) => setEditDraft((d) => ({ ...d, fullText: e.target.value }))}
                      />
                    </label>
                    <div className="author-form__actions">
                      <button type="button" className="button button--primary" onClick={() => handleSaveSample(sample.id)}>
                        Save
                      </button>
                      <button type="button" className="button" onClick={() => setEditingSampleId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="author-detail__sample-header">
                      <h3>{sample.title}</h3>
                      <div className="author-detail__sample-actions">
                        <button type="button" className="button" onClick={() => startEditSample(sample)}>
                          Edit
                        </button>
                        <button type="button" className="button button--danger" onClick={() => handleDeleteSample(sample.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                    {sample.notes && <p className="author-detail__sample-notes">{sample.notes}</p>}
                    <p className="author-detail__sample-text">{sample.fullText}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
