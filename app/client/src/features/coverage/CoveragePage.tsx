import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import {
  decideSubtopic,
  fetchCoverage,
  fetchRepeats,
  saveThresholds,
  syncCoverage,
} from './api';
import type { CoverageArea, CoverageMap, CoverageThresholds, RepeatRow, SubtopicRow } from './api';
import './CoveragePage.css';

/**
 * COVERAGE — what the publication has already written, and how far each
 * area has reached into its own scope.
 *
 * Three things happen here:
 *   1. The editor sees each area's subtopics: covered, touched, or never
 *      written about. Topic research is steered toward the empty ones.
 *   2. Subtopics topic research proposed OUTSIDE an area's scope wait here.
 *      Nothing is written about one until it is approved.
 *   3. The thresholds the three coverage gates use can be moved.
 */

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.errors.join(' ') : fallback);

const RING_LABEL: Record<SubtopicRow['ring'], string> = {
  core: 'Core',
  adjacent: 'Adjacent ring',
  approved: 'Approved by you',
  proposed: 'Waiting for you',
  rejected: 'Rejected',
};

const THRESHOLD_FIELDS: { key: keyof CoverageThresholds; label: string; help: string }[] = [
  { key: 'topicStop', label: 'Topic: stop at', help: 'A proposed topic this close to an existing article is dropped.' },
  { key: 'topicNeighbour', label: 'Topic: neighbour at', help: 'Goes ahead, but must say how it differs and link.' },
  { key: 'sectionCut', label: 'Section: cut at', help: 'A planned section this close to an existing one is removed.' },
  { key: 'maxCutShare', label: 'Section: stop when this share is cut', help: 'Fraction of the plan, 0–1.' },
  { key: 'draftBlock', label: 'Draft: block at', help: 'A written section this close blocks publication.' },
];

function SubtopicLine({ sub }: { sub: SubtopicRow }) {
  const sections = sub.touchedBy.reduce((n, t) => n + t.points, 0);
  return (
    <li className={`coverage-sub ${sub.covered ? 'coverage-sub--covered' : 'coverage-sub--open'}`}>
      <span className="coverage-sub__mark" aria-hidden="true">{sub.covered ? '■' : '□'}</span>
      <span className="coverage-sub__name" title={sub.description}>{sub.name}</span>
      <span className="coverage-sub__detail">
        {sub.primaryArticles.length
          ? sub.primaryArticles.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ', '}
                <Link to={`/articles/${a.id}`}>{a.title}</Link>
              </span>
            ))
          : sections
            ? `${sections} section${sections === 1 ? '' : 's'} elsewhere`
            : 'Not written about'}
      </span>
    </li>
  );
}

