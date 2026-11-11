import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { Project, Theme } from '../../shared/types/content';
import { createTheme, fetchProjects, fetchThemes, setThemeActive } from './api';
import './Content.css';

/**
 * Manage the project's thematic areas.
 *
 * Deliberately generic: this screen has no idea what the areas are called or
 * how many there should be. EveryFiveDays' five are simply the rows that
 * happen to exist — add a sixth here and nothing in the engine changes.
 */
export function ThemesPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetchProjects()
      .then((r) => {
        setProject(r.default);
        return fetchThemes(r.default ? { projectId: r.default.id } : {});
      })
      .then((loaded) => {
        setThemes(loaded);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load thematic areas.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;

    setIsCreating(true);
    setFormError(null);
    try {
      await createTheme({ name: newName.trim(), description: newDescription.trim() || undefined });
      setNewName('');
      setNewDescription('');
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.errors.join(' ') : 'Could not add the thematic area.');
    } finally {
      setIsCreating(false);
    }
  }

  async function toggleActive(theme: Theme) {
    try {
      const updated = await setThemeActive(theme.id, !theme.isActive);
      setThemes((current) => current.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not change the status.');
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Thematic Areas"
        description="The content areas this project writes about. Add, rename or retire them at any time — nothing here is fixed."
      />

      {project && (
        <p className="content-scope">
          Project: <strong>{project.name}</strong>
        </p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <form className="content-inline-form" onSubmit={handleCreate}>
        <h2>Add a thematic area</h2>
        <div className="content-inline-form__row">
          <label>
            Name <span aria-hidden="true">*</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Sleep &amp; Recovery" required />
          </label>
          <label>
            Description (optional)
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What this area covers"
            />
          </label>
          <button type="submit" className="button button--primary" disabled={isCreating || !newName.trim()}>
            {isCreating ? 'Adding…' : 'Add'}
          </button>
        </div>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
      </form>

      {isLoading ? (
        <p>Loading thematic areas…</p>
      ) : themes.length === 0 ? (
        <p className="article-list__empty">
          No thematic areas yet. Add the first one above — Cynth does not assume any particular set.
        </p>
      ) : (
        <>
          <p className="page__count">
            {themes.length} {themes.length === 1 ? 'thematic area' : 'thematic areas'}
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Topics</th>
                <th>Authors</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {themes.map((theme) => (
                <tr key={theme.id} className={theme.isActive ? undefined : 'is-inactive'}>
                  <td>
                    <Link to={`/content/themes/${theme.id}`}>{theme.name}</Link>
                    {theme.description && <span className="data-table__sub">{theme.description}</span>}
                  </td>
                  <td>{theme.topicCount}</td>
                  <td>{theme.authorCount}</td>
                  <td>
                    <span className={`article-status article-status--${theme.isActive ? 'published' : 'draft'}`}>
                      {theme.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="data-table__actions">
                    <button type="button" className="button" onClick={() => toggleActive(theme)}>
                      {theme.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <Link to={`/content/themes/${theme.id}`} className="button">
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
