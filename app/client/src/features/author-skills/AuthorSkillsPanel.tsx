import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../shared/services/apiClient';
import type { AuthorSkillSummary } from '../../shared/types/authorSkill';
import { fetchAuthorSkills } from './api';
import './AuthorSkills.css';

/**
 * One author's skill documents, read-only.
 *
 * Management lives on the Author Skills page so there is a single screen that
 * owns these documents; this is the view from the author's own page, which is
 * where the question "does this author have a skill, and is it switched on?"
 * actually gets asked.
 */
export function AuthorSkillsPanel({ authorId }: { authorId: number }) {
  const [skills, setSkills] = useState<AuthorSkillSummary[]>([]);
  const [shared, setShared] = useState<AuthorSkillSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchAuthorSkills({ authorId }), fetchAuthorSkills({ scope: 'shared', status: 'active' })])
      .then(([own, sharedSkills]) => {
        setSkills(own);
        setShared(sharedSkills);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load author skills.'))
      .finally(() => setIsLoading(false));
  }, [authorId]);

  if (isLoading) return <p>Loading skills…</p>;

  return (
    <>
      <p className="content-hint">
        Long-form authoring documents, sent to the model exactly as written alongside the fields above.{' '}
        <Link to="/author-skills">Manage author skills</Link>.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {skills.length === 0 ? (
        <p>
          No skill assigned. This author writes from the fields on this page alone.
        </p>
      ) : (
        <ul className="content-list">
          {skills.map((skill) => (
            <li key={skill.id} className={skill.isActive ? undefined : 'is-inactive'}>
              <div>
                <strong>{skill.name}</strong>
                <div className="content-list__meta">
                  {skill.wordCount.toLocaleString()} words
                  {skill.sourceFilename && ` · ${skill.sourceFilename}`}
                </div>
              </div>
              <span className={`status-badge ${skill.isActive ? 'is-active' : 'is-inactive'}`}>
                {skill.isActive ? 'Active' : 'Inactive'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {shared.length > 0 && (
        <p className="content-hint">
          Also applied, as it is to every author:{' '}
          {shared.map((skill) => skill.name).join(', ')}.
        </p>
      )}
    </>
  );
}
