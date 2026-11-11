import { getDatabase } from '../../../shared/database/index.js';
import {
  beginStageRun,
  completeStageRun,
  failStageRun,
  findCompletedStage,
  getPipelineById,
  setState,
} from '../pipeline.repository.js';
import type { StageRunDto } from '../pipeline.repository.js';
import { STAGE_DEFINITIONS } from '../pipeline.constants.js';
import type { PipelineStage } from '../pipeline.constants.js';
import {
  findSubtopicByName,
  getThresholds,
  proposeSubtopic,
  screenDraft,
  screenSections,
  screenTopics,
  syncCoverageGraph,
} from '../../coverage-graph/coverageGraph.service.js';
import type {
  CoverageMatch,
  DraftOverlap,
  PlannedSection,
  SectionScreen,
  TopicScreen,
  TopicVerdict,
} from '../../coverage-graph/coverageGraph.service.js';
import type { KeywordResearch, TopicResearch, TopicResearchSet } from './researchStages.service.js';
import type { ValidationFinding } from './validation.service.js';

/**
 * THE THREE COVERAGE GATES, AS PIPELINE STAGES.
 *
 * Each is a stage run like any other, so what it decided is on the record and
 * survives a restart. Each is tied to the output it judged — a topic screen
 * to the topic research attempt it read, and so on — and is recomputed when
 * that output changes, because a stored verdict about a different shortlist
 * would be a verdict about nothing.
 *
 * The comparisons themselves live in coverage-graph/coverageGraph.service.ts.
 * This file decides what each result MEANS for the run.
 */

/* ---------------------------------------------------------------- shared --- */

interface Recorded {
  promptTokens: number;
  reportedCost: number | null;
  model: string;
}

function latestRunId(pipelineId: number, version: number, stage: PipelineStage): number | null {
  return findCompletedStage(pipelineId, version, stage)?.id ?? null;
}

/** Reuses a completed screen only when it judged the same input. */
function reusable<T extends { basedOn: string }>(pipelineId: number, stage: PipelineStage, basedOn: string): StageRunDto | null {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return null;
  const existing = findCompletedStage(pipeline.id, pipeline.version, stage);
  return existing && (existing.output as T | null)?.basedOn === basedOn ? existing : null;
}

async function asStage<T>(
  pipelineId: number,
  stage: PipelineStage,
  work: () => Promise<{ output: T; recorded: Recorded }>,
): Promise<{ run: StageRunDto; output: T }> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found.');

  setState(pipelineId, STAGE_DEFINITIONS[stage].runningState, { stage });
  const run = beginStageRun({ pipelineId: pipeline.id, version: pipeline.version, stage });
  const started = Date.now();

  try {
    // Every gate brings the graph up to date first. Topic research does too,
    // but a resumed run skips that stage, and a gate reading a stale or empty
    // graph would compare against nothing and pass everything. With nothing
    // changed this sends nothing.
    const sync = await syncCoverageGraph();
    const { output, recorded } = await work();
    const tokens = recorded.promptTokens + sync.promptTokens;
    const cost =
      recorded.reportedCost === null && sync.reportedCost === null
        ? null
        : (recorded.reportedCost ?? 0) + (sync.reportedCost ?? 0);
    const completed = completeStageRun(run.id, {
      actualModel: recorded.model,
      provider: 'OpenRouter',
      promptTokens: tokens,
      totalTokens: tokens,
      estimatedCost: cost,
      durationMs: Date.now() - started,
      output,
    });
    return { run: completed, output };
  } catch (error) {
    // A gate that could not look has not passed. The run fails here, before
    // anything is written, and can be resumed once embedding works again.
    const message = error instanceof Error ? error.message : 'The coverage check failed.';
    failStageRun(run.id, { errorCode: 'coverage_unavailable', errorMessage: message, durationMs: Date.now() - started });
    setState(pipelineId, 'FAILED', { stage, note: `Coverage check could not run: ${message}` });
    throw error;
  }
}

function stop(pipelineId: number, stage: PipelineStage, note: string): void {
  setState(pipelineId, 'NEEDS_EDITORIAL_ATTENTION', { stage, note });
}

