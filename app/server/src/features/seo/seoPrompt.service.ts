import type { ArticleDraftDto } from '../articles/articles.repository.js';
import type { GenerationContext } from '../generation/generationContext.service.js';
import type { ArticleSeoRecord } from './seo.repository.js';
import { SEARCH_INTENT_LABELS } from './seo.constants.js';
import type { SeoDocument } from './seoDocument.js';
import type { SeoDiagnostics } from './seo.types.js';

/**
 * THE SEO ANALYSIS PROMPT.
 *
 * A second prompt builder, for a genuinely different job. The article Prompt
 * Builder (Milestone 7) tells a model how to WRITE as an author; this one
 * tells a model how to REVIEW what was written, and the two must not share a
 * prompt — an analysis prompt that carried the author's voice instructions
 * would produce an analysis written in that voice rather than about it.
 *
 * What it does share is the editorial context. The reviewing model sees the
 * same project, thematic area, topic, author persona and article type the
 * writing model saw, because "does this article do its job" is unanswerable
 * without knowing what its job was.
 *
 * Nothing here calls a model. It returns text.
 */

/** Bump when the sections or the response contract change materially. */
export const SEO_PROMPT_VERSION = '1';

export interface SeoPromptInput {
  article: ArticleDraftDto;
  seo: ArticleSeoRecord;
  context: GenerationContext;
  document: SeoDocument;
  diagnostics: SeoDiagnostics;
  /** Cynth's other articles, so internal links can only ever reference real content. */
  linkableArticles: { id: number; title: string; topic: string | null }[];
  /** Deterministic findings already known, so the model does not repeat them. */
  knownFindingSummaries: string[];
}

export interface AssembledSeoPrompt {
  prompt: string;
  characterCount: number;
  wordCount: number;
  promptVersion: string;
}

