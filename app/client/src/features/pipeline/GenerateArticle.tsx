import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { Theme } from '../../shared/types/content';
import { fetchThemes } from '../content/api';
import {
  advancePipeline,
  decideCheckpoint,
  fetchPipeline,
  fetchReadiness,
  fetchResumableRuns,
  rerunCheckpoint,
  retryPipeline,
  setRunMode,
  startPipeline,
} from './api';
import type {
  CheckpointKind,
  PipelineMode,
  PipelineRunMode,
  PipelineStatus,
  ResumableRun,
  SpendRefusal,
  StageProgress,
  TopicMode,
} from './api';
import { CheckpointPanel } from './CheckpointPanel';
import '../content/Content.css';
import './Pipeline.css';

/**
 * THE ARTICLE FLOW.
 *
 * Everything the old wizard asked a person to type — topic, what it covers,
 * scope, keywords, title, article type — is produced by the pipeline. The only
 * inputs here are the thematic area and, optionally, a steer.
 *
 * Two ways to run it:
 *
 *   AUTOMATIC starts it and leaves it alone.
 *   GUIDED (Milestone 24) stops at each checkpoint so the editor chooses the
 *   topic, the title, the keywords and the article type from options the
 *   pipeline actually produced, and decides whether to spend the revision.
 *
 * A guided run is a persisted thing, not a wizard held in this component: the
 * URL carries the pipeline id, so closing the tab and coming back lands on the
 * same question with the same options.
 *
 * The progress list is deliberate about the revision: it shows "0/1" or "1/1"
 * and never a spinner that implies further iterations. There is exactly one.
 */
