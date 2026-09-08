import {
  AI_ONLY_DIMENSIONS,
  SEO_DIMENSIONS,
  SEO_DIMENSION_LABELS,
  SEO_DIMENSION_WEIGHTS,
  SEVERITY_PENALTY,
} from './seo.constants.js';
import type { SeoDimension } from './seo.constants.js';
import type { SeoDimensionScore, SeoFinding, SeoScore } from './seo.types.js';

/**
 * THE SEO SCORE.
 *
 * A single number is only defensible if it can be taken apart. This model is
 * built so that every point lost has a finding behind it, and every dimension
 * can be read on its own.
 *
 * Four rules it holds to:
 *
 *   1. NOTHING IS SCORED THAT WAS NOT EXAMINED. A dimension only a model can
 *      judge, in an analysis where no model ran, is reported as NOT EVALUATED
 *      and left out of the weighted average entirely. It is neither credited
 *      with 100 nor punished with 0, and `coverage` states how much of the
 *      weighting was actually assessed.
 *   2. `info` FINDINGS COST NOTHING. Diagnostics — keyword density above all —
 *      are observations. They appear in the report and never move the number.
 *   3. AI PENALTIES ARE WEIGHTED BY CONFIDENCE. A model that is 40% sure
 *      costs 40% of the penalty. A deterministic finding is confidence 1 by
 *      definition, because a missing meta description is not a matter of
 *      degree.
 *   4. THE SCORE IS SEO READINESS, NOT ARTICLE QUALITY. It says how well the
 *      article is set up to be found, not how good it is. The two are
 *      deliberately different measurements and Cynth keeps them apart.
 */

/** Findings marked dismissed by a reviewer stop counting — that is the point of dismissing them. */
export interface ScoreableFinding extends SeoFinding {
  status?: 'open' | 'dismissed' | 'resolved';
}

export interface ScoreInput {
  findings: ScoreableFinding[];
  /** True when an AI pass actually ran and returned usable output. */
  aiAnalysisRan: boolean;
  /** True when the article has generated content at all. */
  hasContent: boolean;
}

/** How much a single finding costs its dimension. */
function penaltyFor(finding: ScoreableFinding): number {
  if (finding.status === 'dismissed') return 0;
  const base = SEVERITY_PENALTY[finding.severity];
  if (base === 0) return 0;

  // Deterministic findings are facts; AI findings are judgements, and a
  // judgement the model itself is unsure about should not cost full marks.
  const confidence = finding.origin === 'deterministic' ? 1 : Math.min(1, Math.max(0, finding.confidence));
  return base * confidence;
}

function explain(
  dimension: SeoDimension,
  score: number,
  findings: ScoreableFinding[],
  evaluated: boolean,
  reason: string | null,
): string {
  if (!evaluated) return reason ?? 'Not evaluated in this analysis.';

  const counted = findings.filter((finding) => penaltyFor(finding) > 0);
  if (!counted.length) {
    return `No issues found. ${SEO_DIMENSION_LABELS[dimension]} scores ${score}.`;
  }

  const bySeverity = counted.reduce<Record<string, number>>((accumulator, finding) => {
    accumulator[finding.severity] = (accumulator[finding.severity] ?? 0) + 1;
    return accumulator;
  }, {});

  const parts = Object.entries(bySeverity)
    .map(([severity, count]) => `${count} ${severity}${count === 1 ? '' : 's'}`)
    .join(', ');

  const informational = findings.length - counted.length;
  const informationalNote = informational
    ? ` ${informational} diagnostic finding${informational === 1 ? '' : 's'} did not affect the score.`
    : '';

  return `${parts} reduced this dimension to ${score}.${informationalNote}`;
}