const pct = (score: number) => score.toFixed(2);

function describeMatch(match: CoverageMatch | null): string {
  if (!match) return 'nothing';
  return `"${match.title}"${match.heading ? ` (section "${match.heading}")` : ''} at ${pct(match.score)}`;
}

/** What a topic is, as compared: the same shape calibration measured. */
function topicText(candidate: Pick<TopicResearch, 'topic' | 'recommendedAngle'>): string {
  return `${candidate.topic}\nAngle: ${candidate.recommendedAngle}`;
}

/* ----------------------------------------------------------- topic gate --- */

export type TopicOutcome = 'offered' | 'dropped' | 'held';

export interface TopicScreenResult {
  topic: string;
  verdict: TopicVerdict;
  outcome: TopicOutcome;
  /** Why, in a sentence a person can read. */
  reason: string;
  subtopic: { id: number | null; name: string; ring: string } | null;
  nearestArticle: CoverageMatch | null;
  nearestPoint: CoverageMatch | null;
}

export interface TopicScreenOutput {
  /** The topic_research run this judged. */
  basedOn: string;
  /** The shortlist with every dropped or held topic removed; null when none survived. */
  screened: TopicResearchSet | null;
  results: TopicScreenResult[];
  stopReason: string | null;
}

/**
 * Which subtopic a candidate serves, and whether that lets it be written.
 *
 * A topic that names a subtopic outside the area's scope is HELD: the
 * subtopic is recorded as proposed, and nothing is written about it until a
 * person approves it. A subtopic the editor already rejected drops the topic.
 * An exact topic is the editor's own decision, so it is never held.
 */
function resolveSubtopic(
  candidate: TopicResearch,
  screen: TopicScreen,
  context: { themeId: number | null; pipelineId: number; exact: boolean; subtopicMatch: number },
): { subtopic: TopicScreenResult['subtopic']; outcome: TopicOutcome | null; reason: string | null } {
  if (context.themeId === null) return { subtopic: null, outcome: null, reason: null };

  const declared = candidate.subtopic?.trim() ?? '';
  const isNew = /^new\s*:/i.test(declared);
  const name = isNew ? declared.replace(/^new\s*:\s*/i, '').trim() : declared;

  if (name) {
    const found = findSubtopicByName(context.themeId, name);
    if (found?.ring === 'rejected') {
      return {
        subtopic: { id: found.id, name: found.name, ring: found.ring },
        outcome: context.exact ? null : 'dropped',
        reason: context.exact ? null : `It serves "${found.name}", which the editor rejected for this area.`,
      };
    }
    if (found && found.ring !== 'proposed') {
      return { subtopic: { id: found.id, name: found.name, ring: found.ring }, outcome: null, reason: null };
    }
    if (context.exact) return { subtopic: { id: found?.id ?? null, name, ring: found?.ring ?? 'unlisted' }, outcome: null, reason: null };

    const proposed = found ?? proposeSubtopic({
      themeId: context.themeId,
      name,
      coreIdea: candidate.coreIdeaServed ?? '',
      pipelineId: context.pipelineId,
    });
    return {
      subtopic: { id: proposed.id, name, ring: 'proposed' },
      outcome: 'held',
      reason: `It widens the area into a new subtopic, "${name}", which waits for your approval in Coverage.`,
    };
  }

  // No subtopic named: the nearest one by meaning stands in, and is not a reason to hold.
  const nearest = screen.nearestSubtopic;
  if (nearest && nearest.score >= context.subtopicMatch && nearest.ring !== 'proposed') {
    return { subtopic: { id: nearest.id, name: nearest.name, ring: nearest.ring }, outcome: null, reason: null };
  }
  return { subtopic: null, outcome: null, reason: null };
}

