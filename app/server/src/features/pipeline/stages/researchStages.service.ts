import { runStage } from '../stageRunner.service.js';
import type { StageResult } from '../stageRunner.service.js';
import { getPipelineById, setState } from '../pipeline.repository.js';
import { ARTICLE_TYPE_SLUGS, STAGE_DEFINITIONS } from '../pipeline.constants.js';
import type { TopicMode } from '../pipeline.constants.js';
import { isSpendRefusal } from '../../generation/generation.errors.js';
import { getThemeById, getProjectById } from '../../content/content.repository.js';
import { getArticleById } from '../../articles/articles.repository.js';

/**
 * THE RESEARCH STAGES — topic research, keyword/title research, and article
 * classification.
 *
 * Each one does the same three things and nothing else: assemble a prompt from
 * persisted configuration, hand it to the stage runner, and validate the
 * structured reply. The runner owns idempotency, the spend gate, fallback and
 * cost accounting, so none of that is repeated here.
 *
 * Every stage returns STRUCTURED, PERSISTED data. Topic research in particular
 * is not discarded once an article exists — it is the record of why this
 * article was worth producing, and later stages read it rather than re-deriving
 * it from the finished text.
 */

/**
 * How many topics the shortlist offers.
 *
 * This is the single most expensive number in the pipeline. Topic research
 * runs on the premium model, and its cost is almost entirely output tokens —
 * so asking for four researched topics instead of two roughly doubles the
 * most expensive research stage. Two is the house default: enough to be a
 * genuine choice, cheap enough to run on every article.
 *
 * Changing it changes the prompt, the assumed output budget and the cost
 * together, which is why it lives in one place.
 */
export const TOPIC_CANDIDATES = 2;

/** Output budget for the estimate, scaled to the number of topics asked for. */
const TOKENS_PER_TOPIC = 1000;
const TOPIC_RESEARCH_OVERHEAD_TOKENS = 200;

const RESEARCH_TIMEOUT_MS = 180_000;
const SEO_TIMEOUT_MS = 120_000;
const CLASSIFY_TIMEOUT_MS = 60_000;

/* --------------------------------------------------------------- shared --- */

/** Strips a code fence and returns the first JSON object. Models wrap JSON more often than not. */
function readJsonObject(text: string): Record<string, unknown> {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object was found in the reply');

  const parsed = JSON.parse(withoutFence.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the reply was not a JSON object');
  return parsed as Record<string, unknown>;
}

function str(source: Record<string, unknown>, key: string, options: { required?: boolean; max?: number } = {}): string {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) {
    if (options.required) throw new Error(`"${key}" was missing`);
    return '';
  }
  return value.trim().slice(0, options.max ?? 4000);
}

function strList(source: Record<string, unknown>, key: string, max = 25): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 300))
    .slice(0, max);
}

/** The editorial context every research stage is given. Read from configuration, never invented. */
function themeContext(pipelineId: number): { themeName: string; themeGuidance: string; projectRules: string } {
  const pipeline = getPipelineById(pipelineId);
  const theme = pipeline?.themeId ? getThemeById(pipeline.themeId) : null;
  const article = pipeline ? getArticleById(pipeline.articleId) : null;
  const project = article?.projectId ? getProjectById(article.projectId) : null;

  return {
    themeName: theme?.name ?? '',
    themeGuidance: theme?.description ?? '',
    projectRules: project?.editorialGuidance ?? '',
  };
}

/* ------------------------------------------------------- topic research --- */

export interface TopicResearch {
  topic: string;
  theme: string;
  researchSummary: string;
  whyNow: string;
  audience: string;
  searchOpportunity: string;
  commercialOpportunity: string;
  contentGap: string;
  likelySearchIntent: string;
  recommendedAngle: string;
  competingContentObservations: string[];
  researchSources: { url: string; title: string; note: string }[];
}

/**
 * What topic research actually returns (Milestone 24).
 *
 * A SHORTLIST plus a recommendation, flattened so that the recommended topic
 * is also readable at the top level. The flattening is not cosmetic: every
 * downstream stage takes one TopicResearch, and an automatic run must be able
 * to keep using this output without knowing a choice was ever on offer.
 *
 * A guided run reads `candidates` and asks. An automatic run reads the top
 * level and proceeds. Neither needs a special case.
 */
export interface TopicResearchSet extends TopicResearch {
  candidates: TopicResearch[];
  recommendedIndex: number;
}