export function calculateSeoScore(input: ScoreInput): SeoScore {
  const dimensions: SeoDimensionScore[] = [];
  const notEvaluated: SeoScore['notEvaluated'] = [];

  for (const dimension of SEO_DIMENSIONS) {
    const weight = SEO_DIMENSION_WEIGHTS[dimension];
    const findings = input.findings.filter((finding) => finding.dimension === dimension);

    // Why a dimension might not be assessable at all.
    //
    // The `info` exclusion matters: a diagnostic contributes no evidence about
    // whether a dimension is in good shape, so a dimension whose only findings
    // are diagnostics has still not been assessed. Without this, an unrelated
    // keyword-count note would let topical coverage score a full 100 in an
    // analysis where nothing ever judged the article's coverage.
    const scoringFindings = findings.filter((finding) => finding.severity !== 'info');

    let skipReason: string | null = null;
    if (!input.hasContent) {
      skipReason = 'The article has no generated content, so nothing could be assessed.';
    } else if (AI_ONLY_DIMENSIONS.includes(dimension) && !input.aiAnalysisRan && scoringFindings.length === 0) {
      skipReason =
        'This dimension needs semantic judgement, and no AI-assisted pass has run for this version of the article.';
    }

    if (skipReason) {
      notEvaluated.push({ dimension, label: SEO_DIMENSION_LABELS[dimension], reason: skipReason });
      dimensions.push({
        dimension,
        label: SEO_DIMENSION_LABELS[dimension],
        evaluated: false,
        score: null,
        weight,
        contribution: null,
        findingCount: findings.length,
        blockingCount: 0,
        warningCount: 0,
        explanation: skipReason,
      });
      continue;
    }

    const totalPenalty = findings.reduce((sum, finding) => sum + penaltyFor(finding), 0);
    const score = Math.max(0, Math.round(100 - totalPenalty));

    dimensions.push({
      dimension,
      label: SEO_DIMENSION_LABELS[dimension],
      evaluated: true,
      score,
      weight,
      contribution: Number(((score * weight) / 100).toFixed(2)),
      findingCount: findings.length,
      blockingCount: findings.filter((f) => f.severity === 'blocking' && f.status !== 'dismissed').length,
      warningCount: findings.filter((f) => f.severity === 'warning' && f.status !== 'dismissed').length,
      explanation: explain(dimension, score, findings, true, null),
    });
  }

  const evaluatedDimensions = dimensions.filter((entry) => entry.evaluated);
  const evaluatedWeight = evaluatedDimensions.reduce((sum, entry) => sum + entry.weight, 0);
  const totalWeight = Object.values(SEO_DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

  // The overall score is the weighted average of what was actually evaluated,
  // renormalised over that weight — not over 100 — so a partial analysis is
  // not silently penalised for the dimensions it did not look at.
  const overall = evaluatedWeight
    ? Math.round(
        evaluatedDimensions.reduce((sum, entry) => sum + (entry.score ?? 0) * entry.weight, 0) / evaluatedWeight,
      )
    : null;

  const coverage = totalWeight ? evaluatedWeight / totalWeight : 0;

  return {
    overall,
    dimensions,
    coverage,
    notEvaluated,
    explanation: buildExplanation(overall, coverage, dimensions, notEvaluated),
  };
}

function buildExplanation(
  overall: number | null,
  coverage: number,
  dimensions: SeoDimensionScore[],
  notEvaluated: SeoScore['notEvaluated'],
): string {
  if (overall === null) {
    return 'No SEO score could be calculated: nothing in this article was assessable.';
  }

  const evaluated = dimensions.filter((entry) => entry.evaluated);
  const weakest = [...evaluated].sort((a, b) => (a.score ?? 100) - (b.score ?? 100)).slice(0, 3);
  const coveragePercent = Math.round(coverage * 100);

  const sentences: string[] = [];
  sentences.push(
    `SEO readiness scores ${overall} out of 100, from ${coveragePercent}% of the scoring weight — ${evaluated.length} of ${dimensions.length} dimensions were assessed.`,
  );

  if (notEvaluated.length) {
    sentences.push(
      `Not assessed: ${notEvaluated.map((entry) => entry.label).join(', ')}. These are excluded from the average rather than assumed good or bad.`,
    );
  }

  const problems = weakest.filter((entry) => (entry.score ?? 100) < 100);
  if (problems.length) {
    sentences.push(
      `The score is held down mainly by ${problems
        .map((entry) => `${entry.label} (${entry.score})`)
        .join(', ')}.`,
    );
  } else {
    sentences.push('No assessed dimension lost points.');
  }

  sentences.push(
    'This measures SEO readiness only. It says nothing about whether the article is well written — Cynth keeps content quality and SEO readiness as separate judgements.',
  );

  return sentences.join(' ');
}