export function GenerateArticle() {
  const navigate = useNavigate();
  const { pipelineId: pipelineIdParam } = useParams<{ pipelineId: string }>();
  const resumingId = pipelineIdParam ? Number(pipelineIdParam) : null;

  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeId, setThemeId] = useState<string>('');
  const [seedTopic, setSeedTopic] = useState('');
  /**
   * Defaults to 'exact'. Someone who has typed out an idea has already decided
   * what they want written; treating that as a brainstorming prompt is the
   * surprising behaviour, not the faithful one.
   */
  const [topicMode, setTopicMode] = useState<TopicMode>('exact');
  const [mode, setMode] = useState<PipelineMode>('production');
  const [runMode, setRunModeChoice] = useState<PipelineRunMode>('guided');

  const [ready, setReady] = useState<boolean | null>(null);
  const [readinessIssues, setReadinessIssues] = useState<string[]>([]);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Runs left unfinished, so starting over is a choice rather than the only
   * door available. Refreshed whenever this screen is showing the Start form,
   * because that is exactly when someone is about to start a second run of
   * something they already paid to research.
   */
  const [resumable, setResumable] = useState<ResumableRun[]>([]);

  /**
   * A paid stage waiting to be authorised.
   *
   * This used to be a `window.confirm`, which was wrong twice over: the
   * browser can suppress it after a few dialogs, leaving the user staring at
   * "confirm the estimated cost" with nothing to click — and it never showed
   * the estimate, so there was no cost to confirm even when it did appear.
   * `retry` is the exact call that was refused, re-issued with authorisation.
   */
  const [pendingSpend, setPendingSpend] = useState<{
    message: string;
    detail: SpendRefusal | null;
    retry: () => Promise<void>;
  } | null>(null);

  useEffect(() => {
    fetchThemes({ activeOnly: true })
      .then(setThemes)
      .catch(() => setThemes([]))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (resumingId) return;
    fetchResumableRuns()
      .then(setResumable)
      .catch(() => setResumable([]));
  }, [resumingId]);

  useEffect(() => {
    fetchReadiness(mode)
      .then((readiness) => {
        setReady(readiness.ready);
        setReadinessIssues(readiness.issues);
      })
      .catch(() => setReady(null));
  }, [mode]);

  // Resuming a run someone walked away from. The options come back with it,
  // because they were never held here in the first place.
  //
  // The guard matters: starting a run navigates here itself, and a fetch that
  // resolved after the run advanced would replace a finished status with the
  // empty one it had a second earlier.
  const hydrated = useRef<number | null>(null);
  useEffect(() => {
    if (!resumingId || !Number.isInteger(resumingId)) {
      // Back at /generate with no id: this is a new article, not the old one.
      hydrated.current = null;
      setStatus(null);
      return;
    }
    if (hydrated.current === resumingId) return;
    hydrated.current = resumingId;

    fetchPipeline(resumingId)
      .then((loaded) => setStatus((current) => (current?.pipeline.id === resumingId ? current : loaded)))
      .catch(() => setError('That run could not be loaded.'));
  }, [resumingId]);

  /**
   * Runs the pipeline.
   *
   * `confirmedCost` is only ever sent after the user answers the confirmation
   * the server asked for — it is never assumed on the first attempt.
   */
  const run = useCallback(async function run(pipelineId: number, confirmedCost: boolean): Promise<void> {
    setIsRunning(true);
    try {
      const result = await advancePipeline(pipelineId, confirmedCost);
      setStatus(result.status);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.details?.status) {
        setStatus(err.details.status as PipelineStatus);
      }

      if (err instanceof ApiError && err.code === 'cost_confirmation_required') {
        setPendingSpend({
          message: err.errors.join(' '),
          detail: (err.details?.spend as SpendRefusal | null) ?? null,
          retry: () => run(pipelineId, true),
        });
        return;
      }

      setError(err instanceof ApiError ? err.errors.join(' ') : 'The pipeline failed.');
    } finally {
      setIsRunning(false);
    }
  }, []);

  async function handleStart(event: FormEvent) {
    event.preventDefault();
    if (!themeId) return setError('Choose a thematic area.');

    setError(null);
    setStatus(null);
    try {
      const started = await startPipeline({
        themeId: Number(themeId),
        mode,
        runMode,
        seedTopic: seedTopic.trim() || null,
        topicMode,
      });
      setStatus(started.status);
      // The URL becomes the run, so this page is resumable from here on.
      navigate(`/generate/${started.pipelineId}`, { replace: true });
      await run(started.pipelineId, false);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not start the pipeline.');
    }
  }

  async function handleDecide(kind: CheckpointKind, decision: unknown, accepted: boolean) {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const result = await decideCheckpoint(status.pipeline.id, kind, decision, accepted);
      setStatus(result.status);
      // Answering does not spend anything; continuing does. So it continues
      // straight away only because the user is sitting here having just
      // answered — and the spend gate still asks before any paid stage.
      await run(status.pipeline.id, false);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'That decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRerun(kind: CheckpointKind) {
    if (!status) return;
    if (!window.confirm('This runs that stage again and is charged again. Continue?')) return;

    setBusy(true);
    setError(null);
    try {
      const result = await rerunCheckpoint(status.pipeline.id, kind, false);
      setStatus(result.status);
      setNotice('New options are ready.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'cost_confirmation_required') {
        setPendingSpend({
          message: err.errors.join(' '),
          detail: (err.details?.spend as SpendRefusal | null) ?? null,
          retry: async () => {
            const confirmed = await rerunCheckpoint(status.pipeline.id, kind, true);
            setStatus(confirmed.status);
            setNotice('New options are ready.');
          },
        });
      } else {
        setError(err instanceof ApiError ? err.errors.join(' ') : 'That stage could not be re-run.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function authoriseSpend() {
    const pending = pendingSpend;
    if (!pending) return;

    setPendingSpend(null);
    setBusy(true);
    setError(null);
    try {
      await pending.retry();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'That could not be run.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSkipAll() {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setRunMode(status.pipeline.id, 'automatic');
      setStatus(result.status);
      setNotice('Cynth will finish this one on its own, using its recommendation at each remaining step.');
      await run(status.pipeline.id, false);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not switch this run to automatic.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const result = await retryPipeline(status.pipeline.id);
      setStatus(result.status);
      await run(status.pipeline.id, false);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'This run could not be resumed.');
    } finally {
      setBusy(false);
    }
  }

  function stageMark(stage: StageProgress): string {
    if (stage.status === 'success') return '✓';
    if (stage.status === 'failure') return '✕';
    if (stage.status === 'skipped') return '–';
    if (stage.status === 'running') return '•';
    return '○';
  }

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );
  }

  const waiting = status?.checkpoint ?? null;

  return (
    <div className="page">
      <PageHeader
        title="Generate Article"
        description="Choose a thematic area. Cynth researches the topic, plans the keywords and title, picks the article type and template, writes the article, reviews it independently, and validates the result."
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {notice && <p className="form-notice">{notice}</p>}

      {/* THE COST GATE, in the page.
          Nothing has been sent at this point — the server refused before
          calling anything — so cancelling costs nothing and leaves the run
          exactly where it is. */}
      {pendingSpend && (
        <section className="content-section spend-confirm" role="alertdialog" aria-label="Confirm spending">
          <div className="content-section__head">
            <h2>This will cost money</h2>
            <span className="status-badge status-badge--waiting">Waiting for you</span>
          </div>

          {pendingSpend.detail ? (
            <>
              <p className="spend-confirm__lead">
                <strong>{pendingSpend.detail.stageLabel}</strong> runs on{' '}
                <strong>{pendingSpend.detail.model}</strong>.
              </p>
              <p className="spend-confirm__figure">
                {pendingSpend.detail.estimatedCost === null ? (
                  <>
                    This model publishes no pricing, so Cynth cannot estimate the cost. It is treated as paid.
                  </>
                ) : (
                  <>
                    Estimated cost for this stage: <strong>${pendingSpend.detail.estimatedCost.toFixed(4)}</strong>
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="spend-confirm__lead">{pendingSpend.message}</p>
          )}

          {/* Said plainly, because one click authorises more than one charge. */}
          <p className="pipeline-muted">
            Confirming runs the paid stages in this article until it next stops to ask you something. The estimate
            above is for the stage that is blocked now; each stage's actual cost appears in Progress as it completes,
            and the running total is shown there.
          </p>

          <div className="content-form__actions">
            <button type="button" className="button button--primary" disabled={busy || isRunning} onClick={authoriseSpend}>
              {busy || isRunning ? 'Running…' : 'Confirm and continue'}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || isRunning}
              onClick={() => {
                setPendingSpend(null);
                setNotice('Nothing was spent. The run is where you left it — continue when you are ready.');
              }}
            >
              Not now
            </button>
          </div>
        </section>
      )}

      {ready === false && (
        <p className="form-error" role="alert">
          The {mode} models are not fully configured.{' '}
          {readinessIssues.join(' ')} <Link to="/settings/models">Assign models</Link>.
        </p>
      )}

      {/* UNFINISHED RUNS.
          Above the Start form on purpose. A run that stopped — because a model
          failed, or because the tab was closed to go and change one — keeps
          every stage it already paid for. Starting a new one instead pays for
          that research a second time, so the runs are offered before the form
          that would replace them. */}
      {!status && resumable.length > 0 && (
        <section className="content-section">
          <div className="content-section__head">
            <h2>Continue a run</h2>
            <span className="status-badge status-badge--waiting">
              {resumable.length} unfinished
            </span>
          </div>

          <p className="pipeline-muted">
            These runs still have work left. Everything they have already done is kept — continuing costs only the
            stages that have not run yet. Changing a model in Settings applies from the next stage onward, so a run
            stopped by a model that failed can be continued after swapping it.
          </p>

          <ul className="resume-list">
            {resumable.map((run) => (
              <li key={run.pipelineId} className={`resume-item${run.failed ? ' is-failed' : ''}`}>
                <div className="resume-item__main">
                  <Link to={`/generate/${run.pipelineId}`} className="resume-item__title">
                    {run.title ?? run.topic ?? `Untitled run in ${run.themeName ?? 'an unknown area'}`}
                  </Link>

                  <p className="resume-item__meta">
                    {run.themeName && <span>{run.themeName}</span>}
                    <span>{run.mode}</span>
                    <span>{run.runMode}</span>
                    {/* What has already been paid is the whole argument for
                        continuing rather than starting again. */}
                    {run.spent !== null && <span className="resume-item__spent">${run.spent.toFixed(4)} spent</span>}
                  </p>

                  <p className="resume-item__state">
                    {run.failed ? (
                      <>
                        <strong>Stopped.</strong> {run.note ?? 'A stage failed.'} Continuing tries{' '}
                        {run.nextStage ? <strong>{run.nextStage}</strong> : 'the failed stage'} again.
                      </>
                    ) : run.waitingFor ? (
                      <>
                        <strong>Waiting for you:</strong> {run.waitingFor}
                      </>
                    ) : run.nextStage ? (
                      <>
                        Next up: <strong>{run.nextStage}</strong>
                      </>
                    ) : (
                      <>Ready to continue.</>
                    )}
                  </p>
                </div>

                <div className="resume-item__actions">
                  <Link to={`/generate/${run.pipelineId}`} className="button button--primary">
                    Continue
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!status && (
        <form className="content-section" onSubmit={handleStart}>
          <h2>Start a new article</h2>

          <label className="wizard-field">
            Thematic Area
            <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
              <option value="">Choose an area…</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>

          <label className="wizard-field">
            Your idea <span className="pipeline-muted">(optional)</span>
            {/* A textarea, not an input: an idea worth being faithful to is
                usually a sentence, and a single-line box says otherwise. */}
            <textarea
              value={seedTopic}
              onChange={(e) => setSeedTopic(e.target.value)}
              rows={3}
              placeholder="e.g. the healthiest snacks for cats recovering from a health problem — or leave empty and Cynth proposes topics from this area"
            />
          </label>

          {/* Only asked once there is an idea to be faithful to. With an empty
              box the question is meaningless, so it is not put. */}
          {seedTopic.trim() && (
            <label className="wizard-field">
              What to do with it
              <select value={topicMode} onChange={(e) => setTopicMode(e.target.value as TopicMode)}>
                <option value="exact">Write about exactly this — research it, don't replace it</option>
                <option value="explore">Use it as a direction — propose angles within it</option>
              </select>
              <span className="pipeline-muted">
                {topicMode === 'exact'
                  ? 'Cynth researches your subject and writes it. It will still tell you honestly if it thinks the idea is weak.'
                  : 'Cynth proposes a short list of distinct articles within your direction, and you pick one.'}
              </span>
            </label>
          )}

          <label className="wizard-field">
            How to run it
            <select value={runMode} onChange={(e) => setRunModeChoice(e.target.value as PipelineRunMode)}>
              <option value="guided">Guided — I choose the topic, title and keywords</option>
              <option value="automatic">Automatic — Cynth decides everything</option>
            </select>
          </label>

          <label className="wizard-field">
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as PipelineMode)}>
              <option value="production">Production — the configured paid models</option>
              <option value="development">Development — free models, identical pipeline</option>
            </select>
          </label>

          <div className="content-form__actions">
            <button type="submit" className="button button--primary" disabled={isRunning || !themeId || ready === false}>
              {isRunning ? 'Running…' : 'Generate Article'}
            </button>
          </div>
        </form>
      )}

      {waiting && (
        <CheckpointPanel
          checkpoint={waiting}
          busy={busy || isRunning}
          onDecide={(decision, accepted) => handleDecide(waiting.kind, decision, accepted)}
          onRerun={() => handleRerun(waiting.kind)}
          onSkipAll={handleSkipAll}
          onRefresh={() => {
            // Re-reads the run, which rebuilds the checkpoint's options. The
            // products list is the registry as it stands, so a product added
            // in another tab appears without restarting anything.
            fetchPipeline(status!.pipeline.id).then(setStatus).catch(() => undefined);
          }}
        />
      )}

      {status && (
        <section className="content-section">
          <div className="content-section__head">
            <h2>Progress</h2>
            <span className={`status-badge pipeline-state--${status.pipeline.state.toLowerCase()}`}>
              {status.pipeline.state.replace(/_/g, ' ')}
            </span>
          </div>

          <p className="pipeline-muted">
            {status.runMode === 'guided'
              ? 'Guided run — Cynth stops and asks at each decision.'
              : 'Automatic run — Cynth decides everything.'}
          </p>

          <ul className="pipeline-stages">
            {status.stages.map((stage) => (
              <li key={stage.stage} className={`pipeline-stage is-${stage.status}`}>
                <span className="pipeline-stage__mark">{stageMark(stage)}</span>
                <span className="pipeline-stage__label">
                  {stage.label}
                  {/* The cap is shown as a fraction, never as an open-ended count. */}
                  {stage.stage === 'article_revision' && (
                    <span className="pipeline-stage__revision">
                      {' '}
                      REVISION: {status.revisions.used}/{status.revisions.max}
                    </span>
                  )}
                </span>
                <span className="pipeline-stage__meta">
                  {stage.model && <span>{stage.model}</span>}
                  {stage.wasFallback && <span className="pipeline-fallback">fallback</span>}
                  {stage.estimatedCost !== null && <span>${stage.estimatedCost.toFixed(4)}</span>}
                  {stage.durationMs !== null && <span>{(stage.durationMs / 1000).toFixed(1)}s</span>}
                </span>
                {stage.error && <p className="pipeline-stage__error">{stage.error}</p>}
              </li>
            ))}
          </ul>

          {status.decisions.length > 0 && (
            <div className="checkpoint-context">
              <h4 className="checkpoint-subhead">Decisions on this run</h4>
              <ul>
                {status.decisions.map((decision) => (
                  <li key={decision.kind}>
                    {decision.label}:{' '}
                    {decision.resolution === 'automatic'
                      ? 'left to Cynth'
                      : decision.resolution === 'accepted'
                        ? 'Cynth’s recommendation, accepted'
                        : 'chosen by you'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status.cost && (
            <p className="content-hint">
              Total: ${status.cost.totalCost.toFixed(4)}
              {status.cost.hasUnknownCosts && ' (some models have no published pricing, so the real total is higher)'}
            </p>
          )}

          {status.pipeline.outcomeNote && <p className="form-notice">{status.pipeline.outcomeNote}</p>}

          {/* A failed stage is resumable rather than fatal. Everything that
              succeeded is kept, so trying again costs only the stage that
              actually failed. */}
          {status.pipeline.state === 'FAILED' && (
            <div className="content-form__actions">
              <button type="button" className="button button--primary" disabled={busy || isRunning} onClick={handleRetry}>
                {busy || isRunning ? 'Working…' : 'Try the failed stage again'}
              </button>
              <span className="pipeline-muted">
                Completed stages are kept and are not charged again — only the stage that failed runs.
              </span>
            </div>
          )}

          {status.finished && status.pipeline.state !== 'FAILED' && (
            <div className="content-form__actions">
              <button type="button" className="button button--primary" onClick={() => navigate(`/articles/${status.articleId}`)}>
                Open the article
              </button>
              <Link to="/generate" className="button">
                Start another
              </Link>
            </div>
          )}

          {!status.finished && !waiting && !isRunning && (
            <div className="content-form__actions">
              <button type="button" className="button" onClick={() => run(status.pipeline.id, false)}>
                Continue
              </button>
              <span className="pipeline-muted">
                Completed stages are not re-run, so continuing costs nothing for work already done.
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