export async function runTopicScreen(
  pipelineId: number,
  topicSet: TopicResearchSet,
): Promise<{ run: StageRunDto; output: TopicScreenOutput; reused: boolean }> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found.');

  const basedOn = `topic_research:${latestRunId(pipeline.id, pipeline.version, 'topic_research') ?? 'none'}`;
  const existing = reusable<TopicScreenOutput>(pipelineId, 'topic_screen', basedOn);
  if (existing) return { run: existing, output: existing.output as TopicScreenOutput, reused: true };

  const exact = pipeline.topicMode === 'exact';
  const thresholds = getThresholds();
  const candidates = topicSet.candidates?.length ? topicSet.candidates : [topicSet];

  const { run, output } = await asStage<TopicScreenOutput>(pipelineId, 'topic_screen', async () => {
    const screened = await screenTopics(candidates.map(topicText), {
      themeId: pipeline.themeId,
      excludeArticleId: pipeline.articleId,
    });

    const results: TopicScreenResult[] = [];
    const offered: TopicResearch[] = [];
    const offeredOriginalIndex: number[] = [];

    candidates.forEach((candidate, i) => {
      const screen = screened.screens[i];
      const scope = resolveSubtopic(candidate, screen, {
        themeId: pipeline.themeId,
        pipelineId,
        exact,
        subtopicMatch: thresholds.subtopicMatch,
      });

      let outcome: TopicOutcome = 'offered';
      let reason = 'Clear of everything already written.';

      if (screen.verdict === 'duplicate') {
        outcome = 'dropped';
        reason = `Too close to an existing article: ${describeMatch(screen.nearestArticle)}. The limit is ${pct(thresholds.topicStop)}.`;
      } else if (scope.outcome) {
        outcome = scope.outcome;
        reason = scope.reason ?? reason;
      } else if (screen.verdict === 'neighbour') {
        reason = `A close neighbour of ${describeMatch(screen.nearestArticle)}. It may go ahead only as a genuinely different question.`;
      }

      results.push({
        topic: candidate.topic,
        verdict: screen.verdict,
        outcome,
        reason,
        subtopic: scope.subtopic,
        nearestArticle: screen.nearestArticle,
        nearestPoint: screen.nearestPoint,
      });

      if (outcome !== 'offered') return;

      // A neighbour goes ahead carrying the comparison, so the writer is told
      // which article it must not become and must link to.
      const near = screen.nearestArticle;
      offered.push(
        screen.verdict === 'neighbour' && near
          ? {
              ...candidate,
              contentGap: `${candidate.contentGap}\n\nCynth's coverage check: the closest existing article is "${near.title}" (similarity ${pct(near.score)}). This article must answer a different question from that one, say so early, and link to it rather than repeat it.`.trim(),
            }
          : candidate,
      );
      offeredOriginalIndex.push(i);
    });

    let screenedSet: TopicResearchSet | null = null;
    let stopReason: string | null = null;

    if (offered.length) {
      const recommended = offeredOriginalIndex.indexOf(topicSet.recommendedIndex ?? 0);
      const recommendedIndex = recommended >= 0 ? recommended : 0;
      screenedSet = { ...offered[recommendedIndex], candidates: offered, recommendedIndex };
    } else {
      const dropped = results.filter((r) => r.outcome === 'dropped').length;
      const held = results.filter((r) => r.outcome === 'held').length;
      stopReason = exact
        ? `This topic is already covered: ${results[0]?.reason ?? ''} Cynth stops here and nothing is written.`
        : `None of the ${results.length} researched topics can be written: ${dropped} too close to existing articles` +
          `${held ? `, ${held} waiting for a new subtopic to be approved in Coverage` : ''}. Nothing was written.`;
    }

    return {
      output: { basedOn, screened: screenedSet, results, stopReason },
      recorded: { promptTokens: screened.promptTokens, reportedCost: screened.reportedCost, model: screened.model },
    };
  });

  if (output.stopReason) stop(pipelineId, 'topic_screen', output.stopReason);
  else setState(pipelineId, STAGE_DEFINITIONS.topic_screen.completeState, { stage: 'topic_screen' });

  return { run, output, reused: false };
}

/* --------------------------------------------------------- section gate --- */

export interface SectionScreenOutput {
  basedOn: string;
  /** The chosen topic, checked again: an editor's own topic has not been through the topic gate. */
  topic: TopicScreen | null;
  sections: SectionScreen[];
  cutShare: number;
  stopReason: string | null;
}

