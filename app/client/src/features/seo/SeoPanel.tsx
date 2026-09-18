import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../shared/services/apiClient';
import type { SeoConfiguration, SeoMetadata, SeoOverview } from '../../shared/types/seo';
import {
  analyzeArticle,
  fetchSeoOverview,
  saveSeoConfiguration,
  saveSeoMetadata,
  setExternalSourceStatus,
  setFindingStatus,
  setInternalLinkStatus,
  setRecommendationStatus,
} from './api';
import { SeoScoreCard } from './SeoScoreCard';
import { SeoFindingsList } from './SeoFindingsList';
import { SeoConfigurationForm } from './SeoConfigurationForm';
import { SeoMetadataForm } from './SeoMetadataForm';
import { SeoOpportunities } from './SeoOpportunities';
import './Seo.css';

/**
 * THE SEO PANEL — the SEO Engine inside the Article workflow.
 *
 *   Editorial Configuration -> Article Generation -> SEO Engine ->
 *   SEO Review -> Cynth Draft -> WordPress Draft
 *
 * Three things this panel is careful about, mirroring the engine behind it:
 *
 *   1. IT NEVER EDITS THE ARTICLE. Everything it writes is SEO metadata.
 *      Approving advice about the body records a decision and changes no
 *      prose.
 *   2. IT NEVER SPENDS QUIETLY. The default action is the free deterministic
 *      analysis. The AI pass is a separate button that states the model, the
 *      cost class and the estimated cost first, and a paid model needs an
 *      explicit confirmation.
 *   3. IT SAYS WHAT IT DID NOT DO. A deterministic-only analysis reports the
 *      dimensions it could not assess rather than scoring them anyway.
 */

type Tab = 'overview' | 'configuration' | 'metadata' | 'findings' | 'opportunities' | 'gate';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Score' },
  { id: 'findings', label: 'Findings' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'gate', label: 'Gate' },
];

function formatMoney(value: number | null): string {
  if (value === null) return 'unknown';
  if (value === 0) return 'free';
  return value < 0.01 ? `under $0.01` : `about $${value.toFixed(2)}`;
}

interface SeoPanelProps {
  articleId: number;
  /** Called after anything that could change the article's SEO readiness. */
  onChanged?: () => void;
}

