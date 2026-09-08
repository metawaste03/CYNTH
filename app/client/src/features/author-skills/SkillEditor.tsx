import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiError } from '../../shared/services/apiClient';
import type { Author } from '../../shared/types/author';
import type { AuthorSkillScope } from '../../shared/types/authorSkill';
import { createAuthorSkill, fetchAuthorSkill, updateAuthorSkill } from './api';

/**
 * Add or edit one skill document.
 *
 * The body is a plain textarea over the raw markdown, deliberately: Cynth
 * stores and sends exactly these characters, so showing anything other than
 * exactly these characters would be showing the user something other than
 * what the model receives. A file can be read into the textarea, which is how
 * a document written elsewhere gets in without going through the Author
 * folder.
 */
interface SkillEditorProps {
  /** Null creates a new skill. */
  skillId: number | null;
  authors: Author[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function SkillEditor({ skillId, authors, onClose, onSaved }: SkillEditorProps) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<AuthorSkillScope>('author');
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(skillId !== null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (skillId === null) return;

    setIsLoading(true);
    fetchAuthorSkill(skillId)
      .then((skill) => {
        setName(skill.name);
        setBody(skill.body);
        setScope(skill.scope);
        setAuthorId(skill.authorId);
        setIsActive(skill.isActive);
        setSourceFilename(skill.sourceFilename);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load the skill.'))
      .finally(() => setIsLoading(false));
  }, [skillId]);

  /** Reads a local .md into the textarea. Nothing is saved until the user submits. */
  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    file
      .text()
      .then((text) => {
        setBody(text);
        // Only fills a name the user has not written themselves.
        if (!name.trim()) setName(file.name.replace(/\.md$/i, ''));
        setError(null);
      })
      .catch(() => setError('Could not read that file.'));

    event.target.value = '';
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('Name is required.');
    if (!body.trim()) return setError('Skill content is required.');

    setIsSaving(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        body,
        scope,
        // A shared skill belongs to everyone, so it carries no author.
        authorId: scope === 'shared' ? null : authorId,
        sourceFilename,
        isActive,
      };

      if (skillId === null) {
        const created = await createAuthorSkill(input);
        onSaved(`"${created.name}" was added.`);
      } else {
        const updated = await updateAuthorSkill(skillId, input);
        onSaved(`"${updated.name}" was saved.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not save the skill.');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <section className="content-section">
        <p>Loading skill…</p>
      </section>
    );
  }

  return (
    <section className="content-section skill-editor">
      <div className="content-section__head">
        <h2>{skillId === null ? 'Add Skill' : 'Edit Skill'}</h2>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <form className="content-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </label>

        <label>
          Scope
          <select value={scope} onChange={(e) => setScope(e.target.value as AuthorSkillScope)}>
            <option value="author">Author — applies only to the assigned author</option>
            <option value="shared">Shared — applies to every author</option>
          </select>
        </label>

        {scope === 'author' && (
          <label>
            Author
            <select value={authorId ?? ''} onChange={(e) => setAuthorId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unassigned — not used until an author is chosen</option>
              {authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="content-form__checkbox">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active — send this skill to the model
        </label>

        <label>
          Skill Content (Markdown)
          <textarea
            className="skill-editor__body"
            rows={24}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
          />
        </label>

        <p className="content-hint">
          {body.length.toLocaleString()} characters. Sent to the model exactly as written — Cynth does not reformat,
          summarise or extract from it.
          {sourceFilename && ` Imported from ${sourceFilename}; exporting writes back to that file.`}
        </p>

        <div className="content-form__actions">
          <button type="button" className="button" onClick={() => fileInput.current?.click()}>
            Load from a .md file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".md,text/markdown,text/plain"
            hidden
            onChange={handleFile}
          />
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save Skill'}
          </button>
        </div>
      </form>
    </section>
  );
}
