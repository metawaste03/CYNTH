import { describePublicationMarket } from '../../generation/publicationMarket.service.js';
import { getDatabase } from '../../../shared/database/index.js';
import { runStage } from '../stageRunner.service.js';
import type { StageResult } from '../stageRunner.service.js';
import {
  canReview,
  canRevise,
  findCompletedStage,
  getPipelineById,
  incrementReviewCount,
  incrementRevisionCount,
  setState,
} from '../pipeline.repository.js';
import { MAX_AUTOMATIC_REVISIONS, STAGE_DEFINITIONS } from '../pipeline.constants.js';
import { getTemplate } from '../../templates/templates.repository.js';
import { describeLengthBand, lengthBandFor } from '../../templates/articleLength.service.js';
import {
  META_DESCRIPTION_MAX_CHARS,
  META_DESCRIPTION_MIN_CHARS,
  SEO_TITLE_MAX_CHARS,
} from '../../seo/seo.constants.js';
import { getArticleSeo, setSeoMetadataField } from '../../seo/seo.repository.js';
import { refreshArticleSlug } from '../../articles/articles.repository.js';
import type { SectionSchema } from '../../templates/templates.definitions.js';
import { buildGenerationContext } from '../../generation/generationContext.service.js';
import { GenerationError, isSpendRefusal } from '../../generation/generation.errors.js';
import type { ArticleBrief } from './briefStages.service.js';

/**
 * WRITE -> REVIEW -> AT MOST ONE SURGICAL REVISION.
 *
 * The shape of this file is the product decision. There is no loop: the
 * reviewer produces a specification, the revision applies it once, and what
 * follows is deterministic validation rather than another model. Both caps are
 * checked against the database before the stage starts, so no prompt and no
 * caller can talk past them.
 */

const WRITE_TIMEOUT_MS = 300_000;
const REVIEW_TIMEOUT_MS = 180_000;
const REVISE_TIMEOUT_MS = 300_000;

/* ------------------------------------------------------------- the article */

export interface ArticleSection {
  key: string;
  heading: string;
  /** Markdown. The section's own content, without its heading. */
  body: string;
}

export interface GeneratedArticle {
  title: string;
  excerpt: string;
  /**
   * The search-result description.
   *
   * NOT the excerpt, and the difference is the point. The excerpt is a listing
   * blurb for people already on the site; this is the line that has to earn a
   * click from a results page against nine competitors. Written by the writer
   * because the writer is the only stage that has read the finished article.
   *
   * Empty when the model omitted it. Nothing invents one downstream — a
   * fabricated description is worse than letting the search engine pick its
   * own snippet from the text.
   */
  metaDescription: string;
  /**
   * The title as it should appear in a search result.
   *
   * A different job from the headline. The editorial title is the H1 and can
   * take the space it needs to be precise; a SERP title has about 60
   * characters before it is cut off mid-word. Measured on the first nine
   * articles, EIGHT would have been truncated — which is what this field is
   * for.
   *
   * Empty when the editorial title already works at that length. An SEO title
   * that merely repeats the headline is a field to maintain for nothing, and
   * Cynth already falls back to the article title when this is unset.
   */
  seoTitle: string;
  sections: ArticleSection[];
  faq: { question: string; answer: string }[];
  sources: { url: string; title: string }[];
}

function readJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object was found in the reply');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the reply was not a JSON object');
  return parsed as Record<string, unknown>;
}

/** Renders the structured article to the markdown body the CMS push and SEO engine already read. */
export function renderArticleMarkdown(article: GeneratedArticle): string {
  const parts: string[] = [];

  for (const section of article.sections) {
    // The hero is the standfirst, not a heading — it reads as the opening line.
    if (section.key === 'hero') {
      parts.push(section.body.trim());
      continue;
    }
    parts.push(`## ${section.heading}`, section.body.trim());
  }

  if (article.faq.length) {
    parts.push('## FAQ');
    for (const entry of article.faq) parts.push(`### ${entry.question}`, entry.answer.trim());
  }

  if (article.sources.length) {
    parts.push('## Sources');
    parts.push(article.sources.map((source) => `- [${source.title || source.url}](${source.url})`).join('\n'));
  }

  return parts.join('\n\n');
}

function describeSection(section: SectionSchema): string {
  const bits = [`- ${section.key} — "${section.heading}"${section.required ? ' (required)' : ' (optional)'}`, `    ${section.guidance}`];
  if (section.minWords) bits.push(`    At least ${section.minWords} words.`);
  if (section.productPlacement && section.productPlacement !== 'none') {
    bits.push(`    A product may be placed here (${section.productPlacement}) — only where genuinely relevant.`);
  }
  return bits.join('\n');
}

/**
 * The author's voice, in full.
 *
 * This exists because the pipeline used to name these documents and then not
 * send them. The prompt said "the author's full voice documents (X, Y) govern
 * tone, structure and vocabulary — follow them exactly", and the model was
 * never shown X or Y. It was being asked to obey a filename.
 *
 * The result read exactly as you would expect: correct, competent, and
 * indistinguishable from any other model's output. A persona summary of a few
 * hundred characters cannot carry a voice; the documents can, and they were
 * already loaded here — `buildGenerationContext` returns them with their
 * bodies — and then thrown away.
 *
 * Emitted verbatim. Nothing here parses, summarises or trims a voice document:
 * the editor wrote it to be followed, not interpreted.
 */