export async function runSectionScreen(
  pipelineId: number,
  research: TopicResearch,
  keywords: KeywordResearch,
): Promise<{ run: StageRunDto; output: SectionScreenOutput; reused: boolean }> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found.');

  const basedOn = `keyword_research:${latestRunId(pipeline.id, pipeline.version, 'keyword_research') ?? 'none'}|${research.topic}|${keywords.recommendedTitle}`;
  const existing = reusable<SectionScreenOutput>(pipelineId, 'section_screen', basedOn);
  if (existing) return { run: existing, output: existing.output as SectionScreenOutput, reused: true };

  const thresholds = getThresholds();
  const planned: PlannedSection[] = keywords.recommendedSections?.length
    ? keywords.recommendedSections
    : keywords.recommendedHeadings.map((heading) => ({ heading, covers: '' }));

  const { run, output } = await asStage<SectionScreenOutput>(pipelineId, 'section_screen', async () => {
    const topic = await screenTopics([topicText(research)], {
      themeId: pipeline.themeId,
      excludeArticleId: pipeline.articleId,
    });
    const topicScreen = topic.screens[0] ?? null;

    const sections = await screenSections(planned, { excludeArticleId: pipeline.articleId });
    const cut = sections.screens.filter((s) => s.verdict === 'cut');
    const cutShare = planned.length ? cut.length / planned.length : 0;

    let stopReason: string | null = null;
    if (topicScreen?.verdict === 'duplicate') {
      stopReason = `The chosen topic is too close to an existing article: ${describeMatch(topicScreen.nearestArticle)}. Cynth stops before drafting and nothing is written.`;
    } else if (cutShare > thresholds.maxCutShare) {
      stopReason =
        `${cut.length} of ${planned.length} planned sections are already written elsewhere ` +
        `(${cut.map((s) => `"${s.heading}" ≈ ${describeMatch(s.match)}`).join('; ')}). ` +
        `That is more than ${Math.round(thresholds.maxCutShare * 100)}% of the article, so Cynth stops before drafting and nothing is written.`;
    }

    return {
      output: { basedOn, topic: topicScreen, sections: sections.screens, cutShare, stopReason },
      recorded: {
        promptTokens: topic.promptTokens + sections.promptTokens,
        reportedCost:
          topic.reportedCost === null && sections.reportedCost === null
            ? null
            : (topic.reportedCost ?? 0) + (sections.reportedCost ?? 0),
        model: sections.model,
      },
    };
  });

  if (output.stopReason) stop(pipelineId, 'section_screen', output.stopReason);
  else setState(pipelineId, STAGE_DEFINITIONS.section_screen.completeState, { stage: 'section_screen' });

  return { run, output, reused: false };
}

/** What the brief carries from the section gate. */
export interface BriefCoverage {
  /** Sections cut because they are already written, with where. */
  alreadyCovered: { heading: string; match: CoverageMatch }[];
  /** The article this one must not become, when the topic is a close neighbour. */
  neighbour: CoverageMatch | null;
}

export function briefCoverageFrom(screen: SectionScreenOutput | null): BriefCoverage | null {
  if (!screen) return null;
  const alreadyCovered = screen.sections
    .filter((s): s is SectionScreen & { match: CoverageMatch } => s.verdict === 'cut' && s.match !== null)
    .map((s) => ({ heading: s.heading, match: s.match }));
  const neighbour = screen.topic?.verdict === 'neighbour' ? screen.topic.nearestArticle : null;
  return alreadyCovered.length || neighbour ? { alreadyCovered, neighbour } : null;
}