export function SeoPanel({ articleId, onChanged }: SeoPanelProps) {
  const [overview, setOverview] = useState<SeoOverview | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [needsCostConfirmation, setNeedsCostConfirmation] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    fetchSeoOverview(articleId)
      .then((loaded) => {
        setOverview(loaded);
        setLoadError(null);
      })
      .catch((error) =>
        setLoadError(error instanceof ApiError ? error.errors.join(' ') : 'Could not load the SEO analysis.'),
      )
      .finally(() => setIsLoading(false));
  }, [articleId]);

  useEffect(load, [load]);

  async function runAnalysis(options: { includeAi?: boolean; confirmedCost?: boolean; force?: boolean }) {
    setIsAnalyzing(true);
    setErrors(null);
    setAnalysisNote(null);
    setNeedsCostConfirmation(false);
    setNotice(null);

    try {
      const outcome = await analyzeArticle(articleId, options);
      setAnalysisNote(outcome.aiNote);
      setDiscarded(outcome.discarded ?? []);
      load();
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.errors);
        // The one error the user can resolve without changing anything: an
        // explicit acceptance of the cost.
        setNeedsCostConfirmation(error.code === 'cost_confirmation_required');
      } else {
        setErrors(['The SEO analysis failed unexpectedly.']);
      }
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleSaveConfiguration(configuration: SeoConfiguration) {
    setIsSaving(true);
    setNotice(null);
    try {
      await saveSeoConfiguration(articleId, configuration);
      setNotice('SEO configuration saved. Re-run the analysis to judge the article against it.');
      load();
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : ['Could not save the SEO configuration.']);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveMetadata(metadata: SeoMetadata) {
    setIsSaving(true);
    setNotice(null);
    try {
      await saveSeoMetadata(articleId, metadata);
      setNotice('SEO metadata saved. The article itself is unchanged.');
      load();
      onChanged?.();
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : ['Could not save the SEO metadata.']);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFinding(id: number, status: 'open' | 'dismissed') {
    setBusyId(id);
    try {
      await setFindingStatus(id, status);
      load();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRecommendation(id: number, status: 'approved' | 'rejected') {
    setBusyId(id);
    setNotice(null);
    try {
      const result = await setRecommendationStatus(id, status);
      // The response says whether anything was actually applied, and the
      // panel repeats it rather than implying a change that did not happen.
      if (status === 'approved') {
        setNotice(
          result.applied
            ? 'Approved and written into the SEO metadata. The article body is unchanged.'
            : result.note ?? 'Approved and recorded. Nothing in the article was changed.',
        );
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleLink(id: number, status: 'approved' | 'rejected') {
    setBusyId(id);
    try {
      await setInternalLinkStatus(id, status);
      if (status === 'approved') {
        setNotice('Link approved and recorded. Cynth does not insert links into articles.');
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleSource(id: number, status: 'approved' | 'rejected') {
    setBusyId(id);
    try {
      await setExternalSourceStatus(id, status);
      if (status === 'approved') {
        setNotice('Source approved — still unverified. Cynth cannot check a URL in this version.');
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading && !overview) return <section className="seo-panel"><p>Loading SEO analysis…</p></section>;

  if (loadError) {
    return (
      <section className="seo-panel">
        <h3>SEO</h3>
        <p className="form-error" role="alert">{loadError}</p>
      </section>
    );
  }

  if (!overview) return null;

  const { gate, aiPreflight, latestRun } = overview;
  const readiness = gate.ready ? 'ready' : latestRun ? 'blocked' : 'not-analysed';
  const canRunAi = aiPreflight.ready && overview.hasContent;

  return (
    <section className="seo-panel">
      <header className="seo-panel__head">
        <div>
          <h3>SEO</h3>
          <p className="seo-panel__context">
            {[overview.editorial.themeName, overview.editorial.topicTitle, overview.editorial.articleTypeName]
              .filter(Boolean)
              .join(' · ') || 'No editorial context configured'}
            {overview.editorial.authorName && ` · written as ${overview.editorial.authorName}`}
          </p>
        </div>
        <span className={`seo-readiness seo-readiness--${readiness}`}>
          {readiness === 'ready' ? 'SEO ready' : readiness === 'blocked' ? 'Not SEO ready' : 'Not analysed'}
        </span>
      </header>

      {!overview.hasContent && (
        <p className="seo-panel__blocked">
          This article has no generated content yet, so there is nothing to analyse. Generate a draft first.
        </p>
      )}

      {/* ------------------------------------------------------ actions */}
      <div className="seo-panel__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={isAnalyzing || !overview.hasContent}
          onClick={() => void runAnalysis({})}
        >
          {isAnalyzing ? 'Analysing…' : 'Run SEO analysis'}
        </button>

        <button
          type="button"
          className="button"
          disabled={isAnalyzing || !canRunAi}
          onClick={() => void runAnalysis({ includeAi: true })}
          title={aiPreflight.issues.join(' ') || undefined}
        >
          Run with AI analysis
        </button>

        {overview.aiAnalysisIsCurrent && (
          <button
            type="button"
            className="button button--ghost"
            disabled={isAnalyzing}
            onClick={() => void runAnalysis({ includeAi: true, force: true })}
            title="Re-runs the AI pass even though an identical analysis already exists. This spends again."
          >
            Force AI re-analysis
          </button>
        )}
      </div>

      {/* COST AWARENESS, stated before the button is pressed rather than after. */}
      <p className="seo-panel__cost">
        <strong>Deterministic analysis is free</strong> and contacts nothing.
        {aiPreflight.model ? (
          <>
            {' '}The AI pass would use <strong>{aiPreflight.model.displayName ?? aiPreflight.model.modelName}</strong>
            {aiPreflight.provider && ` via ${aiPreflight.provider.name}`} — {aiPreflight.costClass} model
            {aiPreflight.cost && `, ${formatMoney(aiPreflight.cost.totalCost)} per run`}. Cynth is in{' '}
            {aiPreflight.mode} mode.
          </>
        ) : (
          ' No model is configured for SEO analysis, so the AI pass is unavailable.'
        )}
      </p>

      {aiPreflight.issues.length > 0 && (
        <ul className="seo-panel__issues">
          {aiPreflight.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      {errors && (
        <div className="form-error" role="alert">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
          {needsCostConfirmation && (
            <button
              type="button"
              className="button button--primary"
              disabled={isAnalyzing}
              onClick={() => void runAnalysis({ includeAi: true, confirmedCost: true })}
            >
              Confirm the cost and run the AI analysis
            </button>
          )}
        </div>
      )}

      {analysisNote && <p className="seo-panel__note">{analysisNote}</p>}
      {notice && <p className="seo-panel__notice">{notice}</p>}

      {discarded.length > 0 && (
        <details className="seo-panel__discarded">
          <summary>{discarded.length} item(s) from the model were discarded</summary>
          <ul>
            {discarded.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </details>
      )}

      {/* --------------------------------------------------------- tabs */}
      <nav className="seo-tabs" aria-label="SEO sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`seo-tab ${tab === entry.id ? 'seo-tab--active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === 'findings' && overview.findings.length > 0 && (
              <span className="seo-tab__count">{overview.findings.filter((f) => f.status === 'open').length}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="seo-tabpanel">
        {tab === 'overview' && (
          <>
            <SeoScoreCard score={overview.score} />
            {latestRun && (
              <p className="seo-panel__runinfo">
                Last analysed {new Date(latestRun.createdAt.replace(' ', 'T') + 'Z').toLocaleString()} —{' '}
                {latestRun.mode === 'deterministic'
                  ? 'deterministic only'
                  : `deterministic plus AI (${latestRun.model ?? 'unknown model'})`}
                {latestRun.status === 'partial' && ' — the AI pass did not complete'}
                {latestRun.totalTokens !== null && ` · ${latestRun.totalTokens} tokens reported`}
              </p>
            )}
            <p className="seo-panel__separation">
              This score measures <strong>SEO readiness</strong>, not article quality. A well-written article can score
              poorly here, and a poor one can score well.
            </p>
          </>
        )}

        {tab === 'findings' && (
          <SeoFindingsList findings={overview.findings} onSetStatus={handleFinding} busyId={busyId} />
        )}

        {tab === 'configuration' && (
          <SeoConfigurationForm
            configuration={overview.seo.configuration}
            onSave={handleSaveConfiguration}
            isSaving={isSaving}
          />
        )}

        {tab === 'metadata' && (
          <SeoMetadataForm
            metadata={overview.seo.metadata}
            articleTitle={overview.editorial.articleTitle}
            articleSlug={overview.editorial.slug}
            recommendations={overview.recommendations}
            onSave={handleSaveMetadata}
            onDecide={handleRecommendation}
            isSaving={isSaving}
            busyRecommendationId={busyId}
          />
        )}

        {tab === 'opportunities' && (
          <SeoOpportunities
            internalLinks={overview.internalLinks}
            externalSources={overview.externalSources}
            imageRequirements={overview.imageRequirements}
            structuredData={overview.structuredData}
            diagnostics={overview.diagnostics}
            onLinkDecision={handleLink}
            onSourceDecision={handleSource}
            busyId={busyId}
          />
        )}

        {tab === 'gate' && (
          <div className="seo-gate">
            <p className="seo-form__hint">
              The gate decides whether this article may be handed to WordPress. It does not require a perfect score —
              it requires that nothing about the article is actually broken.
              {!gate.enforced && ' Enforcement is currently switched off in Settings, so this is advisory only.'}
            </p>
            <ul className="seo-gate__checks">
              {gate.checks.map((check) => (
                <li
                  key={check.key}
                  className={`seo-gate__check seo-gate__check--${
                    !check.enforced ? 'off' : check.passed ? 'pass' : 'fail'
                  }`}
                >
                  <span className="seo-gate__mark" aria-hidden="true">
                    {!check.enforced ? '–' : check.passed ? '✓' : '✕'}
                  </span>
                  <div>
                    <p className="seo-gate__label">
                      {check.label}
                      {!check.enforced && <span className="seo-gate__off"> (not enforced)</span>}
                    </p>
                    <p className="seo-gate__detail">{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