export function buildVoiceBlock(context: ReturnType<typeof buildGenerationContext>): string {
  if (!context) return '';

  const own = context.author?.skills ?? [];
  const shared = context.sharedSkills;
  if (!own.length && !shared.length) return '';

  const lines: string[] = ['=== VOICE DOCUMENTS ==='];

  if (own.length) {
    lines.push(
      "The author's own voice documents. They govern tone, structure, vocabulary and what this author never does.",
      'Where they conflict with anything summarised elsewhere in this prompt, these win.',
      '',
      ...own.map((skill) => `--- ${skill.name} ---\n${skill.body.trim()}`),
      '',
    );
  }

  if (shared.length) {
    lines.push(
      'Publication-wide editorial guidance, which applies to every author here.',
      '',
      ...shared.map((skill) => `--- ${skill.name} ---\n${skill.body.trim()}`),
      '',
    );
  }

  return lines.join('\n');
}

function buildWriterPrompt(pipelineId: number, brief: ArticleBrief): string {
  const pipeline = getPipelineById(pipelineId)!;
  const template = getTemplate(brief.template.templateId, brief.template.templateVersion);
  if (!template) throw new GenerationError('invalid_configuration', 'The selected template no longer exists.');

  const context = buildGenerationContext(pipeline.articleId);
  const products = context?.products ?? [];

  const productBlock = products.length
    ? [
        '=== PRODUCTS AVAILABLE ===',
        'Options, not requirements. Place one only where the surrounding content is genuinely about the problem it solves. Leaving a product out is a correct outcome.',
        // The long description is usually the manufacturer's own marketing
        // copy. It is the richest source of specifics available -- capacities,
        // materials, compatibility -- and also the most likely thing to drag
        // advertising language into the article if it is echoed rather than
        // read. Both halves of that are said here, because supplying it
        // without saying what it is would be the worse outcome.
        'The description fields are SOURCE MATERIAL, not copy to reuse. "Full description" is usually written by the manufacturer: take the specifics from it — sizes, capacities, materials, what it works with — and state them in your own voice. Never echo its phrasing, its superlatives or its sales framing.',
        'Where the supplied text makes a claim you cannot check, either attribute it ("the manufacturer says...") or leave it out. Do not restate a marketing claim as a finding of fact.',
        // Everything the editor filled in reaches the writer. The fields below
        // the title are what make a placement contextual rather than
        // decorative — "what it is for" is how a model knows which paragraph
        // is already about the problem this product solves — but a product
        // described only in prose must not arrive as a bare name, so the
        // description and the editorial fit are passed too.
        ...products.map((product) =>
          [
            `Product ${product.productId}: ${product.title}`,
            product.brand ? `  Brand: ${product.brand}` : '',
            product.useCase ? `  What it is for: ${product.useCase}` : '',
            product.problemSolved ? `  Problem it addresses: ${product.problemSolved}` : '',
            product.bestFor ? `  Best for: ${product.bestFor}` : '',
            product.keyFeatures.length ? `  Features: ${product.keyFeatures.slice(0, 6).join('; ')}` : '',
            // Both descriptions, labelled for what they are. The long one is
            // usually the manufacturer's own copy and the single richest thing
            // known about a product — which is exactly why it must be framed
            // as source material rather than as prose to echo.
            product.shortDescription ? `  Summary: ${product.shortDescription}` : '',
            product.description && product.description !== product.shortDescription
              ? `  Full description: ${product.description}`
              : '',
            product.editorialFit ? `  Why it fits this publication: ${product.editorialFit}` : '',
            product.editorialNote ? `  Editor's note: ${product.editorialNote}` : '',
            // Stated rather than left to be inferred from an absence. A
            // product Cynth knows nothing about should be placed cautiously
            // or not at all, not placed confidently on a guess.
            !product.useCase &&
            !product.problemSolved &&
            !product.shortDescription &&
            !product.description &&
            !product.editorialFit
              ? '  (Nothing is recorded about what this product is for. Place it only if the article makes its purpose obvious; otherwise leave it out.)'
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
        '',
        'To place a product, put [[product:<id>]] on a line of its own inside the relevant section body. Do not write a URL, a price or an image — Cynth renders the card from its own records.',
        '',
      ].join('\n')
    : '';

  return [
    'You are writing a complete article for a consumer publication, to a fixed structural template.',
    '',
    '=== RULES ===',
    'Write every required section. Use the section keys exactly as given — they are how the article is assembled.',
    'Do not invent facts, statistics, prices, product specifications or sources. Where something cannot be supported, write what can be and say plainly where certainty ends.',
    'Do not write HTML. The website owns presentation; you write the content.',
    'Do not write meta-commentary, and do not mention this brief or these instructions.',
    // Said explicitly because the obvious failure is returning the excerpt
    // twice. They are written for different readers in different places.
    `The meta description is what appears under the title in search results. Write it for someone who has not clicked yet: say what the article settles and who it is for, in ${META_DESCRIPTION_MIN_CHARS}-${META_DESCRIPTION_MAX_CHARS} characters. It is NOT the excerpt reworded, and it must not be a sentence lifted from the article.`,
    // Returning the headline again is the obvious failure, and it is worse
    // than returning nothing: it creates a second field to maintain that says
    // the same thing.
    `The "seo_title" is the same article seen from a results page, where about ${SEO_TITLE_MAX_CHARS} characters survive before it is cut off. Keep the part that makes someone click and drop the part that only makes sense once they have. If the title above is already ${SEO_TITLE_MAX_CHARS} characters or fewer, return an empty string rather than repeating it.`,
    // The instruction that makes the voice documents below matter. Without it
    // they read as background rather than as the thing being asked for.
    'Write as the named author, in the voice of the documents below. Where those documents conflict with any summary in this prompt, the documents win.',
    '',
    '=== AUTHOR ===',
    brief.author.name ? `Writing as: ${brief.author.name}` : 'No author assigned.',
    brief.author.personaSummary ? `Persona: ${brief.author.personaSummary}` : '',
    '',
    // The documents themselves, not their filenames. See buildVoiceBlock.
    buildVoiceBlock(context),
    '=== BRIEF ===',
    `Theme: ${brief.theme}`,
    brief.themeGuidance ? `Theme guidance: ${brief.themeGuidance}` : '',
    `Topic: ${brief.topic}`,
    `Angle: ${brief.recommendedAngle}`,
    `Audience: ${brief.audience}`,
    describePublicationMarket(),
    `Content gap to fill: ${brief.contentGap}`,
    `Search intent: ${brief.searchIntent}`,
    `Commercial intent: ${brief.commercialIntent}`,
    `Working title: ${brief.title}`,
    `Primary keyword: ${brief.primaryKeyword}`,
    brief.secondaryKeywords.length ? `Secondary keywords: ${brief.secondaryKeywords.join(', ')}` : '',
    brief.entities.length ? `Entities to cover: ${brief.entities.join(', ')}` : '',
    brief.recommendedHeadings.length ? `Suggested headings: ${brief.recommendedHeadings.join(' | ')}` : '',
    `Evidence: ${brief.evidenceRequirements}`,
    brief.editorialRules ? `Publication rules: ${brief.editorialRules}` : '',
    '',
    `=== TEMPLATE: ${template.name} (${template.templateId} v${template.version}) ===`,
    // A band rather than a floor. Given only a minimum, a model has exactly
    // one direction to push in, and every article came out long.
    describeLengthBand(lengthBandFor(template.contentSchema)),
    'Sections, in this order:',
    template.contentSchema.sections.map(describeSection).join('\n'),
    '',
    productBlock,
    '=== OUTPUT ===',
    'Reply with JSON only. No commentary, no code fence.',
    '{',
    '  "title": "the final title",',
    '  "excerpt": "one or two sentences for the listing page",',
    `  "meta_description": "the search-result description, ${META_DESCRIPTION_MIN_CHARS}-${META_DESCRIPTION_MAX_CHARS} characters",`,
    `  "seo_title": "the title for search results, at most ${SEO_TITLE_MAX_CHARS} characters — or an empty string if the title above already fits",`,
    '  "sections": [{"key": "must match a key above", "heading": "the heading as written", "body": "markdown, no H1 or H2 — the heading is separate"}],',
    template.contentSchema.requiresFaq
      ? '  "faq": [{"question": "", "answer": ""}],'
      : '  "faq": [],',
    template.contentSchema.requiresSources
      ? '  "sources": [{"url": "", "title": ""}]  // required for this template; do not fabricate'
      : '  "sources": []',
    '}',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * A reply that skipped most of the article is a FAILED generation.
 *
 * Found the expensive way. A writer returned one section of the nine its
 * template requires — syntactically perfect JSON, correct title, correct
 * excerpt, `faq: []`, `sources: []`, and a single hero paragraph — and the
 * stage recorded SUCCESS. 2,028 output tokens where the same template
 * normally draws 7,000 to 10,700. The defect only surfaced downstream, as a
 * reviewer suddenly producing twice the usual volume of corrections, and an
 * editor noticing the reviewer was working too hard.
 *
 * The template has always carried a `required` flag per section. Nothing read
 * it. The only check was that at least ONE section came back, which one did.
 *
 * Failing here rather than saving it means the stage retries and, if the
 * primary model keeps under-delivering, falls back to the one behind it —
 * which is the whole point of having a fallback.
 */
type WriterTemplate = NonNullable<ReturnType<typeof getTemplate>>;

function assertSectionsCovered(article: GeneratedArticle, template: WriterTemplate | null): void {
  if (!template) return;

  const required = template.contentSchema.sections.filter((section) => section.required).map((section) => section.key);
  if (!required.length) return;

  const returned = new Set(article.sections.map((section) => section.key));

  /**
   * Some required sections are delivered by their own top-level field rather
   * than as a body of prose, and always have been: every good article in the
   * library returns `faq` as a list of question/answer pairs and no `faq`
   * section. A coverage check that did not know this would have rejected all
   * of them — caught by running it against the existing articles before it
   * shipped, not by a test.
   */
  if (article.faq.length) returned.add('faq');
  if (article.sources.length) returned.add('sources');

  const missing = required.filter((key) => !returned.has(key));
  if (!missing.length) return;

  throw new Error(
    `the reply is missing ${missing.length} of ${required.length} required sections (${missing.join(', ')})`,
  );
}

export function parseArticle(text: string, template: WriterTemplate | null = null): GeneratedArticle {
  const json = readJsonObject(text);

  const title = typeof json.title === 'string' ? json.title.trim() : '';
  if (!title) throw new Error('"title" was missing');

  const rawSections = Array.isArray(json.sections) ? json.sections : [];
  const sections: ArticleSection[] = rawSections
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      key: typeof entry.key === 'string' ? entry.key.trim() : '',
      heading: typeof entry.heading === 'string' ? entry.heading.trim() : '',
      body: typeof entry.body === 'string' ? entry.body : '',
    }))
    .filter((section) => section.key && section.body.trim());

  if (!sections.length) throw new Error('the reply contained no usable sections');

  const article: GeneratedArticle = {
    title,
    excerpt: typeof json.excerpt === 'string' ? json.excerpt.trim().slice(0, 600) : '',
    // Capped at the SERP limit rather than rejected for being long: an
    // over-long description is still usable and a search engine simply
    // truncates it, whereas discarding it would leave nothing at all.
    // Only kept when it is genuinely shorter than the headline. A model that
    // returns the title again, or something longer, has not done the job, and
    // storing it would make the SERP worse rather than better.
    seoTitle: (() => {
      const proposed = typeof json.seo_title === 'string' ? json.seo_title.trim().replace(/\s+/g, ' ') : '';
      if (!proposed || proposed.length > SEO_TITLE_MAX_CHARS) return '';
      return proposed === title ? '' : proposed;
    })(),
    metaDescription:
      typeof json.meta_description === 'string'
        ? json.meta_description.trim().replace(/\s+/g, ' ').slice(0, META_DESCRIPTION_MAX_CHARS)
        : '',
    sections,
    faq: Array.isArray(json.faq)
      ? (json.faq as unknown[])
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => ({
            question: typeof entry.question === 'string' ? entry.question.trim() : '',
            answer: typeof entry.answer === 'string' ? entry.answer.trim() : '',
          }))
          .filter((entry) => entry.question && entry.answer)
      : [],
    sources: Array.isArray(json.sources)
      ? (json.sources as unknown[])
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => ({
            url: typeof entry.url === 'string' ? entry.url.trim().slice(0, 1000) : '',
            title: typeof entry.title === 'string' ? entry.title.trim().slice(0, 300) : '',
          }))
          .filter((entry) => entry.url)
      : [],
  };

  assertSectionsCovered(article, template);
  return article;
}