function buildTopicResearchPrompt(pipelineId: number, seedTopic: string | null, topicMode: TopicMode): string {
  const { themeName, themeGuidance, projectRules } = themeContext(pipelineId);

  return [
    'You are a senior editorial researcher for a consumer publication. Your job is to decide whether a topic is genuinely worth producing, and to find the strongest angle if it is.',
    '',
    '=== RULES ===',
    'Judge the opportunity honestly. If a topic is saturated, low-value or does not serve the audience, say so in the research summary rather than manufacturing enthusiasm.',
    'Do not invent statistics, studies, traffic numbers or keyword volumes. Where you are reasoning from general knowledge rather than a specific source, say so.',
    'Only list a source you can actually name. An empty source list is better than a fabricated URL.',
    '',
    '=== THEMATIC AREA ===',
    themeName ? `Area: ${themeName}` : 'Area: not specified.',
    themeGuidance ? `Area guidance: ${themeGuidance}` : '',
    projectRules ? `Publication editorial rules: ${projectRules}` : '',
    '',
    '=== BRIEF ===',
    // EXACT is a different job from EXPLORE, not a stricter version of it.
    // Exploring asks "what should we write here?"; exact asks "this is what we
    // are writing — is it any good, and what is the strongest way to do it?"
    // Substituting an adjacent subject is a failure of the second, however
    // promising the substitute.
    ...(topicMode === 'exact' && seedTopic
      ? [
          `The editor has already decided the subject: "${seedTopic}".`,
          'Research THIS subject. Do not propose alternatives, do not broaden it into a more general article, and do not narrow it into one sub-part. Return exactly one topic, and it must be the subject as stated.',
          'You may sharpen the wording and you must choose the strongest angle within it — that is what the angle field is for — but the article that results has to be recognisably the one the editor asked for.',
          'Research it honestly. If the subject is weak, saturated or hard to serve well, say so plainly in the research summary and in the content gap. Being told to write something is not a reason to pretend it is a good idea.',
        ]
      : [
          seedTopic
            ? `The editor has proposed this direction: "${seedTopic}". Propose ${TOPIC_CANDIDATES} distinct topics within it, each a genuinely different article rather than the same one reworded.`
            : `No topic has been proposed. Propose ${TOPIC_CANDIDATES} distinct topics worth producing in this thematic area right now.`,
          `They must be real alternatives: different questions, different angles, or different points in the buying decision. ${TOPIC_CANDIDATES} rewordings of one idea is not ${TOPIC_CANDIDATES} options.`,
          `If fewer than ${TOPIC_CANDIDATES} are genuinely worth producing, return only the ones that are. A short honest list beats a padded one.`,
          'Rank them, and say which you would produce first.',
        ]),
    '',
    '=== OUTPUT ===',
    'Reply with JSON only. No commentary, no code fence.',
    '{',
    '  "recommended_index": 0,',
    '  "topics": [',
    '    {',
    '  "topic": "the topic, as a specific subject rather than a title",',
    '  "theme": "the thematic area",',
    '  "research_summary": "what you found, including anything that argues against producing this",',
    '  "why_now": "what makes this timely, or plainly state that it is evergreen",',
    '  "audience": "who specifically this is for",',
    '  "search_opportunity": "the demand picture, and how confident you are in it",',
    '  "commercial_opportunity": "whether this can carry product recommendations honestly, and which kinds",',
    '  "content_gap": "what existing coverage fails to do",',
    '  "likely_search_intent": "informational | commercial | transactional | navigational, with a short reason",',
    '  "recommended_angle": "the specific angle you would take",',
    '  "competing_content_observations": ["what the existing coverage looks like"],',
    '  "research_sources": [{"url": "", "title": "", "note": "why it mattered"}]',
    '    }',
    '  ]',
    '}',
    '',
    topicMode === 'exact' && seedTopic
      ? 'The "topics" array carries exactly one object, with the full set of fields above. Keep each field to a few sentences. "recommended_index" is 0.'
      : `Every object inside "topics" carries the full set of fields above. Keep each field to a few sentences: ${TOPIC_CANDIDATES} researched options, not ${TOPIC_CANDIDATES} essays. "recommended_index" is the position of the one you would produce first.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function readTopicCandidate(json: Record<string, unknown>): TopicResearch {
  return {
    topic: str(json, 'topic', { required: true, max: 300 }),
    theme: str(json, 'theme', { max: 200 }),
    researchSummary: str(json, 'research_summary', { required: true }),
    whyNow: str(json, 'why_now'),
    audience: str(json, 'audience'),
    searchOpportunity: str(json, 'search_opportunity'),
    commercialOpportunity: str(json, 'commercial_opportunity'),
    contentGap: str(json, 'content_gap'),
    likelySearchIntent: str(json, 'likely_search_intent', { max: 200 }),
    recommendedAngle: str(json, 'recommended_angle', { required: true }),
    competingContentObservations: strList(json, 'competing_content_observations'),
    researchSources: Array.isArray(json.research_sources)
      ? (json.research_sources as unknown[])
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => ({
            url: typeof entry.url === 'string' ? entry.url.slice(0, 1000) : '',
            title: typeof entry.title === 'string' ? entry.title.slice(0, 300) : '',
            note: typeof entry.note === 'string' ? entry.note.slice(0, 500) : '',
          }))
          .slice(0, 20)
      : [],
  };
}

/**
 * Reads the shortlist.
 *
 * Two shapes are accepted, and the second is not leniency about a malformed
 * reply. A model that concludes only ONE topic in this area is worth
 * producing, and answers with that one topic, has given a legitimate answer
 * to the question asked. It is read as a shortlist of one rather than
 * rejected. What is NOT accepted is a topic missing its required fields —
 * that still fails the stage, exactly as before.
 */
function parseTopicResearch(text: string): TopicResearchSet {
  const json = readJsonObject(text);
  const raw = json.topics;

  const candidates = Array.isArray(raw)
    ? (raw as unknown[])
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .slice(0, 6)
        .map(readTopicCandidate)
    : [readTopicCandidate(json)];

  if (candidates.length === 0) throw new Error('no topics were proposed');

  const claimed = typeof json.recommended_index === 'number' ? Math.trunc(json.recommended_index) : 0;
  // An out-of-range recommendation is corrected rather than trusted: a model
  // pointing at a topic it did not write must not silently select nothing.
  const recommendedIndex = claimed >= 0 && claimed < candidates.length ? claimed : 0;

  return { ...candidates[recommendedIndex], candidates, recommendedIndex };
}

export async function runTopicResearch(
  pipelineId: number,
  options: { seedTopic?: string | null; confirmedCost?: boolean; rerun?: boolean } = {},
): Promise<StageResult> {
  const definition = STAGE_DEFINITIONS.topic_research;
  // Captured before the stage announces itself, so a refused spend gate
  // can put the run back rather than leaving it reading as running.
  const stateBeforeStage = getPipelineById(pipelineId)?.state ?? null;

  // Read from the run rather than passed in, so it survives a resume: a run
  // picked up days later researches the subject the editor decided on, not
  // whatever the default happens to be at that moment.
  const seedTopic = options.seedTopic ?? null;
  const topicMode = getPipelineById(pipelineId)?.topicMode ?? 'explore';
  const topicCount = topicMode === 'exact' && seedTopic ? 1 : TOPIC_CANDIDATES;

  setState(pipelineId, definition.runningState, { stage: 'topic_research' });

  try {
    const result = await runStage({
      pipelineId,
      stage: 'topic_research',
      prompt: buildTopicResearchPrompt(pipelineId, seedTopic, topicMode),
      parse: parseTopicResearch,
      timeoutMs: RESEARCH_TIMEOUT_MS,
      // Scaled to what the prompt actually asks for, so the figure the spend
      // gate shows moves with the prompt rather than drifting away from it.
      // An exact run researches one topic, so budgeting for the full shortlist
      // would overstate the cost the user is being asked to confirm.
      assumedCompletionTokens: topicCount * TOKENS_PER_TOPIC + TOPIC_RESEARCH_OVERHEAD_TOKENS,
      confirmedCost: options.confirmedCost,
      rerun: options.rerun,
    });

    setState(pipelineId, definition.completeState, { stage: 'topic_research' });
    return result;
  } catch (error) {
    // Declining to spend is not a failed stage. Nothing was called and nothing
    // was charged — so the run is put back exactly where it was, rather than
    // left reading as in-progress while it waits for an answer, and never
    // moved to the terminal FAILED state.
    if (isSpendRefusal(error)) {
      if (stateBeforeStage) setState(pipelineId, stateBeforeStage, { stage: null });
      throw error;
    }

    setState(pipelineId, 'FAILED', {
      stage: 'topic_research',
      note: error instanceof Error ? error.message : 'Topic research failed.',
    });
    throw error;
  }
}

/* ----------------------------------------------------- keyword & title --- */

export interface KeywordResearch {
  primaryKeyword: string;
  secondaryKeywords: string[];
  longTailKeywords: string[];
  semanticTerms: string[];
  entities: string[];
  relatedQuestions: string[];
  searchIntent: string;
  commercialIntent: string;
  titleCandidates: string[];
  recommendedTitle: string;
  recommendedHeadings: string[];
  seoNotes: string[];
  sources: string[];
}

function buildKeywordPrompt(research: TopicResearch): string {
  return [
    'You are an SEO analyst. You are given completed topic research and must turn it into a keyword and title plan.',
    '',
    '=== RULES ===',
    'Work only from the research below. Do not invent search volumes, difficulty scores or ranking data — if you have no reliable figure, describe the opportunity qualitatively instead.',
    'Keywords must read as things a person would actually type. Reject phrasing that only exists to carry a keyword.',
    'Titles must describe the article honestly. No curiosity gaps, no fabricated numbers, no superlatives the article cannot support.',
    '',
    '=== TOPIC RESEARCH ===',
    `Topic: ${research.topic}`,
    `Theme: ${research.theme}`,
    `Audience: ${research.audience}`,
    `Angle: ${research.recommendedAngle}`,
    `Search opportunity: ${research.searchOpportunity}`,
    `Commercial opportunity: ${research.commercialOpportunity}`,
    `Content gap: ${research.contentGap}`,
    `Likely search intent: ${research.likelySearchIntent}`,
    `Research summary: ${research.researchSummary}`,
    '',
    '=== OUTPUT ===',
    'Reply with JSON only. No commentary, no code fence.',
    '{',
    '  "primary_keyword": "",',
    '  "secondary_keywords": [],',
    '  "long_tail_keywords": [],',
    '  "semantic_terms": [],',
    '  "entities": [],',
    '  "related_questions": [],',
    '  "search_intent": "",',
    '  "commercial_intent": "",',
    '  "title_candidates": ["four to six options"],',
    '  "recommended_title": "",',
    '  "recommended_headings": ["the H2s you would use"],',
    '  "seo_notes": ["anything the writer should know"],',
    '  "sources": []',
    '}',
  ].join('\n');
}

function parseKeywordResearch(text: string): KeywordResearch {
  const json = readJsonObject(text);

  return {
    primaryKeyword: str(json, 'primary_keyword', { required: true, max: 200 }),
    secondaryKeywords: strList(json, 'secondary_keywords'),
    longTailKeywords: strList(json, 'long_tail_keywords'),
    semanticTerms: strList(json, 'semantic_terms', 40),
    entities: strList(json, 'entities', 40),
    relatedQuestions: strList(json, 'related_questions'),
    searchIntent: str(json, 'search_intent', { max: 300 }),
    commercialIntent: str(json, 'commercial_intent', { max: 300 }),
    titleCandidates: strList(json, 'title_candidates', 10),
    recommendedTitle: str(json, 'recommended_title', { required: true, max: 300 }),
    recommendedHeadings: strList(json, 'recommended_headings', 20),
    seoNotes: strList(json, 'seo_notes'),
    sources: strList(json, 'sources'),
  };
}

export async function runKeywordResearch(
  pipelineId: number,
  research: TopicResearch,
  options: { confirmedCost?: boolean; rerun?: boolean } = {},
): Promise<StageResult> {
  const definition = STAGE_DEFINITIONS.keyword_research;
  // Captured before the stage announces itself, so a refused spend gate
  // can put the run back rather than leaving it reading as running.
  const stateBeforeStage = getPipelineById(pipelineId)?.state ?? null;
  setState(pipelineId, definition.runningState, { stage: 'keyword_research' });

  try {
    const result = await runStage({
      pipelineId,
      stage: 'keyword_research',
      prompt: buildKeywordPrompt(research),
      parse: parseKeywordResearch,
      timeoutMs: SEO_TIMEOUT_MS,
      assumedCompletionTokens: 1200,
      confirmedCost: options.confirmedCost,
      rerun: options.rerun,
    });

    setState(pipelineId, definition.completeState, { stage: 'keyword_research' });
    return result;
  } catch (error) {
    // Declining to spend is not a failed stage. Nothing was called and nothing
    // was charged — so the run is put back exactly where it was, rather than
    // left reading as in-progress while it waits for an answer, and never
    // moved to the terminal FAILED state.
    if (isSpendRefusal(error)) {
      if (stateBeforeStage) setState(pipelineId, stateBeforeStage, { stage: null });
      throw error;
    }

    setState(pipelineId, 'FAILED', {
      stage: 'keyword_research',
      note: error instanceof Error ? error.message : 'Keyword research failed.',
    });
    throw error;
  }
}

/* ------------------------------------------------------- classification --- */

export interface ArticleClassification {
  articleType: string;
  confidence: number;
  primaryIntent: string;
  secondaryIntent: string;
  reasoningSummary: string;
}

function buildClassificationPrompt(research: TopicResearch, keywords: KeywordResearch): string {
  return [
    'You are classifying an article before it is written, so the right structural template can be chosen.',
    '',
    '=== RULES ===',
    'Choose exactly one type, from the list below and nothing else.',
    'Confidence is your own honest estimate between 0 and 1. A genuinely ambiguous topic should score low rather than be forced into a confident answer.',
    '',
    '=== AVAILABLE TYPES ===',
    ARTICLE_TYPE_SLUGS.join(', '),
    '',
    '=== THE ARTICLE ===',
    `Topic: ${research.topic}`,
    `Angle: ${research.recommendedAngle}`,
    `Audience: ${research.audience}`,
    `Recommended title: ${keywords.recommendedTitle}`,
    `Search intent: ${keywords.searchIntent || research.likelySearchIntent}`,
    `Commercial intent: ${keywords.commercialIntent}`,
    `Content gap: ${research.contentGap}`,
    '',
    '=== OUTPUT ===',
    'Reply with JSON only. No commentary, no code fence.',
    '{',
    '  "article_type": "one of the types listed above",',
    '  "confidence": 0.0,',
    '  "primary_intent": "",',
    '  "secondary_intent": "",',
    '  "reasoning_summary": "why this type, in two sentences"',
    '}',
  ].join('\n');
}

function parseClassification(text: string): ArticleClassification {
  const json = readJsonObject(text);

  const articleType = str(json, 'article_type', { required: true, max: 60 }).toLowerCase();
  // A type outside the list is a failed classification, not something to
  // coerce: silently mapping it would choose a template on a guess.
  if (!(ARTICLE_TYPE_SLUGS as readonly string[]).includes(articleType)) {
    throw new Error(`"${articleType}" is not one of the available article types`);
  }

  const rawConfidence = json.confidence;
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0;

  return {
    articleType,
    confidence,
    primaryIntent: str(json, 'primary_intent', { max: 200 }),
    secondaryIntent: str(json, 'secondary_intent', { max: 200 }),
    reasoningSummary: str(json, 'reasoning_summary', { max: 1000 }),
  };
}

export async function runClassification(
  pipelineId: number,
  research: TopicResearch,
  keywords: KeywordResearch,
  options: { confirmedCost?: boolean; rerun?: boolean } = {},
): Promise<StageResult> {
  const definition = STAGE_DEFINITIONS.article_classification;
  // Captured before the stage announces itself, so a refused spend gate
  // can put the run back rather than leaving it reading as running.
  const stateBeforeStage = getPipelineById(pipelineId)?.state ?? null;
  setState(pipelineId, definition.runningState, { stage: 'article_classification' });

  try {
    const result = await runStage({
      pipelineId,
      stage: 'article_classification',
      prompt: buildClassificationPrompt(research, keywords),
      parse: parseClassification,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      assumedCompletionTokens: 300,
      confirmedCost: options.confirmedCost,
      rerun: options.rerun,
    });

    setState(pipelineId, definition.completeState, { stage: 'article_classification' });
    return result;
  } catch (error) {
    // Declining to spend is not a failed stage. Nothing was called and nothing
    // was charged — so the run is put back exactly where it was, rather than
    // left reading as in-progress while it waits for an answer, and never
    // moved to the terminal FAILED state.
    if (isSpendRefusal(error)) {
      if (stateBeforeStage) setState(pipelineId, stateBeforeStage, { stage: null });
      throw error;
    }

    setState(pipelineId, 'FAILED', {
      stage: 'article_classification',
      note: error instanceof Error ? error.message : 'Classification failed.',
    });
    throw error;
  }
}
