import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { Author } from '../../shared/types/author';
import type {
  AuthorSkillScope,
  AuthorSkillSummary,
  LibraryImportReport,
  LibraryListing,
} from '../../shared/types/authorSkill';
import { fetchAuthors } from '../authors/api';
import { SkillEditor } from './SkillEditor';
import {
  assignAuthorSkill,
  deleteAuthorSkill,
  exportAuthorSkill,
  fetchSkillLibrary,
  fetchAuthorSkills,
  importSkillFile,
  importSkillLibrary,
  setAuthorSkillStatus,
} from './api';
import '../content/Content.css';
import './AuthorSkills.css';

/**
 * Author skill management.
 *
 * Two halves, and the distinction between them is the point: the table is what
 * Cynth uses when it generates, and the folder listing is where documents come
 * from and go back to. The database is authoritative — a file sitting in the
 * folder affects nothing until it is imported.
 *
 * Like every other content screen, this knows nothing about how many skills
 * there should be or what they are called.
 */
export function AuthorSkillsPage() {
  const [skills, setSkills] = useState<AuthorSkillSummary[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [library, setLibrary] = useState<LibraryListing | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<LibraryImportReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** The skill open in the editor: a number to edit, 'new' to create, null for neither. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  function load() {
    setIsLoading(true);
    Promise.all([fetchAuthorSkills(), fetchAuthors(), fetchSkillLibrary()])
      .then(([loadedSkills, loadedAuthors, loadedLibrary]) => {
        setSkills(loadedSkills);
        setAuthors(loadedAuthors);
        setLibrary(loadedLibrary);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load author skills.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  function announce(message: string) {
    setNotice(message);
    setError(null);
  }

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.errors.join(' ') : fallback);
    setNotice(null);
  }

  async function handleAssign(skillId: number, raw: string) {
    setBusy(`assign-${skillId}`);
    try {
      await assignAuthorSkill(skillId, raw ? Number(raw) : null);
      load();
      announce('Assignment saved.');
    } catch (err) {
      fail(err, 'Could not change the assignment.');
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleStatus(skill: AuthorSkillSummary) {
    setBusy(`status-${skill.id}`);
    try {
      await setAuthorSkillStatus(skill.id, !skill.isActive);
      load();
      announce(
        skill.isActive
          ? `"${skill.name}" is inactive — it will not be sent to the model.`
          : `"${skill.name}" is active and will be sent with every article it applies to.`,
      );
    } catch (err) {
      fail(err, 'Could not change the status.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(skill: AuthorSkillSummary) {
    if (!window.confirm(`Delete the skill "${skill.name}"? The file in the Author folder is not touched.`)) return;

    setBusy(`delete-${skill.id}`);
    try {
      await deleteAuthorSkill(skill.id);
      load();
      announce(`"${skill.name}" was deleted.`);
    } catch (err) {
      fail(err, 'Could not delete the skill.');
    } finally {
      setBusy(null);
    }
  }

  async function handleExport(skill: AuthorSkillSummary) {
    setBusy(`export-${skill.id}`);
    try {
      const result = await exportAuthorSkill(skill.id);
      load();
      announce(`Written to ${result.filename} in the Author folder.`);
    } catch (err) {
      fail(err, 'Could not write the skill to the Author folder.');
    } finally {
      setBusy(null);
    }
  }

  async function handleImportFile(filename: string) {
    setBusy(`import-${filename}`);
    try {
      const result = await importSkillFile(filename);
      load();
      announce(
        result.updated
          ? `${filename} was re-imported — the existing skill now matches the file.`
          : `${filename} was imported. Assign it to an author to bring it into generation.`,
      );
    } catch (err) {
      fail(err, `Could not import ${filename}.`);
    } finally {
      setBusy(null);
    }
  }

  async function handleImportAll() {
    setBusy('import-all');
    try {
      const result = await importSkillLibrary();
      setReport(result);
      load();
      announce('Import finished — see the report below for what was created and linked.');
    } catch (err) {
      fail(err, 'Could not import the Author folder.');
    } finally {
      setBusy(null);
    }
  }

  function describeScope(scope: AuthorSkillScope) {
    return scope === 'shared' ? 'Shared — every author' : 'Author';
  }

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading author skills…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Author Skills"
        description="The authoring documents that define how each author writes. A skill is sent to the model exactly as written, alongside the author's own fields."
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      {editing !== null && (
        <SkillEditor
          skillId={editing === 'new' ? null : editing}
          authors={authors}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            load();
            announce(message);
          }}
        />
      )}

      <section className="content-section">
        <div className="content-section__head">
          <h2>Skills</h2>
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add Skill
          </button>
        </div>

        <p className="content-hint">
          A skill scoped to an <strong>author</strong> is used whenever that author writes. A <strong>shared</strong>{' '}
          skill is used for every author. An inactive skill is stored but never sent to the model.
        </p>

        {skills.length === 0 ? (
          <p className="article-list__empty">
            No skills yet. Add one here, or import the documents in the Author folder below.
          </p>
        ) : (
          <div className="skill-table__scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Scope</th>
                <th>Author</th>
                <th>Thematic Areas</th>
                <th>Size</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id} className={skill.isActive ? undefined : 'is-inactive'}>
                  <td>
                    <button type="button" className="skill-table__name" onClick={() => setEditing(skill.id)}>
                      {skill.name}
                    </button>
                    {skill.sourceFilename && <div className="data-table__sub">{skill.sourceFilename}</div>}
                  </td>
                  <td>{describeScope(skill.scope)}</td>
                  <td>
                    {skill.scope === 'shared' ? (
                      <span className="skill-table__muted">Every author</span>
                    ) : (
                      <select
                        aria-label={`Author for ${skill.name}`}
                        value={skill.authorId ?? ''}
                        disabled={busy === `assign-${skill.id}`}
                        onChange={(e) => handleAssign(skill.id, e.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {authors.map((author) => (
                          <option key={author.id} value={author.id}>
                            {author.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {skill.scope === 'shared' ? (
                      <span className="skill-table__muted">All areas</span>
                    ) : skill.themes.length ? (
                      skill.themes.map((theme) => theme.name).join(', ')
                    ) : (
                      <span className="skill-table__muted">
                        {skill.authorId === null ? 'No author' : 'Author covers no area'}
                      </span>
                    )}
                  </td>
                  <td>{skill.wordCount.toLocaleString()} words</td>
                  <td>
                    <span className={`status-badge ${skill.isActive ? 'is-active' : 'is-inactive'}`}>
                      {skill.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="data-table__actions">
                    <button type="button" className="button" onClick={() => setEditing(skill.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busy === `status-${skill.id}`}
                      onClick={() => handleToggleStatus(skill)}
                    >
                      {skill.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busy === `export-${skill.id}`}
                      onClick={() => handleExport(skill)}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={busy === `delete-${skill.id}`}
                      onClick={() => handleDelete(skill)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        <p className="content-hint">
          Which author writes for which thematic area is set on the{' '}
          <Link to="/content/themes">Thematic Areas</Link> page, or on an author's own page — this table shows the
          result.
        </p>
      </section>

      <section className="content-section">
        <div className="content-section__head">
          <h2>Author Folder</h2>
          <button type="button" className="button" disabled={busy === 'import-all'} onClick={handleImportAll}>
            {busy === 'import-all' ? 'Importing…' : 'Import All'}
          </button>
        </div>

        <p className="content-hint">
          Markdown files Cynth can import. The database is what generation uses — a file here changes nothing until it
          is imported. <strong>Import All</strong> imports every document, creates any author a document names, and
          links that author to the thematic area it names.
        </p>

        {library && <p className="content-scope">{library.directory}</p>}

        {!library?.exists ? (
          <p className="article-list__empty">
            No Author folder found. Create one at the path above and put your skill documents in it, or add skills
            directly with <strong>Add Skill</strong>.
          </p>
        ) : library.files.length === 0 ? (
          <p className="article-list__empty">The Author folder has no markdown files in it.</p>
        ) : (
          <ul className="content-list">
            {library.files.map((file) => (
              <li key={file.filename}>
                <div>
                  <strong>{file.filename}</strong>
                  <div className="content-list__desc">{file.title}</div>
                  <div className="content-list__meta">
                    {file.characterCount.toLocaleString()} characters
                    {file.importedSkillId === null
                      ? ' · not imported'
                      : ` · imported as "${file.importedSkillName}"`}
                    {file.changedSinceImport && ' · the file has changed since it was imported'}
                  </div>
                </div>
                <div className="content-list__actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy === `import-${file.filename}`}
                    onClick={() => handleImportFile(file.filename)}
                  >
                    {file.importedSkillId === null ? 'Import' : 'Re-import'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {report && <ImportReport report={report} onDismiss={() => setReport(null)} />}
      </section>
    </div>
  );
}

/** What the import actually did, file by file. Every decision is stated rather than summarised away. */
function ImportReport({ report, onDismiss }: { report: LibraryImportReport; onDismiss: () => void }) {
  return (
    <div className="skill-report">
      <div className="content-section__head">
        <h3>Import Report</h3>
        <button type="button" className="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      <p className="content-hint">
        {report.skillsImported} imported, {report.skillsUpdated} updated, {report.authorsCreated} author(s) created,{' '}
        {report.themesLinked} thematic-area link(s) made
        {report.needsDecision > 0 && `, ${report.needsDecision} left inactive pending your decision`}
        {report.skipped > 0 && `, ${report.skipped} skipped`}.
      </p>

      <ul className="content-list">
        {report.entries.map((entry) => (
          <li key={entry.filename}>
            <div>
              <strong>{entry.filename}</strong>
              <div className="content-list__meta">
                {entry.outcome}
                {entry.authorName && ` · ${entry.authorName}${entry.authorCreated ? ' (created)' : ''}`}
                {entry.themeName && ` · ${entry.themeName}${entry.themeLinked ? ' (linked)' : ' (not linked)'}`}
                {!entry.isActive && ' · inactive'}
              </div>
              {entry.note && <div className="content-list__desc">{entry.note}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