/** Persists both representations: structured for validation and WordPress, markdown for what already reads it. */
function saveArticle(articleId: number, article: GeneratedArticle, model: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE articles SET generated_title = ?, excerpt = ?, content = ?, structured_content = ?,
       generated_at = datetime('now'), generated_model = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(article.title, article.excerpt, renderArticleMarkdown(article), JSON.stringify(article), model, articleId);

  // THE SLUG. This write is the first time the article has a title, and the
  // slug is derived from the title — so without this the article has no slug
  // until the server next restarts and the startup backfill happens to catch
  // it. The manual generation path has always done this; the pipeline never
  // did, which is why a freshly generated article reported "no slug".
  refreshArticleSlug(articleId);

  // THE META DESCRIPTION, but never over the top of a human one.
  //
  // An editor who has written their own search-result copy has made a
  // decision, and a regenerate or a revision must not silently replace it.
  // Only an empty field is filled.
  const stored = getArticleSeo(articleId).metadata;

  if (!stored.metaDescription?.trim() && article.metaDescription.trim()) {
    setSeoMetadataField(articleId, 'meta_description', article.metaDescription.trim());
  }

  // Same rule: fill an empty field, never replace a decision someone made.
  if (!stored.seoTitle?.trim() && article.seoTitle.trim()) {
    setSeoMetadataField(articleId, 'seo_title', article.seoTitle.trim());
  }
}