/** The writer's instructions for what is already on the site. */
export function describeBriefCoverage(coverage: BriefCoverage | null | undefined): string {
  if (!coverage) return '';
  const link = (m: CoverageMatch) => (m.url ? `[${m.title}](${m.url})` : `"${m.title}" (not yet published, so name it without a link)`);
  const lines = ['=== ALREADY COVERED ON THIS SITE ==='];
  if (coverage.neighbour) {
    lines.push(
      `The closest existing article is ${link(coverage.neighbour)}. This article answers a different question: say so early, link to it once, and do not re-explain what it covers.`,
    );
  }
  if (coverage.alreadyCovered.length) {
    lines.push(
      'These planned sections were removed because existing articles already explain them. Do not write a section on any of them. Where the reader needs the point, give it in one sentence and link:',
    );
    for (const entry of coverage.alreadyCovered) {
      lines.push(`- "${entry.heading}" → ${link(entry.match)}${entry.match.heading ? `, section "${entry.match.heading}"` : ''}`);
    }
  }
  lines.push('Every section you write is compared against the whole site afterwards; one that repeats an existing article blocks publication.', '');
  return lines.join('\n');
}

/* ----------------------------------------------------------- draft gate --- */

export interface DraftScreenOutput {
  basedOn: string;
  overlaps: DraftOverlap[];
  checked: number;
}

export async function runDraftScreen(
  pipelineId: number,
  markdown: string,
): Promise<{ run: StageRunDto; output: DraftScreenOutput; reused: boolean }> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found.');

  const basedOn = `article_generation:${latestRunId(pipeline.id, pipeline.version, 'article_generation') ?? 'none'}`;
  const existing = reusable<DraftScreenOutput>(pipelineId, 'draft_screen', basedOn);
  if (existing) return { run: existing, output: existing.output as DraftScreenOutput, reused: true };

  const { run, output } = await asStage<DraftScreenOutput>(pipelineId, 'draft_screen', async () => {
    const result = await screenDraft(markdown, { excludeArticleId: pipeline.articleId });
    return {
      output: { basedOn, overlaps: result.overlaps, checked: result.checked },
      recorded: { promptTokens: result.promptTokens, reportedCost: result.reportedCost, model: result.model },
    };
  });

  setState(pipelineId, STAGE_DEFINITIONS.draft_screen.completeState, {
    stage: 'draft_screen',
    note: output.overlaps.length
      ? `${output.overlaps.length} section(s) repeat existing articles; sent to the reviewer as required changes.`
      : 'No drafted section repeats an existing article.',
  });

  return { run, output, reused: false };
}

/** The reviewer is told, and the review carries each overlap as a major issue it cannot waive. */
export function describeDraftOverlaps(overlaps: DraftOverlap[]): string {
  if (!overlaps.length) return '';
  return [
    '=== REPEATS EXISTING ARTICLES (measured, not a judgement call) ===',
    'Cynth compared every section of this draft with every article already on the site. These sections repeat one. Each is a required change: cut the repeated explanation to one sentence that links to the existing article, and use the space for what this article adds.',
    ...overlaps.map(
      (o) => `- "${o.heading}" repeats ${describeMatch(o.match)}${o.match.url ? ` — ${o.match.url}` : ''}`,
    ),
    '',
  ].join('\n');
}

export function coverageIssuesFor(overlaps: DraftOverlap[]) {
  return overlaps.map((o) => ({
    severity: 'major' as const,
    section: o.parentHeading ?? o.heading,
    problem: `Repeats an existing article: ${describeMatch(o.match)}.`,
    requiredChange: `Cut the repeated explanation in "${o.heading}" to one sentence that links to ${o.match.url ?? `"${o.match.title}"`}, and use the space for what this article adds.`,
    scope: 'passage' as const,
  }));
}

/**
 * The last word, after any revision: the article as it will be published,
 * against every other article. A blocking finding stops publication.
 */
export async function finalCoverageFindings(pipelineId: number): Promise<ValidationFinding[]> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return [];
  const row = getDatabase().prepare('SELECT content FROM articles WHERE id = ?').get(pipeline.articleId) as
    | { content: string | null }
    | undefined;
  if (!row?.content?.trim()) return [];

  await syncCoverageGraph();
  const result = await screenDraft(row.content, { excludeArticleId: pipeline.articleId });
  return result.overlaps.map((o) => ({
    severity: 'blocking' as const,
    check: 'repeats existing article',
    detail: `"${o.heading}" repeats ${describeMatch(o.match)}. Rewrite it to link to that article instead.`,
  }));
}