function field(label: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

function compact(lines: (string | null)[]): string {
  return lines.filter((line): line is string => line !== null && line !== '').join('\n');
}

function section(title: string, body: string): string {
  return `=== ${title} ===\n${body}`;
}

/**
 * THE RESPONSE CONTRACT.
 *
 * Strict JSON, with a fixed vocabulary for every classified field, so the
 * response can be validated rather than interpreted. Anything the model
 * returns that does not fit is dropped — see parseSeoAnalysisResponse() — and
 * a response that cannot be parsed at all is recorded as a failure rather
 * than salvaged into findings that were never really made.
 */
const RESPONSE_CONTRACT = `Return ONLY a single JSON object. No prose before or after it, and no code fence.

{
  "intentAssessment": {
    "detectedIntent": "informational | commercial_investigation | transactional | navigational | hybrid",
    "matchesConfiguredIntent": true,
    "satisfiesSearcher": true,
    "reasoning": "string",
    "titleSatisfies": true,
    "introductionSatisfies": true,
    "structureSatisfies": true,
    "contentSatisfies": true,
    "conclusionSatisfies": true,
    "confidence": 0.0
  },
  "findings": [
    {
      "category": "search_intent | title | meta_description | slug | headings | content_depth | topical_coverage | keywords | introduction | conclusion | internal_links | external_links | images | readability | structured_data | citability | experience_signals | configuration",
      "dimension": "search_intent | content_relevance | topical_coverage | on_page | structure | readability | internal_linking | external_authority | technical_metadata | ai_search",
      "severity": "blocking | warning | recommendation | info",
      "summary": "one sentence stating the problem as a fact about this article",
      "explanation": "why it matters for THIS article, given its topic, audience and intent",
      "recommendation": "what to do about it",
      "element": "title | seo_title | meta_description | slug | heading | introduction | section | paragraph | body | images | links | structured_data | config",
      "heading": "the exact heading text this applies under, or null",
      "excerpt": "a short VERBATIM quote from the article showing the passage, or null",
      "confidence": 0.0
    }
  ],
  "topicalCoverage": {
    "coveredConcepts": ["string"],
    "missingConcepts": [
      { "concept": "string", "importance": "essential | valuable | optional", "why": "string", "confidence": 0.0 }
    ],
    "missingQuestions": [{ "question": "string", "why": "string", "confidence": 0.0 }],
    "missingEntities": [{ "entity": "string", "why": "string", "confidence": 0.0 }],
    "relationships": ["string"]
  },
  "titleProposal": { "seoTitle": "string or null", "rationale": "string", "confidence": 0.0 },
  "metaDescriptionProposal": { "metaDescription": "string or null", "rationale": "string", "confidence": 0.0 },
  "slugProposal": { "slug": "string or null", "rationale": "string", "confidence": 0.0 },
  "internalLinkSuggestions": [
    { "targetArticleId": 0, "anchorText": "string", "reason": "string", "confidence": 0.0 }
  ],
  "externalSourceSuggestions": [
    {
      "purpose": "authority | evidence | factual_support | reader_usefulness",
      "claimContext": "the VERBATIM claim in the article that needs support",
      "sourceType": "the KIND of source that would serve, e.g. a national statistics office",
      "suggestedDomain": "a domain, ONLY if you are certain it exists, else null",
      "rationale": "string",
      "confidence": 0.0
    }
  ],
  "imageSuggestions": [
    {
      "placement": "where in the article",
      "purpose": "what the image would do for the reader",
      "altText": "string",
      "filename": "lowercase-hyphenated-filename",
      "caption": "string or null"
    }
  ]
}`;

/**
 * Standing rules for the reviewing model.
 *
 * The prohibitions are the important half. Every one of them corresponds to a
 * way an SEO assistant can quietly do damage: inventing sources, inventing
 * links, rewriting the article, or optimising toward keyword density.
 */
const REVIEW_RULES = [
  'You are an SEO analyst reviewing a draft inside an editorial system. You are not writing the article and you are not editing it.',
  'Judge the article against its stated topic, audience, search intent and article type. A finding that ignores that context is not useful.',
  'DO NOT rewrite the article. Do not return revised body text. Your only concrete proposals are for the SEO title, the meta description, the slug, image alt text, and link suggestions.',
  'DO NOT optimise for keyword density. Never recommend adding a keyword a given number of times, and never treat repetition as an improvement. Judge whether concepts are covered, not whether phrases are repeated.',
  'DO NOT invent facts about the article. Every excerpt you quote must appear verbatim in the text you were given.',
  'DO NOT invent external sources. Suggest the KIND of source that would support a claim. Name a specific domain only if you are certain it exists, and never fabricate a URL, a title, a date, an author, or a statistic. Leave suggestedDomain null when unsure — that is the correct answer, not a failure.',
  'DO NOT invent internal links. You may only suggest linking to articles from the numbered list provided, referenced by their id. Any other id will be discarded.',
  'Distinguish a MISSING IMPORTANT CONCEPT from a MISSING EXACT KEYWORD. The first is a real gap; the second usually is not. Report the first and ignore the second.',
  'Do not repeat findings that are already listed as detected. They have been reported by other means.',
  'Do not recommend a word count. Length is not a quality. Name the specific omission instead.',
  'Judge readability against the stated audience and the author persona, not against a generic reading level.',
  'State a confidence between 0 and 1 on every judgement. Low confidence is acceptable and is used to weight the result; overstating confidence is not.',
  'Severity: "blocking" is reserved for something that makes the article unfit to publish. Use "warning" for a real problem, "recommendation" for an improvement, and "info" for an observation that needs no action.',
  // AI SEARCH READINESS (Milestone 34). Code already checks the mechanical
  // half -- passage length, opening sentences, whether a definition exists.
  // What is left is the semantic half, which is exactly the half a model
  // can actually judge.
  'ASSESS AI SEARCH READINESS, under dimension "ai_search". Two categories, and they ask different questions.',
  '"citability" -- could a passage of this article be quoted BY ITSELF, on a page the reader never sees, and still answer the question it appears to answer? Name the section and say what the quoted passage would be missing. Passage length and opening sentences are already checked by code; do not repeat those.',
  '"experience_signals" -- does this read as written by someone who has actually used, tested or handled the subject? Look for first-hand observation, specific conditions and numbers, named trade-offs, and claims attributed to something. Generic competence is the absence of this signal, not the presence of it.',
  'Do NOT reward citing sources for their own sake, and do NOT ask for credentials the author does not have. An honest "we have not tested this" is a trust signal; an invented one is the opposite. Never recommend claiming experience the article does not evidence.',
].join('\n');

function buildOutline(document: SeoDocument): string {
  if (!document.headings.length) return 'The article has no headings.';
  return document.headings
    .map((heading) => `${'  '.repeat(Math.max(0, heading.level - 1))}H${heading.level}: ${heading.text}`)
    .join('\n');
}

function buildDiagnosticsBlock(diagnostics: SeoDiagnostics): string {
  const keywordLines = diagnostics.keywordUsage.length
    ? diagnostics.keywordUsage
        .map(
          (usage) =>
            `- "${usage.term}" (${usage.role}): ${usage.occurrences} occurrence(s) in the body, ${usage.headingOccurrences} in headings.`,
        )
        .join('\n')
    : '- No target query or supporting terms are configured.';

  return compact([
    `Word count: ${diagnostics.wordCount}`,
    `Sentences: ${diagnostics.sentenceCount}; average ${diagnostics.averageSentenceWords ?? 'n/a'} words`,
    `Paragraphs: ${diagnostics.paragraphCount}; headings: ${diagnostics.headingCount}`,
    `Links: ${diagnostics.internalLinkCount} internal, ${diagnostics.externalLinkCount} external`,
    `Images: ${diagnostics.imageCount} (${diagnostics.imagesMissingAlt} without alt text)`,
    '',
    'Term usage (DIAGNOSTIC ONLY — these counts are not targets and must not be optimised toward):',
    keywordLines,
  ]);
}

export function buildSeoAnalysisPrompt(input: SeoPromptInput): AssembledSeoPrompt {
  const { article, seo, context, document, diagnostics } = input;
  const sections: string[] = [section('ROLE AND RULES', REVIEW_RULES)];

  const editorial = compact([
    field('Project', context.project?.name),
    field('Project editorial rules', context.project?.editorialGuidance),
    field('Thematic area', context.theme?.name),
    field('Thematic area guidance', context.theme?.description),
    field('Topic', context.topic?.title ?? context.article.topicText),
    field('What the topic covers', context.topic?.description),
    field('Topic scope', context.topic?.scope),
    field('Topic key areas', context.topic?.keyAreas),
    field('Topic considerations', context.topic?.considerations),
    field('Explicitly out of scope', context.topic?.exclusions),
    field('Article type', context.articleType?.name),
    field('What this article type is', context.articleType?.description),
  ]);
  if (editorial) sections.push(section('EDITORIAL CONTEXT', editorial));

  if (context.author) {
    // The persona is provided so the reviewer judges the article against the
    // voice it was written in — never so it writes in that voice.
    const persona = compact([
      field('Written as', context.author.name),
      field('Identity', context.author.identity),
      field('Expertise', context.author.expertise),
      field('Perspective', context.author.perspective),
      field('Voice', context.author.voice),
      field('Tone', context.author.tone),
      field('Writes for', context.author.audience),
      field('Editorial principles', context.author.editorialPrinciples),
      field('Boundaries', context.author.boundaries),
      '',
      'Use this to judge whether the article reads as this author and suits this audience. Do NOT adopt this voice in your own output.',
    ]);
    sections.push(section('AUTHOR PERSONA', persona));
  }

  const configuration = compact([
    field('Target search query', seo.configuration.targetQuery) ??
      'Target search query: none set. Analyse this article topically rather than against one phrase.',
    field(
      'Configured search intent',
      seo.configuration.searchIntent ? SEARCH_INTENT_LABELS[seo.configuration.searchIntent] : null,
    ) ?? 'Configured search intent: none set. Infer it and say what you inferred.',
    field('Secondary intents', seo.configuration.secondaryIntents.join(', ')),
    field('Supporting queries', seo.configuration.secondaryKeywords.join(', ')),
    field('Concepts the article should cover', seo.configuration.semanticTopics.join(', ')),
    field('SEO target audience', seo.configuration.targetAudience ?? context.brief.targetAudience),
    field('Geographic target', seo.configuration.geoTarget),
    field('SEO objectives', seo.configuration.seoObjectives),
    field('SEO notes', seo.configuration.notes),
    field('Brief: reader pain points', context.brief.readerPainPoints),
    field('Brief: questions to answer', context.brief.questionsToAnswer),
    field('Brief: important topics', context.brief.importantTopics),
  ]);
  sections.push(section('SEO CONFIGURATION', configuration));

  const metadata = compact([
    field('Article title (the H1)', article.title ?? article.generated?.title),
    field('SEO title', seo.metadata.seoTitle) ?? 'SEO title: not set.',
    field('Meta description', seo.metadata.metaDescription) ?? 'Meta description: not set.',
    field('Slug', seo.metadata.seoSlug ?? article.slug) ?? 'Slug: not set.',
  ]);
  sections.push(section('CURRENT METADATA', metadata));

  sections.push(section('ARTICLE OUTLINE', buildOutline(document)));
  sections.push(section('MEASUREMENTS', buildDiagnosticsBlock(diagnostics)));

  if (input.knownFindingSummaries.length) {
    sections.push(
      section(
        'ALREADY DETECTED — DO NOT REPEAT',
        input.knownFindingSummaries.map((summary) => `- ${summary}`).join('\n'),
      ),
    );
  }

  if (input.linkableArticles.length) {
    sections.push(
      section(
        'ARTICLES AVAILABLE FOR INTERNAL LINKS',
        compact([
          'These are the only articles that exist in this system. Internal link suggestions may reference these ids and nothing else. Any other id will be discarded.',
          ...input.linkableArticles.map(
            (entry) => `- id ${entry.id}: "${entry.title}"${entry.topic ? ` (topic: ${entry.topic})` : ''}`,
          ),
        ]),
      ),
    );
  } else {
    sections.push(
      section(
        'ARTICLES AVAILABLE FOR INTERNAL LINKS',
        'There are no other articles in this system yet. Return an empty internalLinkSuggestions array. Do not suggest linking to pages that do not exist.',
      ),
    );
  }

  sections.push(section('ARTICLE BODY', article.generated?.content?.trim() ?? '(no content)'));
  sections.push(section('RESPONSE FORMAT', RESPONSE_CONTRACT));

  const prompt = sections.join('\n\n');
  const trimmed = prompt.trim();

  return {
    prompt,
    characterCount: prompt.length,
    wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
    promptVersion: SEO_PROMPT_VERSION,
  };
}