export async function runArticleGeneration(
  pipelineId: number,
  brief: ArticleBrief,
  options: { confirmedCost?: boolean; rerun?: boolean } = {},
): Promise<StageResult> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new GenerationError('invalid_configuration', 'Pipeline not found.');

  // Captured before the stage announces itself, so a refused spend gate
  // can put the run back rather than leaving it reading as running.
  const stateBeforeStage = getPipelineById(pipelineId)?.state ?? null;
  setState(pipelineId, STAGE_DEFINITIONS.article_generation.runningState, { stage: 'article_generation' });

  try {
    const result = await runStage({
      pipelineId,
      stage: 'article_generation',
      prompt: buildWriterPrompt(pipelineId, brief),
      // Bound to the template, so a reply that skips required sections fails
      // the stage and retries rather than being saved as a finished article.
      parse: (text: string) =>
        parseArticle(text, getTemplate(brief.template.templateId, brief.template.templateVersion)),
      timeoutMs: WRITE_TIMEOUT_MS,
      assumedCompletionTokens: 4000,
      confirmedCost: options.confirmedCost,
      rerun: options.rerun,
    });

    saveArticle(pipeline.articleId, result.output as GeneratedArticle, result.run.actualModel ?? '');
    setState(pipelineId, STAGE_DEFINITIONS.article_generation.completeState, { stage: 'article_generation' });
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
      stage: 'article_generation',
      note: error instanceof Error ? error.message : 'Article generation failed.',
    });
    throw error;
  }
}