function AreaCard({ area, onDecide, busy }: { area: CoverageArea; onDecide: (id: number, d: 'approve' | 'reject') => void; busy: number | null }) {
  const core = area.subtopics.filter((s) => s.ring === 'core');
  const ring = area.subtopics.filter((s) => s.ring === 'adjacent' || s.ring === 'approved');
  const proposed = area.subtopics.filter((s) => s.ring === 'proposed');
  const rejected = area.subtopics.filter((s) => s.ring === 'rejected');
  const coreCovered = core.filter((s) => s.covered).length;

  return (
    <section className="coverage-area" aria-labelledby={`area-${area.themeId}`}>
      <header className="coverage-area__header">
        <h2 id={`area-${area.themeId}`}>{area.name}</h2>
        <span className="coverage-area__count">
          {area.articleCount} article{area.articleCount === 1 ? '' : 's'} · core {coreCovered}/{core.length} reached
        </span>
      </header>
      <p className="coverage-area__idea">{area.coreIdea}</p>

      {proposed.length > 0 && (
        <div className="coverage-proposals" role="region" aria-label="Proposed subtopics">
          <h3>Proposed subtopics — waiting for you</h3>
          <p className="coverage-note">Topic research wanted to widen the area here. Nothing is written about one until you approve it.</p>
          <ul>
            {proposed.map((sub) => (
              <li key={sub.id} className="coverage-proposal">
                <div>
                  <strong>{sub.name}</strong>
                  {sub.coreIdea && <p className="coverage-proposal__why">Serves: {sub.coreIdea}</p>}
                </div>
                <div className="coverage-proposal__actions">
                  <button type="button" className="button button--primary" disabled={busy === sub.id} onClick={() => onDecide(sub.id, 'approve')}>
                    Approve
                  </button>
                  <button type="button" className="button" disabled={busy === sub.id} onClick={() => onDecide(sub.id, 'reject')}>
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="coverage-columns">
        <div>
          <h3>{RING_LABEL.core}</h3>
          <ul className="coverage-list">{core.map((sub) => <SubtopicLine key={sub.id} sub={sub} />)}</ul>
        </div>
        <div>
          <h3>{RING_LABEL.adjacent}</h3>
          <ul className="coverage-list">{ring.map((sub) => <SubtopicLine key={sub.id} sub={sub} />)}</ul>
          {rejected.length > 0 && (
            <p className="coverage-note">Rejected, never proposed again: {rejected.map((s) => s.name).join(', ')}</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function CoveragePage() {
  const [map, setMap] = useState<CoverageMap | null>(null);
  const [repeats, setRepeats] = useState<{ draftBlock: number; repeats: RepeatRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<keyof CoverageThresholds, string>>>({});

  const load = useCallback(() => {
    fetchCoverage()
      .then(setMap)
      .catch((err) => setError(errorText(err, 'Could not load the coverage map.')));
    fetchRepeats(20)
      .then(setRepeats)
      .catch(() => setRepeats(null));
  }, []);

  useEffect(load, [load]);

  async function decide(id: number, decision: 'approve' | 'reject') {
    setBusy(id);
    setError(null);
    try {
      await decideSubtopic(id, decision);
      load();
    } catch (err) {
      setError(errorText(err, 'Could not record the decision.'));
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const { summary } = await syncCoverage();
      setNotice(
        summary.indexed.length || summary.removed.length
          ? `Indexed ${summary.indexed.length} article(s), removed ${summary.removed.length}.`
          : 'Already up to date — nothing was sent.',
      );
      load();
    } catch (err) {
      setError(errorText(err, 'Could not sync the coverage graph.'));
    } finally {
      setSyncing(false);
    }
  }

  async function save() {
    const values: Partial<CoverageThresholds> = {};
    for (const [key, raw] of Object.entries(draft)) if (raw !== undefined && raw !== '') values[key as keyof CoverageThresholds] = Number(raw);
    setError(null);
    try {
      await saveThresholds(values);
      setDraft({});
      setNotice('Thresholds saved. They apply from the next run.');
      load();
    } catch (err) {
      setError(errorText(err, 'Could not save the thresholds.'));
    }
  }

  const pending = map?.areas.reduce((n, a) => n + a.subtopics.filter((s) => s.ring === 'proposed').length, 0) ?? 0;

  return (
    <div className="page coverage-page">
      <PageHeader
        title="Coverage"
        description="Everything the publication has written, held as the points each article makes. A new article that would repeat one is stopped before it is drafted, and each area widens only into subtopics its scope allows or you approve."
      />

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="coverage-notice" role="status">{notice}</p>}

      {map === null ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="coverage-summary">
            <span>{map.graph.articles} articles · {map.graph.points} sections · {map.graph.links} linked repeats</span>
            <span className="coverage-summary__meta">
              {map.graph.lastIndexedAt ? `Last indexed ${map.graph.lastIndexedAt}` : 'Not indexed yet'}
              {map.graph.model ? ` · ${map.graph.model}` : ''}
            </span>
            {pending > 0 && <span className="coverage-summary__pending">{pending} subtopic{pending === 1 ? '' : 's'} waiting for you</span>}
            <button type="button" className="button" onClick={() => void sync()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>

          {map.areas.map((area) => (
            <AreaCard key={area.themeId} area={area} onDecide={(id, d) => void decide(id, d)} busy={busy} />
          ))}

          {repeats && repeats.repeats.length > 0 && (
            <section className="coverage-area" aria-labelledby="repeats-heading">
              <header className="coverage-area__header">
                <h2 id="repeats-heading">Repeats already in the catalogue</h2>
              </header>
              <p className="coverage-note">
                Sections in different articles that say much the same thing. From here on, a draft section at or above{' '}
                {repeats.draftBlock.toFixed(2)} blocks publication.
              </p>
              <table className="coverage-repeats">
                <thead>
                  <tr>
                    <th scope="col">Similarity</th>
                    <th scope="col">Section</th>
                    <th scope="col">Repeats</th>
                  </tr>
                </thead>
                <tbody>
                  {repeats.repeats.map((r, i) => (
                    <tr key={i} className={r.score >= repeats.draftBlock ? 'coverage-repeats--over' : undefined}>
                      <td>{r.score.toFixed(3)}</td>
                      <td><Link to={`/articles/${r.a.articleId}`}>{r.a.title}</Link> › {r.a.heading}</td>
                      <td><Link to={`/articles/${r.b.articleId}`}>{r.b.title}</Link> › {r.b.heading}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="coverage-area" aria-labelledby="thresholds-heading">
            <header className="coverage-area__header">
              <h2 id="thresholds-heading">Thresholds</h2>
            </header>
            <p className="coverage-note">Similarity runs from 0 (unrelated) to 1 (identical). The defaults were measured against the live catalogue.</p>
            <div className="coverage-thresholds">
              {THRESHOLD_FIELDS.map((field) => (
                <label key={field.key} className="coverage-threshold">
                  <span>{field.label}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1"
                    value={draft[field.key] ?? String(map.thresholds[field.key])}
                    onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                  />
                  <small>{field.help}</small>
                </label>
              ))}
            </div>
            <button type="button" className="button button--primary" onClick={() => void save()} disabled={!Object.keys(draft).length}>
              Save thresholds
            </button>
          </section>
        </>
      )}
    </div>
  );
}
