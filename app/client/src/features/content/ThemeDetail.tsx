import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { Theme, ThemeAuthor, Topic } from '../../shared/types/content';
import type { Author } from '../../shared/types/author';
import { fetchAuthors } from '../authors/api';
import { createTopic, deleteTopic, fetchTheme, setAuthorThemes, updateTheme, updateTopic } from './api';
import { TopicForm } from './TopicForm';
import './Content.css';

/**
 * Everything about one thematic area: its own details, the topics it covers,
 * and which authors write for it.
 *
 * Author coverage is many-to-many on purpose — assigning an author here does
 * not remove them from anywhere else, and a theme can have as many authors as
 * the project wants.
 */
export function ThemeDetail() {
  const { id } = useParams<{ id: string }>();
  const themeId = Number(id);

  const [theme, setTheme] = useState<Theme | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [themeAuthors, setThemeAuthors] = useState<ThemeAuthor[]>([]);
  const [allAuthors, setAllAuthors] = useState<Author[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [isAddingTopic, setIsAddingTopic] = useState(false);

  const load = useCallback(() => {
    if (!Number.isInteger(themeId) || themeId <= 0) {
      setError('Invalid thematic area id.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    Promise.all([fetchTheme(themeId), fetchAuthors()])
      .then(([detail, authors]) => {
        setTheme(detail.theme);
        setTopics(detail.topics);
        setThemeAuthors(detail.authors);
        setAllAuthors(authors);
        setName(detail.theme.name);
        setDescription(detail.theme.description ?? '');
        setIsActive(detail.theme.isActive);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load this thematic area.'))
      .finally(() => setIsLoading(false));
  }, [themeId]);

  useEffect(load, [load]);

  async function saveTheme(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setNotice(null);
    try {
      await updateTheme(themeId, { name: name.trim(), description: description.trim() || undefined, isActive });
      setNotice('Thematic area saved.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not save the thematic area.');
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Assigning an author replaces that author's full theme set, so this reads
   * their current areas first and adds or removes only this one.
   */
  async function toggleAuthor(author: Author, assigned: boolean) {
    setNotice(null);
    try {
      const { fetchAuthorThemes } = await import('./api');
      const current = await fetchAuthorThemes(author.id);
      const ids = current.map((t) => t.id).filter((tid) => tid !== themeId);
      if (assigned) ids.push(themeId);

      await setAuthorThemes(author.id, ids);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not update author coverage.');
    }
  }

  async function removeTopic(topic: Topic) {
    if (!window.confirm(`Remove the topic "${topic.title}"? This cannot be undone.`)) return;
    try {
      await deleteTopic(topic.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not remove the topic.');
    }
  }

  if (isLoading) return <p>Loading thematic area…</p>;

  if (error && !theme) {
    return (
      <div className="page">
        <p className="form-error" role="alert">
          {error}
        </p>
        <p>
          <Link to="/content/themes">Back to Thematic Areas</Link>
        </p>
      </div>
    );
  }

  if (!theme) return null;

  const assignedIds = new Set(themeAuthors.map((a) => a.id));

  return (
    <div className="page">
      <PageHeader title={theme.name} description="Manage this thematic area, its topics, and the authors who write for it." />

      <p className="content-scope">
        <Link to="/content/themes">← Back to Thematic Areas</Link>
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      {/* ---------------------------------------------------------- details */}
      <section className="content-section">
        <h2>Details</h2>
        <form className="content-form" onSubmit={saveTheme}>
          <label>
            Name <span aria-hidden="true">*</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Description
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this area covers. Optional — used as guidance during generation."
            />
          </label>
          <label className="content-form__checkbox">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
          <div>
            <button type="submit" className="button button--primary" disabled={isSaving || !name.trim()}>
              {isSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>

      {/* ----------------------------------------------------------- topics */}
      <section className="content-section">
        <div className="content-section__head">
          <h2>Topics ({topics.length})</h2>
          {!isAddingTopic && !editingTopic && (
            <button type="button" className="button button--primary" onClick={() => setIsAddingTopic(true)}>
              Add topic
            </button>
          )}
        </div>

        <p className="content-hint">
          A topic is more than a label: what you write here becomes part of the instructions sent to the model.
        </p>

        {isAddingTopic && (
          <TopicForm
            submitLabel="Add topic"
            onCancel={() => setIsAddingTopic(false)}
            onSubmit={async (values) => {
              await createTopic({ ...values, themeId });
              setIsAddingTopic(false);
              load();
            }}
          />
        )}

        {editingTopic && (
          <TopicForm
            initial={editingTopic}
            submitLabel="Save topic"
            onCancel={() => setEditingTopic(null)}
            onSubmit={async (values) => {
              await updateTopic(editingTopic.id, values);
              setEditingTopic(null);
              load();
            }}
          />
        )}

        {topics.length === 0 ? (
          <p className="article-list__empty">No topics yet. Add the first one — Cynth does not invent topics for you.</p>
        ) : (
          <ul className="content-list">
            {topics.map((topic) => (
              <li key={topic.id} className={topic.isActive ? undefined : 'is-inactive'}>
                <div>
                  <strong>{topic.title}</strong>
                  {!topic.isActive && <span className="content-list__badge">Inactive</span>}
                  {topic.description && <p className="content-list__desc">{topic.description}</p>}
                  <p className="content-list__meta">
                    {[
                      topic.scope && 'scope',
                      topic.keyAreas && 'key areas',
                      topic.considerations && 'considerations',
                      topic.exclusions && 'exclusions',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No editorial guidance yet'}
                  </p>
                </div>
                <div className="content-list__actions">
                  <button type="button" className="button" onClick={() => setEditingTopic(topic)}>
                    Edit
                  </button>
                  <button type="button" className="button" onClick={() => removeTopic(topic)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------- authors */}
      <section className="content-section">
        <h2>Authors ({themeAuthors.length})</h2>
        <p className="content-hint">
          Tick every author who writes for this area. An author can cover several areas, and an area can have several
          authors — nothing here is one-to-one.
        </p>

        {allAuthors.length === 0 ? (
          <p className="article-list__empty">
            No authors yet. <Link to="/authors/new">Create one</Link> to assign it here.
          </p>
        ) : (
          <ul className="content-checklist">
            {allAuthors.map((author) => (
              <li key={author.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={assignedIds.has(author.id)}
                    onChange={(e) => toggleAuthor(author, e.target.checked)}
                  />
                  {author.name}
                  {!author.isActive && <span className="content-list__badge">Inactive</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