/* ------------------------------------------------------------- the review */

export interface ReviewIssue {
  severity: 'major' | 'minor';
  section: string;
  problem: string;
  requiredChange: string;
  scope: 'section_only' | 'passage' | 'structural';
  passage?: string;
}

export interface ArticleReview {
  revisionRequired: boolean;
  overallScore: number;
  summary: string;
  issues: ReviewIssue[];
  preserveSections: string[];
  productAssessment: string;
  strengths: string[];
}

/**
 * What the reviewer is told about length.
 *
 * Without this the reviewer routinely asked for more depth in an article that
 * was already at its ceiling, and the one permitted revision was spent making
 * it longer than the template allows.
 */
function reviewLengthNote(brief: ArticleBrief): string {
  const template = getTemplate(brief.template.templateId, brief.template.templateVersion);
  if (!template) return '';

  const band = lengthBandFor(template.contentSchema);
  return (
    `Length rule: ${band.minWords}-${band.maxWords} words for the whole article. ` +
    'Do not request additions that would take it past the maximum. Where something is missing and the article is at its ceiling, ' +
    'say what should be cut to make room, or accept the omission.'
  );
}

function buildReviewerPrompt(
  brief: ArticleBrief,
  article: GeneratedArticle,
  hasProducts: boolean,
  /** The same documents the writer was given, so "author voice" is judged against something. */
  voice: string,
): string {
  return [
    'You are an independent editor reviewing a finished draft. You do NOT rewrite it. You produce a structured assessment and, where changes are needed, a precise specification of them.',
    '',
    '=== RULES ===',
    'Judge the draft as published work. Be specific: name the section and, where you can, quote the passage at fault.',
    'A change you request must be actionable on its own. "Improve this section" is not a specification; "the claim that X is unsupported — either attribute it or remove it" is.',
    'Prefer the narrowest scope that fixes the problem. Ask for a structural rewrite only when the article\'s shape is genuinely wrong.',
    'If the draft is good, say so and set revision_required to false. Manufacturing issues to look thorough wastes a revision that cannot be spent twice.',
    '',
    '=== WHAT TO ASSESS ===',
    'Factual quality, depth, clarity, usefulness, originality, repetition, filler, whether it satisfies the stated search intent, keyword integration, title suitability, article-type and template compliance, author voice, theme alignment, unsupported or questionable claims, and outdated information.',
    hasProducts
      ? 'Also assess the products: whether each recommendation is relevant, whether claims about it are supported by the supplied data, whether links sit naturally, whether affiliate density is excessive, and whether the article reads as commercially motivated at the expense of usefulness. Do NOT modify any product URL.'
      : 'This article carries no products.',
    '',
    '=== THE BRIEF IT WAS WRITTEN TO ===',
    `Topic: ${brief.topic}`,
    `Angle: ${brief.recommendedAngle}`,
    `Audience: ${brief.audience}`,
    describePublicationMarket(),
    `Article type: ${brief.articleType}`,
    `Template: ${brief.template.templateId} v${brief.template.templateVersion}`,
    `Required sections: ${brief.template.sectionKeys.join(', ')}`,
    // The reviewer is held to the same length rule as the writer, so it
    // cannot ask for expansion the template forbids.
    reviewLengthNote(brief),
    `Search intent: ${brief.searchIntent}`,
    `Primary keyword: ${brief.primaryKeyword}`,
    brief.author.name ? `Author: ${brief.author.name}` : '',
    '',
    // Voice is on the assessment list above, and judging it against a name is
    // not judging it at all. The reviewer sees what the writer was given.
    voice
      ? `${voice}\nAssess the draft against these documents specifically: whether it actually sounds like this author, or merely like competent prose.`
      : '',
    '',
    '=== THE DRAFT ===',
    `Title: ${article.title}`,
    ...article.sections.map((section) => `\n--- ${section.key} (${section.heading}) ---\n${section.body}`),
    article.faq.length ? `\n--- faq ---\n${article.faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}` : '',
    '',
    '=== OUTPUT ===',
    'Reply with JSON only. No commentary, no code fence.',
    '{',
    '  "revision_required": false,',
    '  "overall_score": 0.0,',
    '  "summary": "your overall assessment in two or three sentences",',
    '  "strengths": ["what the draft does well"],',
    '  "product_assessment": "your judgement on the product placements, or why there is nothing to assess",',
    '  "issues": [',
    '    {"severity": "major | minor", "section": "the section key", "problem": "what is wrong", "required_change": "exactly what to do", "scope": "section_only | passage | structural", "passage": "the text at fault, if you can quote it"}',
    '  ],',
    '  "preserve_sections": ["section keys that must NOT be touched"]',
    '}',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function parseReview(text: string): ArticleReview {
  const json = readJsonObject(text);

  const summary = typeof json.summary === 'string' ? json.summary.trim() : '';
  if (!summary) throw new Error('"summary" was missing');

  const issues: ReviewIssue[] = Array.isArray(json.issues)
    ? (json.issues as unknown[])
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .map(
          (entry): ReviewIssue => ({
            severity: entry.severity === 'major' ? 'major' : 'minor',
            section: typeof entry.section === 'string' ? entry.section.trim() : '',
            problem: typeof entry.problem === 'string' ? entry.problem.trim() : '',
            requiredChange: typeof entry.required_change === 'string' ? entry.required_change.trim() : '',
            scope:
              entry.scope === 'structural' ? 'structural' : entry.scope === 'passage' ? 'passage' : 'section_only',
            passage: typeof entry.passage === 'string' ? entry.passage.trim().slice(0, 2000) : undefined,
          }),
        )
        // An issue with no stated change is not actionable, so it is not an
        // issue — dropping it keeps the revision specification executable.
        .filter((issue) => issue.problem && issue.requiredChange)
    : [];

  const rawScore = json.overall_score;
  const overallScore =
    typeof rawScore === 'number' && Number.isFinite(rawScore) ? Math.min(1, Math.max(0, rawScore)) : 0;

  return {
    // Trusted only when there is something to act on: a reviewer that asks for
    // a revision but specifies nothing would spend the one revision on nothing.
    revisionRequired: json.revision_required === true && issues.length > 0,
    overallScore,
    summary,
    issues,
    preserveSections: Array.isArray(json.preserve_sections)
      ? (json.preserve_sections as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    productAssessment: typeof json.product_assessment === 'string' ? json.product_assessment.trim() : '',
    strengths: Array.isArray(json.strengths)
      ? (json.strengths as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
  };
}

export async function runArticleReview(
  pipelineId: number,
  brief: ArticleBrief,
  article: GeneratedArticle,
  options: { confirmedCost?: boolean; rerun?: boolean } = {},
): Promise<StageResult> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new GenerationError('invalid_configuration', 'Pipeline not found.');

  // IDEMPOTENCE FIRST. Returning the review that already happened is not a
  // second review, and the cap must not mistake it for one — otherwise
  // re-entering this stage (a resumed run, a refreshed page, a guided run
  // continuing after a decision) turns a stored result into an error.
  if (!options.rerun) {
    const already = findCompletedStage(pipeline.id, pipeline.version, 'article_review');
    if (already) return { run: already, output: already.output, reused: true };
  }

  // THE REVIEW CAP. One review, before the one revision; after that,
  // validation is deterministic and no model is asked again.
  const permitted = canReview(pipelineId);
  if (!permitted.allowed && !options.rerun) {
    throw new GenerationError('generation_in_progress', permitted.reason);
  }

  const context = buildGenerationContext(pipeline.articleId);
  // Captured before the stage announces itself, so a refused spend gate
  // can put the run back rather than leaving it reading as running.
  const stateBeforeStage = getPipelineById(pipelineId)?.state ?? null;
  setState(pipelineId, STAGE_DEFINITIONS.article_review.runningState, { stage: 'article_review' });

  try {
    const result = await runStage({
      pipelineId,
      stage: 'article_review',
      prompt: buildReviewerPrompt(brief, article, (context?.products.length ?? 0) > 0, buildVoiceBlock(context)),
      parse: parseReview,
      timeoutMs: REVIEW_TIMEOUT_MS,
      assumedCompletionTokens: 2000,
      confirmedCost: options.confirmedCost,
      rerun: options.rerun,
    });

    if (!result.reused) incrementReviewCount(pipelineId);

    const review = result.output as ArticleReview;
    getDatabase()
      .prepare(`UPDATE articles SET review_score = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(review.overallScore, pipeline.articleId);

    setState(pipelineId, review.revisionRequired ? 'REVISION_REQUIRED' : 'REVIEW_COMPLETE', {
      stage: 'article_review',
      note: review.revisionRequired
        ? `${review.issues.length} issue(s) found. One revision is available.`
        : 'The reviewer found no revision necessary.',
    });

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
      stage: 'article_review',
      note: error instanceof Error ? error.message : 'Review failed.',
    });
    throw error;
  }
}

/* ---------------------------------------------------- the one revision --- */

/**
 * The SEO findings, as one specification.
 *
 * Deliberately the same shape as the editorial revision above, because it is
 * the same job: a list of specific corrections applied to a finished article
 * by a model that is editing rather than rewriting. The differences are what
 * the findings are about and where they came from.
 *
 * ONE CALL FOR ALL OF THEM. Thirteen findings sent one at a time would cost
 * thirteen times as much, and each call after the first would be editing an
 * article the previous one had already changed — so a later fix could quietly
 * undo an earlier one.
 */
export function buildSeoRevisionPrompt(
  article: GeneratedArticle,
  findings: { code: string; summary: string; explanation: string | null; recommendation: string | null; element: string | null }[],
  voice: string,
): string {
  return [
    'You are applying a list of specific SEO corrections to a finished article. You are editing, not rewriting.',
    '',
    '=== RULES ===',
    'Change ONLY what the findings below require. Every other sentence must survive exactly as written.',
    'Return every section of the article, including the ones you did not touch, so the result is a complete article.',
    'Do not reorganise or re-order sections unless a finding explicitly asks for it.',
    // The rule that matters most here, because several findings ask for MORE
    // words and a model given that instruction will pad if it has nothing to
    // say.
    'Where a finding asks for a passage to be longer, add substance — a reason, a number, a worked example, a caveat. Do not restate what is already there in different words. If there is genuinely nothing more to say, merge the passage into its neighbour instead, which is the alternative the finding offers.',
    'Do not add new claims, new products, or new sources while fixing something else.',
    'Preserve every [[product:<id>]] marker exactly where it is.',
    'Keep the article inside its existing length unless a finding requires otherwise.',
    '',
    voice
      ? `${voice}\nAnything you rewrite must be written in this voice. A correction that reads as a different author is not a correction.`
      : '',
    '',
    '=== THE FINDINGS ===',
    ...findings.map((finding, index) =>
      [
        `${index + 1}. ${finding.code}${finding.element ? ` — "${finding.element}"` : ''}`,
        `   Problem: ${finding.summary}`,
        finding.explanation ? `   Detail: ${finding.explanation}` : '',
        finding.recommendation ? `   Required change: ${finding.recommendation}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    '',
    '=== THE ARTICLE ===',
    JSON.stringify(article),
    '',
    '=== OUTPUT ===',
    'Reply with the complete corrected article as JSON, in exactly the same shape you received it. No commentary, no code fence.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Places approved internal links inside an article that is already finished.
 *
 * THE NARROWEST EDIT IN THE SYSTEM, and the prompt is written to keep it that
 * way: a link is a few characters of markdown around words that are already
 * on the page. Nothing else may move.
 *
 * The anchor is the model's choice, not Cynth's. The stored anchor suggestion
 * is usually the target article's own title, which almost never appears in the
 * source prose — insisting on it would produce a sentence that reads like a
 * citation, or no link at all. What Cynth does insist on is that the anchor be
 * text the article ALREADY contains, so no new claim arrives with the link.
 */
export function buildInternalLinkPrompt(
  article: GeneratedArticle,
  placements: { targetTitle: string; url: string; anchor: string | null; reason: string | null }[],
  voice: string,
): string {
  return [
    'You are adding internal links to a finished article. You are linking, not editing.',
    '',
    '=== RULES ===',
    'Add each link below exactly once, as markdown: [anchor text](url).',
    // The whole point. A model asked to "add a link" will happily write a new
    // sentence to hang it on, and that sentence is an unreviewed claim.
    'Do NOT write any new sentence, clause or transition. The anchor text must be words that are ALREADY in the article body.',
    'Every other character of the article must survive exactly as it is. Adding a link is the only change you may make.',
    'Choose the anchor by finding the sentence that is already about the target subject, and linking two to six of its own words. Prefer a noun phrase naming the subject over a bare "here" or "this article".',
    'Never put a link inside a heading, and never inside an existing link.',
    'Never place a link in the first sentence of the article, and do not put two links in the same sentence.',
    'If the article genuinely says nothing related to a target, leave that link out rather than inventing somewhere for it. A missing link is fine; a fabricated sentence is not.',
    'Preserve every [[product:<id>]] marker exactly where it is.',
    'Return every section of the article, including the ones you did not touch.',
    '',
    voice ? `${voice}\nThe linked words are the author's own, so they must still read as this author.` : '',
    '',
    '=== THE LINKS TO PLACE ===',
    ...placements.map((placement, index) =>
      [
        `${index + 1}. ${placement.targetTitle}`,
        `   URL: ${placement.url}`,
        placement.reason ? `   Why the two are related: ${placement.reason}` : '',
        placement.anchor
          ? `   Suggested subject: ${placement.anchor} — use it only if those words are in the body; otherwise pick words that are.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    '',
    '=== THE ARTICLE ===',
    JSON.stringify(article),
    '',
    '=== OUTPUT ===',
    'Reply with the complete article as JSON, in exactly the same shape you received it, with the links in place. No commentary, no code fence.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Saves an article an editor asked to have revised outside the pipeline.
 *
 * Shares `saveArticle` so the slug refresh and the never-overwrite-a-human
 * metadata rule apply identically — a second way of writing an article that
 * quietly skipped those would be a bug waiting to happen.
 */
export function applyRevisedArticle(articleId: number, article: GeneratedArticle, model: string): void {
  saveArticle(articleId, article, model);
}

function buildRevisionPrompt(article: GeneratedArticle, review: ArticleReview, voice: string): string {
  const structural = review.issues.some((issue) => issue.scope === 'structural');

  return [
    'You are applying a specific list of editorial corrections to a finished article. You are editing, not rewriting.',
    '',
    '=== RULES ===',
    'Change ONLY what the issues below require. Every other sentence must survive exactly as written.',
    structural
      ? 'One issue is marked structural, so the affected section may be reorganised — but only that section, and only as far as the specification requires.'
      : 'No issue is structural. Do not reorganise, re-order or regenerate any section.',
    'Return every section of the article, including the ones you did not touch, so the result is a complete article.',
    review.preserveSections.length
      ? `These sections must be returned byte for byte unchanged: ${review.preserveSections.join(', ')}.`
      : '',
    'Do not add new claims, new products, or new sources while fixing something else.',
    'Preserve every [[product:<id>]] marker exactly where it is, unless an issue explicitly concerns it.',
    '',
    // Without this, the one stage allowed to rewrite prose is the one stage
    // with no idea whose prose it is — and a correction lands in the reviser's
    // own default voice, undoing the writer's work sentence by sentence.
    voice
      ? `${voice}\nAnything you rewrite must be written in this voice. A correction that reads as a different author is not a correction.`
      : '',
    '',
    '=== THE CORRECTIONS ===',
    ...review.issues.map(
      (issue, index) =>
        [
          `${index + 1}. [${issue.severity}] section "${issue.section}" (scope: ${issue.scope})`,
          `   Problem: ${issue.problem}`,
          `   Required change: ${issue.requiredChange}`,
          issue.passage ? `   Passage at fault: "${issue.passage}"` : '',
        ]
          .filter(Boolean)
          .join('\n'),
    ),
    '',
    '=== THE ARTICLE ===',
    JSON.stringify(article),
    '',
    '=== OUTPUT ===',
    'Reply with the complete corrected article as JSON, in exactly the same shape you received it. No commentary, no code fence.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export async function runArticleRevision(
  pipelineId: number,
  article: GeneratedArticle,
  review: ArticleReview,
  options: { confirmedCost?: boolean } = {},
): Promise<StageResult> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new GenerationError('invalid_configuration', 'Pipeline not found.');

  /**
   * THE HARD CAP, CHECKED IN BACKEND CODE.
   *
   * Note what is deliberately ABSENT: there is no idempotency shortcut above
   * this check. Asking for a second revision is refused outright rather than
   * quietly answered with the first one, so calling this twice is an error a
   * caller finds out about instead of a no-op it can build on.
   *
   * There is deliberately no `rerun` escape here, unlike every other stage: a
   * second automatic revision must be impossible, not merely discouraged.
   */
  const permitted = canRevise(pipelineId);
  if (!permitted.allowed) {
    setState(pipelineId, 'NEEDS_EDITORIAL_ATTENTION', {
      stage: 'article_revision',
      note: permitted.reason,
    });
    throw new GenerationError('paid_generation_blocked', permitted.reason);
  }

  // Captured before the stage announces itself, so a refused spend gate
  // can put the run back rather than leaving it reading as running.
  const stateBeforeStage = getPipelineById(pipelineId)?.state ?? null;
  setState(pipelineId, STAGE_DEFINITIONS.article_revision.runningState, { stage: 'article_revision' });

  try {
    const result = await runStage({
      pipelineId,
      stage: 'article_revision',
      prompt: buildRevisionPrompt(article, review, buildVoiceBlock(buildGenerationContext(pipeline.articleId))),
      parse: parseArticle,
      timeoutMs: REVISE_TIMEOUT_MS,
      assumedCompletionTokens: 4000,
      confirmedCost: options.confirmedCost,
    });

    if (!result.reused) incrementRevisionCount(pipelineId);

    saveArticle(pipeline.articleId, result.output as GeneratedArticle, result.run.actualModel ?? '');
    setState(pipelineId, 'FINAL_VALIDATION', {
      stage: 'article_revision',
      note: `Revision ${getPipelineById(pipelineId)!.revisionCount} of ${MAX_AUTOMATIC_REVISIONS} applied. No further automatic revision is possible.`,
    });

    return result;
  } catch (error) {
    // A refused spend gate hands the run back unchanged. NEEDS_EDITORIAL_
    // ATTENTION is terminal, and being asked to authorise a cost is not a
    // reason to end a run before the question has been answered.
    if (isSpendRefusal(error)) {
      if (stateBeforeStage) setState(pipelineId, stateBeforeStage, { stage: null });
      throw error;
    }

    setState(pipelineId, 'NEEDS_EDITORIAL_ATTENTION', {
      stage: 'article_revision',
      note: error instanceof Error ? error.message : 'The revision failed.',
    });
    throw error;
  }
}
