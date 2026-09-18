import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { slugify } from '../articles/articles.constants.js';
import type { GenerationContext } from '../generation/generationContext.service.js';
import type { ArticleSeoRecord } from './seo.repository.js';
import { findDuplicateMetadata } from './seo.repository.js';
import type { ImageRequirementInput } from './seo.repository.js';
import type { KeywordUsage, SeoDiagnostics, SeoFinding, SeoLocator } from './seo.types.js';
import {
  BURIED_SECTION_WORDS,
  CITABLE_PASSAGE_MAX_WORDS,
  CITABLE_PASSAGE_MIN_WORDS,
  DIRECT_ANSWER_WORDS,
  GENERIC_HEADINGS,
  KEYWORD_OVERUSE_DENSITY,
  LONG_PARAGRAPH_CHARS,
  LONG_PARAGRAPH_SENTENCES,
  LONG_SENTENCE_WORDS,
  META_DESCRIPTION_MAX_CHARS,
  META_DESCRIPTION_MIN_CHARS,
  SEO_TITLE_MAX_CHARS,
  SEO_TITLE_MIN_CHARS,
  SLUG_MAX_CHARS,
  SLUG_MAX_WORDS,
  SLUG_STOPWORDS,
  THIN_SECTION_WORDS,
  UNBROKEN_SECTION_CHARS,
  VERY_LONG_SENTENCE_WORDS,
} from './seo.constants.js';
import {
  countPhraseOccurrences,
  excerptOf,
  splitSentences,
  stripInlineMarkdown,
  tokenize,
} from './seoDocument.js';
import type { SeoDocument } from './seoDocument.js';

/**
 * DETERMINISTIC SEO ANALYSIS.
 *
 * Everything in this file is computed from the article and its configuration
 * by code. No model is consulted, nothing is sent anywhere, and running it
 * costs nothing — which is why it always runs first, and why the AI pass is
 * only ever asked the questions code genuinely cannot answer.
 *
 * The line is drawn on reliability, not on difficulty: "is there a meta
 * description" and "are these two slugs identical" are facts, and a model
 * asked for a fact will sometimes be wrong about it.
 */

/** Words per minute used for the reading-time diagnostic. Stated so the assumption is visible. */
const READING_SPEED_WPM = 225;

export interface DeterministicInput {
  article: ArticleDraftDto;
  seo: ArticleSeoRecord;
  document: SeoDocument;
  context: GenerationContext;
  /** True when this article already exists as a post in some CMS. */
  hasCmsCopy: boolean;
  /** True when a human has published that remote copy — which makes the URL live. */
  hasPublishedCmsCopy: boolean;
  /** The slug the CMS copy was created with, when Cynth knows it. */
  publishedSlug: string | null;
}

export interface DeterministicResult {
  findings: SeoFinding[];
  diagnostics: SeoDiagnostics;
  /** Requirements describing images that already exist in the body. */
  imageRequirements: ImageRequirementInput[];
}

function finding(input: SeoFinding): SeoFinding {
  return input;
}

/** Locator for a paragraph, resolved to its heading so the user can find it. */
function paragraphLocator(document: SeoDocument, paragraphIndex: number): SeoLocator {
  const paragraph = document.paragraphs[paragraphIndex];
  const heading = paragraph.headingIndex === null ? null : document.headings[paragraph.headingIndex];
  return {
    heading: heading?.text ?? null,
    headingPath: heading ? [...heading.path, heading.text] : [],
    headingLevel: heading?.level ?? null,
    paragraphIndex,
    startOffset: paragraph.startOffset,
    endOffset: paragraph.endOffset,
    excerpt: excerptOf(paragraph.text),
  };
}

function headingLocator(document: SeoDocument, headingIndex: number): SeoLocator {
  const heading = document.headings[headingIndex];
  return {
    heading: heading.text,
    headingPath: [...heading.path, heading.text],
    headingLevel: heading.level,
    startOffset: heading.startOffset,
    endOffset: heading.endOffset,
    excerpt: heading.text,
  };
}

/* ----------------------------------------------------------- title --- */

function checkTitles(input: DeterministicInput, findings: SeoFinding[]): void {
  const { article, seo } = input;
  const editorialTitle = article.title?.trim() || article.generated?.title?.trim() || '';
  const seoTitle = seo.metadata.seoTitle?.trim() ?? '';

  if (!editorialTitle) {
    findings.push(
      finding({
        code: 'title_missing',
        category: 'title',
        dimension: 'on_page',
        severity: 'blocking',
        origin: 'deterministic',
        summary: 'The article has no title.',
        explanation:
          'Neither an editorial working title nor a generated title is stored, so there is nothing to show as the page heading or in search results.',
        recommendation: 'Give the article a title in the New Article wizard before running SEO analysis again.',
        element: 'title',
        locator: { field: 'title' },
        confidence: 1,
      }),
    );
    return;
  }

  // The SEO title is optional by design: an editorial title that already
  // works as a SERP headline needs no second one. Saying so is not a fault.
  const effectiveTitle = seoTitle || editorialTitle;

  if (!seoTitle) {
    findings.push(
      finding({
        code: 'seo_title_absent',
        category: 'title',
        dimension: 'technical_metadata',
        severity: 'info',
        origin: 'deterministic',
        summary: 'No separate SEO title is set — the article title will be used in search results.',
        explanation:
          'Cynth keeps the article/H1 title and the SEO title apart because they do different jobs. With no SEO title stored, the editorial title stands in.',
        recommendation:
          'Set a distinct SEO title only if the editorial headline reads poorly as a search result; otherwise this is fine.',
        element: 'seo_title',
        locator: { field: 'seo_title' },
        confidence: 1,
      }),
    );
  }

  if (effectiveTitle.length > SEO_TITLE_MAX_CHARS) {
    findings.push(
      finding({
        code: 'seo_title_too_long',
        category: 'title',
        dimension: 'on_page',
        severity: 'warning',
        origin: 'deterministic',
        summary: `The title is ${effectiveTitle.length} characters, above the ~${SEO_TITLE_MAX_CHARS}-character mark where search results usually truncate.`,
        explanation:
          'Search engines truncate by pixel width rather than character count, so this is approximate — but a title this long will very likely be cut short in the results page.',
        recommendation: `Set an SEO title of roughly ${SEO_TITLE_MIN_CHARS}-${SEO_TITLE_MAX_CHARS} characters that carries the same meaning. The editorial title can stay as it is.`,
        element: seoTitle ? 'seo_title' : 'title',
        locator: { field: seoTitle ? 'seo_title' : 'title', excerpt: effectiveTitle },
        confidence: 1,
      }),
    );
  } else if (effectiveTitle.length < SEO_TITLE_MIN_CHARS) {
    findings.push(
      finding({
        code: 'seo_title_too_short',
        category: 'title',
        dimension: 'on_page',
        severity: 'warning',
        origin: 'deterministic',
        summary: `The title is only ${effectiveTitle.length} characters.`,
        explanation:
          'A very short title leaves most of the available search-result width unused and usually says less than it could about what the article covers.',
        recommendation: 'Consider a fuller title that states the subject and what the reader gets.',
        element: seoTitle ? 'seo_title' : 'title',
        locator: { field: seoTitle ? 'seo_title' : 'title', excerpt: effectiveTitle },
        confidence: 1,
      }),
    );
  }

  const duplicates = findDuplicateMetadata(article.id, seo.metadata);
  for (const hit of duplicates.filter((entry) => entry.field === 'seo_title')) {
    findings.push(
      finding({
        code: 'seo_title_duplicate',
        category: 'title',
        dimension: 'technical_metadata',
        severity: 'warning',
        origin: 'deterministic',
        summary: `Another article ("${hit.title}") already uses this exact SEO title.`,
        explanation:
          'Two pages competing on the same title makes it harder for either to be chosen for a query, and harder for a reader to tell them apart in the results.',
        recommendation: 'Differentiate the two titles so each says what is specific to its own article.',
        element: 'seo_title',
        locator: { field: 'seo_title', excerpt: seoTitle },
        confidence: 1,
      }),
    );
  }
}

/* ------------------------------------------------- meta description --- */

function checkMetaDescription(input: DeterministicInput, findings: SeoFinding[]): void {
  const { seo, article } = input;
  const description = seo.metadata.metaDescription?.trim() ?? '';

  if (!description) {
    findings.push(
      finding({
        code: 'meta_description_missing',
        category: 'meta_description',
        dimension: 'technical_metadata',
        severity: 'warning',
        origin: 'deterministic',
        summary: 'No meta description is set.',
        explanation:
          'Without one, the search engine writes its own summary from whatever text it finds, which is rarely the sentence you would have chosen.',
        recommendation: `Write a description of roughly ${META_DESCRIPTION_MIN_CHARS}-${META_DESCRIPTION_MAX_CHARS} characters that says what the reader will get.`,
        element: 'meta_description',
        locator: { field: 'meta_description' },
        confidence: 1,
      }),
    );
    return;
  }

  if (description.length > META_DESCRIPTION_MAX_CHARS) {
    findings.push(
      finding({
        code: 'meta_description_too_long',
        category: 'meta_description',
        dimension: 'technical_metadata',
        severity: 'warning',
        origin: 'deterministic',
        summary: `The meta description is ${description.length} characters, past the ~${META_DESCRIPTION_MAX_CHARS} usually shown.`,
        explanation: 'Anything beyond the cut-off is invisible in the results page, so the closing thought is lost.',
        recommendation: 'Trim it so the whole sentence survives truncation.',
        element: 'meta_description',
        locator: { field: 'meta_description', excerpt: excerptOf(description) },
        confidence: 1,
      }),
    );
  } else if (description.length < META_DESCRIPTION_MIN_CHARS) {
    findings.push(
      finding({
        code: 'meta_description_too_short',
        category: 'meta_description',
        dimension: 'technical_metadata',
        severity: 'recommendation',
        origin: 'deterministic',
        summary: `The meta description is only ${description.length} characters.`,
        explanation: 'There is room to say more about what the article offers.',
        recommendation: `Extend it toward ${META_DESCRIPTION_MIN_CHARS}-${META_DESCRIPTION_MAX_CHARS} characters.`,
        element: 'meta_description',
        locator: { field: 'meta_description', excerpt: description },
        confidence: 1,
      }),
    );
  }

  const targetQuery = seo.configuration.targetQuery?.trim();
  if (targetQuery) {
    const occurrences = countPhraseOccurrences(description, targetQuery);
    if (occurrences >= 3) {
      findings.push(
        finding({
          code: 'meta_description_keyword_stuffed',
          category: 'meta_description',
          dimension: 'technical_metadata',
          severity: 'warning',
          origin: 'deterministic',
          summary: `The target query appears ${occurrences} times in a single meta description.`,
          explanation:
            'Repeating the query in one or two sentences reads as written-for-a-crawler rather than for a person, and gives a reader no extra reason to click.',
          recommendation: 'Use the query once, naturally, and spend the rest of the space on what the article offers.',
          element: 'meta_description',
          locator: { field: 'meta_description', excerpt: excerptOf(description) },
          confidence: 1,
        }),
      );
    }
  }

  for (const hit of findDuplicateMetadata(article.id, seo.metadata).filter((e) => e.field === 'meta_description')) {
    findings.push(
      finding({
        code: 'meta_description_duplicate',
        category: 'meta_description',
        dimension: 'technical_metadata',
        severity: 'warning',
        origin: 'deterministic',
        summary: `Another article ("${hit.title}") uses this exact meta description.`,
        explanation: 'Duplicate descriptions across pages waste the one piece of copy you control in the results page.',
        recommendation: 'Write a description specific to this article.',
        element: 'meta_description',
        locator: { field: 'meta_description' },
        confidence: 1,
      }),
    );
  }
}

/* ------------------------------------------------------------ slug --- */

function checkSlug(input: DeterministicInput, findings: SeoFinding[]): void {
  const { article, seo } = input;
  const slug = (seo.metadata.seoSlug?.trim() || article.slug?.trim()) ?? '';

  if (!slug) {
    findings.push(
      finding({
        code: 'slug_missing',
        category: 'slug',
        dimension: 'technical_metadata',
        severity: 'warning',
        origin: 'deterministic',
        summary: 'The article has no slug.',
        explanation: 'Cynth derives a slug from the title; with no title there is nothing to derive one from.',
        recommendation: 'Give the article a title, or set an SEO slug explicitly.',
        element: 'slug',
        locator: { field: 'slug' },
        confidence: 1,
      }),
    );
    return;
  }

  if (slug !== slugify(slug)) {
    findings.push(
      finding({
        code: 'slug_invalid_format',
        category: 'slug',
        dimension: 'technical_metadata',
        severity: 'warning',
        origin: 'deterministic',
        summary: 'The slug contains characters that do not belong in a URL segment.',
        explanation:
          'Uppercase letters, spaces, underscores and punctuation make a URL harder to read, harder to share, and inconsistent with the rest of the site.',
        recommendation: `Use lowercase words separated by hyphens, for example "${slugify(slug)}".`,
        element: 'slug',
        locator: { field: 'slug', excerpt: slug },
        confidence: 1,
      }),
    );
  }

  const words = slug.split('-').filter(Boolean);
  if (slug.length > SLUG_MAX_CHARS || words.length > SLUG_MAX_WORDS) {
    const stopwords = words.filter((word) => SLUG_STOPWORDS.has(word));
    findings.push(
      finding({
        code: 'slug_too_long',
        category: 'slug',
        dimension: 'technical_metadata',
        severity: 'recommendation',
        origin: 'deterministic',
        summary: `The slug is ${words.length} words and ${slug.length} characters.`,
        explanation: stopwords.length
          ? `It carries ${stopwords.length} word(s) that add nothing to the meaning: ${stopwords.join(', ')}.`
          : 'A long slug is harder to read in a link and harder to keep stable over time.',
        recommendation:
          'Shorten it to the words that identify the subject. Change it before the URL is published, not after.',
        element: 'slug',
        locator: { field: 'slug', excerpt: slug },
        confidence: 1,
      }),
    );
  }

  /**
   * SLUG STABILITY. Once a URL exists in the wild, changing it costs the
   * article whatever that URL had earned. Cynth will not do it silently, and
   * says so as a blocking finding rather than a suggestion.
   */
  if (input.hasPublishedCmsCopy && input.publishedSlug && input.publishedSlug !== slug) {
    findings.push(
      finding({
        code: 'slug_changed_after_publication',
        category: 'slug',
        dimension: 'technical_metadata',
        severity: 'blocking',
        origin: 'deterministic',
        summary: `The slug has changed since this article was published as "${input.publishedSlug}".`,
        explanation:
          'The published URL is live. Pushing a different slug would move the page, breaking existing links and discarding whatever the old URL had accumulated.',
        recommendation:
          `Keep the published slug ("${input.publishedSlug}"), or change it deliberately in the CMS and set up a redirect there.`,
        element: 'slug',
        locator: { field: 'slug', excerpt: slug },
        confidence: 1,
      }),
    );
  }
}

/* --------------------------------------------------------- headings --- */

function checkHeadings(input: DeterministicInput, findings: SeoFinding[]): void {
  const { document } = input;
  const h1s = document.headings.filter((heading) => heading.level === 1);

  if (h1s.length > 1) {
    findings.push(
      finding({
        code: 'multiple_h1',
        category: 'headings',
        dimension: 'structure',
        severity: 'warning',
        origin: 'deterministic',
        summary: `The body contains ${h1s.length} level-1 headings.`,
        explanation:
          'The page title is the H1. Extra level-1 headings inside the body flatten the document outline, so the sections stop reading as parts of one article.',
        recommendation: `Demote the additional H1s to H2: ${h1s
          .slice(1)
          .map((heading) => `"${heading.text}"`)
          .join(', ')}.`,
        element: 'heading',
        locator: headingLocator(document, h1s[1].index),
        confidence: 1,
      }),
    );
  }

  if (document.headings.length === 0 && document.wordCount > 300) {
    findings.push(
      finding({
        code: 'no_headings',
        category: 'headings',
        dimension: 'structure',
        severity: 'warning',
        origin: 'deterministic',
        summary: 'The article has no headings at all.',
        explanation:
          'An article of this length with no headings gives a reader no way to scan it and gives a search engine no signal about how it is organised.',
        recommendation: 'Break the article into sections with descriptive H2s.',
        element: 'body',
        locator: null,
        confidence: 1,
      }),
    );
  }

  // Hierarchy: a jump from H2 straight to H4 leaves a level out of the outline.
  let previousLevel: number | null = null;
  for (const heading of document.headings) {
    if (previousLevel !== null && heading.level > previousLevel + 1) {
      findings.push(
        finding({
          code: 'heading_level_skipped',
          category: 'headings',
          dimension: 'structure',
          severity: 'warning',
          origin: 'deterministic',
          summary: `"${heading.text}" jumps from H${previousLevel} to H${heading.level}.`,
          explanation:
            'A skipped level breaks the document outline: this heading claims to be a sub-section of something that does not exist.',
          recommendation: `Make it an H${previousLevel + 1}, or add the missing intermediate heading.`,
          element: 'heading',
          locator: headingLocator(document, heading.index),
          confidence: 1,
        }),
      );
    }
    previousLevel = heading.level;
  }

  for (const heading of document.headings) {
    const normalized = heading.text.trim().toLowerCase().replace(/[.:!?]+$/, '');
    if (GENERIC_HEADINGS.has(normalized)) {
      findings.push(
        finding({
          code: 'heading_generic',
          category: 'headings',
          dimension: 'structure',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `"${heading.text}" describes the document rather than its content.`,
          explanation:
            'A heading is the one line a scanning reader reads. This one tells them where they are in the article, not what it says.',
          recommendation: 'Replace it with a heading that states the section’s actual point.',
          element: 'heading',
          locator: headingLocator(document, heading.index),
          confidence: 1,
        }),
      );
    }
  }

  // A heading with nothing underneath it promises a section that is not there.
  for (const section of document.sections) {
    if (section.headingIndex === null) continue;
    const heading = document.headings[section.headingIndex];
    const next = document.headings[section.headingIndex + 1];
    const isParent = next !== undefined && next.level > heading.level;
    if (isParent) continue;

    if (section.wordCount < 15) {
      findings.push(
        finding({
          code: 'section_empty',
          category: 'headings',
          dimension: 'structure',
          severity: 'warning',
          origin: 'deterministic',
          summary: `The section "${heading.text}" has almost no content beneath it (${section.wordCount} words).`,
          explanation: 'A heading sets an expectation. This one is not met by what follows it.',
          recommendation: 'Write the section, merge it into a neighbouring one, or remove the heading.',
          element: 'section',
          locator: headingLocator(document, section.headingIndex),
          confidence: 1,
        }),
      );
    }
  }
}

/* ---------------------------------------------------------- content --- */

function checkContent(input: DeterministicInput, findings: SeoFinding[]): void {
  const { document, article } = input;

  if (!article.generated?.content?.trim()) {
    findings.push(
      finding({
        code: 'content_missing',
        category: 'content_depth',
        dimension: 'content_relevance',
        severity: 'blocking',
        origin: 'deterministic',
        summary: 'The article has no generated content.',
        explanation: 'There is nothing to analyse and nothing to publish.',
        recommendation: 'Generate the article first, then run SEO analysis.',
        element: 'body',
        locator: null,
        confidence: 1,
      }),
    );
    return;
  }

  if (document.wordCount === 0) {
    findings.push(
      finding({
        code: 'content_empty_after_parsing',
        category: 'content_depth',
        dimension: 'content_relevance',
        severity: 'blocking',
        origin: 'deterministic',
        summary: 'The stored content contains no readable prose.',
        explanation: 'The body parsed to zero words — it may be only markup, headings or whitespace.',
        recommendation: 'Check the stored article body and regenerate if necessary.',
        element: 'body',
        locator: null,
        confidence: 1,
      }),
    );
  }

  if (!document.introduction) {
    findings.push(
      finding({
        code: 'introduction_missing',
        category: 'introduction',
        dimension: 'structure',
        severity: 'warning',
        origin: 'deterministic',
        summary: 'The article has no opening prose.',
        explanation:
          'A reader arriving from a search result has nothing telling them they are in the right place before the first section starts.',
        recommendation: 'Open with a short paragraph that states the subject and what the reader will get.',
        element: 'introduction',
        locator: null,
        confidence: 1,
      }),
    );
  }

  // A long stretch with no heading, list or break is hard to scan — a
  // structural observation, not a judgement about the writing.
  for (const section of document.sections) {
    if (section.text.length > UNBROKEN_SECTION_CHARS && !section.hasList) {
      findings.push(
        finding({
          code: 'section_hard_to_scan',
          category: 'readability',
          dimension: 'readability',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: section.heading
            ? `"${section.heading}" runs for ${section.text.length} characters without a sub-heading or list.`
            : `The opening runs for ${section.text.length} characters without a break.`,
          explanation:
            'A reader scanning for the part that answers their question has no landmarks to scan by across this stretch.',
          recommendation: 'Add a sub-heading, a list, or a break where the subject shifts.',
          element: 'section',
          locator:
            section.headingIndex !== null
              ? headingLocator(document, section.headingIndex)
              : { sectionIndex: section.index, startOffset: section.startOffset, endOffset: section.endOffset },
          confidence: 1,
        }),
      );
    }
  }
}

/* -------------------------------------------------------- keywords --- */

/**
 * Keyword usage.
 *
 * Every number produced here is a DIAGNOSTIC. There is exactly one finding in
 * this function that affects the score, and it fires on overuse — the failure
 * mode that is actually a problem. Nothing rewards a density figure, and
 * nothing here can be optimised toward.
 */
function analyseKeywords(input: DeterministicInput, findings: SeoFinding[]): KeywordUsage[] {
  const { document, seo, article } = input;
  const usage: KeywordUsage[] = [];

  const editorialTitle = article.title?.trim() || article.generated?.title?.trim() || '';
  const seoTitle = seo.metadata.seoTitle?.trim() ?? '';
  const metaDescription = seo.metadata.metaDescription ?? '';
  const slug = (seo.metadata.seoSlug || article.slug || '').replace(/-/g, ' ');
  const headingText = document.headings.map((heading) => heading.text).join(' \n ');
  const introText = document.introduction?.text ?? '';

  const terms: { term: string; role: KeywordUsage['role'] }[] = [];
  if (seo.configuration.targetQuery?.trim()) {
    terms.push({ term: seo.configuration.targetQuery.trim(), role: 'primary' });
  }
  for (const term of seo.configuration.secondaryKeywords) terms.push({ term, role: 'secondary' });
  for (const term of seo.configuration.semanticTopics) terms.push({ term, role: 'semantic' });

  for (const { term, role } of terms) {
    const occurrences = countPhraseOccurrences(document.plainText, term);
    usage.push({
      term,
      role,
      occurrences,
      headingOccurrences: countPhraseOccurrences(headingText, term),
      inTitle: countPhraseOccurrences(editorialTitle, term) > 0,
      inSeoTitle: seoTitle ? countPhraseOccurrences(seoTitle, term) > 0 : false,
      inMetaDescription: countPhraseOccurrences(metaDescription, term) > 0,
      inSlug: countPhraseOccurrences(slug, term) > 0,
      inIntroduction: countPhraseOccurrences(introText, term) > 0,
      density: document.wordCount > 0 ? occurrences / document.wordCount : null,
    });
  }

  const primary = usage.find((entry) => entry.role === 'primary');

  if (!seo.configuration.targetQuery?.trim()) {
    findings.push(
      finding({
        code: 'target_query_not_set',
        category: 'configuration',
        dimension: 'on_page',
        severity: 'info',
        origin: 'deterministic',
        summary: 'No target search query is configured.',
        explanation:
          'Not every article needs one — a topic-oriented article can be analysed semantically. But without a query, Cynth cannot check intent alignment against a specific search.',
        recommendation:
          'Set a target query if this article is aimed at a specific search. Leave it empty if it is not; that is a valid configuration.',
        element: 'config',
        locator: { field: 'target_query' },
        confidence: 1,
      }),
    );
  } else if (primary) {
    if (primary.occurrences === 0) {
      findings.push(
        finding({
          code: 'target_query_absent_from_body',
          category: 'keywords',
          dimension: 'on_page',
          severity: 'warning',
          origin: 'deterministic',
          summary: `The target query "${primary.term}" does not appear anywhere in the article.`,
          explanation:
            'This is an exact-phrase check, so an article that covers the subject in different words will still trigger it. Whether that matters is an editorial judgement — but a query that is never stated at all is worth a look.',
          recommendation:
            'Use the phrase once where it reads naturally, or confirm that the article covers the same ground in its own words and dismiss this finding.',
          element: 'body',
          locator: null,
          confidence: 1,
        }),
      );
    } else if (primary.density !== null && primary.density > KEYWORD_OVERUSE_DENSITY) {
      findings.push(
        finding({
          code: 'target_query_overused',
          category: 'keywords',
          dimension: 'on_page',
          severity: 'warning',
          origin: 'deterministic',
          summary: `"${primary.term}" appears ${primary.occurrences} times — ${(primary.density * 100).toFixed(1)}% of all words.`,
          explanation:
            'At this rate the phrase is being repeated rather than used. It reads mechanically and gives the reader nothing.',
          recommendation: 'Replace most occurrences with pronouns or natural variations.',
          element: 'body',
          locator: null,
          confidence: 1,
        }),
      );
    }

    if (primary.occurrences > 0 && !primary.inIntroduction) {
      findings.push(
        finding({
          code: 'target_query_absent_from_introduction',
          category: 'introduction',
          dimension: 'on_page',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: 'The opening does not mention the target query.',
          explanation:
            'A reader arriving from that search wants confirmation in the first few lines that this is about their question.',
          recommendation: 'Establish the subject in the opening, in the reader’s own words if not the exact phrase.',
          element: 'introduction',
          locator: document.introduction
            ? paragraphLocator(document, document.introduction.paragraphIndexes[0])
            : null,
          confidence: 1,
        }),
      );
    }

    if (primary.occurrences > 0 && primary.headingOccurrences === 0 && document.headings.length > 0) {
      findings.push(
        finding({
          code: 'target_query_absent_from_headings',
          category: 'keywords',
          dimension: 'on_page',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: 'No heading refers to the target query or its subject.',
          explanation:
            'Headings are the strongest structural signal about what a page is about, for both readers scanning and engines parsing.',
          recommendation:
            'Where one section genuinely is the answer to that query, let its heading say so. Do not add the phrase to headings mechanically.',
          element: 'heading',
          locator: null,
          confidence: 1,
        }),
      );
    }
  }

  const unusedSecondary = usage.filter((entry) => entry.role === 'secondary' && entry.occurrences === 0);
  if (unusedSecondary.length) {
    findings.push(
      finding({
        code: 'secondary_terms_unused',
        category: 'keywords',
        dimension: 'topical_coverage',
        severity: 'info',
        origin: 'deterministic',
        summary: `${unusedSecondary.length} secondary term(s) do not appear verbatim: ${unusedSecondary
          .map((entry) => `"${entry.term}"`)
          .join(', ')}.`,
        explanation:
          'Diagnostic only. A secondary term is a topic, not a quota — the article may well cover the same ground in different words, which the AI pass is better placed to judge than an exact-phrase count.',
        recommendation: 'No action unless the concept itself is genuinely missing.',
        element: 'body',
        locator: null,
        confidence: 1,
      }),
    );
  }

  return usage;
}

/* ------------------------------------------------------ readability --- */

/**
 * Readability diagnostics.
 *
 * Deliberately NOT a grade level. What counts as clear depends on the
 * audience and the author persona, both of which are configured per article,
 * so this reports structural extremes and leaves the register alone.
 */
function checkReadability(input: DeterministicInput, findings: SeoFinding[]): { long: number; longParagraphs: number } {
  const { document, context } = input;
  let longSentences = 0;
  let longParagraphs = 0;
  const veryLong: { paragraphIndex: number; words: number; text: string }[] = [];

  for (const paragraph of document.paragraphs) {
    const plain = stripInlineMarkdown(paragraph.text);
    for (const sentence of splitSentences(plain)) {
      const words = tokenize(sentence).length;
      if (words > LONG_SENTENCE_WORDS) longSentences += 1;
      if (words > VERY_LONG_SENTENCE_WORDS) {
        veryLong.push({ paragraphIndex: paragraph.index, words, text: sentence });
      }
    }

    if (
      !paragraph.isListItem &&
      (plain.length > LONG_PARAGRAPH_CHARS || paragraph.sentenceCount > LONG_PARAGRAPH_SENTENCES)
    ) {
      longParagraphs += 1;
      findings.push(
        finding({
          code: 'paragraph_too_long',
          category: 'readability',
          dimension: 'readability',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `A ${paragraph.sentenceCount}-sentence, ${plain.length}-character paragraph.`,
          explanation:
            'Long paragraphs are harder to scan on a phone, where most readers arrive. This is about shape on the page, not about the writing itself.',
          recommendation: 'Split it where the thought turns.',
          element: 'paragraph',
          locator: paragraphLocator(document, paragraph.index),
          confidence: 1,
        }),
      );
    }
  }

  // Only the worst offenders get their own finding: a list of forty
  // long-sentence notices is noise, not review.
  for (const sentence of veryLong.slice(0, 5)) {
    findings.push(
      finding({
        code: 'sentence_very_long',
        category: 'readability',
        dimension: 'readability',
        severity: 'recommendation',
        origin: 'deterministic',
        summary: `A ${sentence.words}-word sentence.`,
        explanation: 'A sentence this long usually carries more than one idea and asks the reader to hold all of them.',
        recommendation: 'Split it, or cut the subordinate clauses.',
        element: 'paragraph',
        locator: {
          ...paragraphLocator(document, sentence.paragraphIndex),
          excerpt: excerptOf(sentence.text),
        },
        confidence: 1,
      }),
    );
  }

  // Repeated sentence openers read as a template. Reported once, with the
  // audience noted, because some author personas use repetition on purpose.
  const openers = new Map<string, number>();
  for (const sentence of document.sentences) {
    const first = tokenize(sentence)[0];
    if (first && first.length > 2) openers.set(first, (openers.get(first) ?? 0) + 1);
  }
  const worst = [...openers.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst && document.sentences.length >= 12 && worst[1] >= Math.max(5, document.sentences.length * 0.2)) {
    findings.push(
      finding({
        code: 'repetitive_sentence_openers',
        category: 'readability',
        dimension: 'readability',
        severity: 'recommendation',
        origin: 'deterministic',
        summary: `${worst[1]} sentences open with "${worst[0]}".`,
        explanation: context.author?.name
          ? `Repetition at this rate reads as a template rather than as ${context.author.name}’s voice.`
          : 'Repetition at this rate reads as a template rather than as a person writing.',
        recommendation: 'Vary the openings where it does not cost clarity.',
        element: 'body',
        locator: null,
        confidence: 1,
      }),
    );
  }

  return { long: longSentences, longParagraphs };
}

/* --------------------------------------------------- links & images --- */

function checkLinks(input: DeterministicInput, findings: SeoFinding[]): void {
  const { document } = input;
  const internal = document.links.filter((link) => link.isInternal);
  const external = document.links.filter((link) => link.isExternal);

  if (internal.length === 0 && document.wordCount > 400) {
    findings.push(
      finding({
        code: 'no_internal_links',
        category: 'internal_links',
        dimension: 'internal_linking',
        severity: 'recommendation',
        origin: 'deterministic',
        summary: 'The article body contains no internal links.',
        explanation:
          'Internal links are how a reader gets from this article to the next one, and how the site tells a search engine which of its pages relate to each other.',
        recommendation: 'Review the internal link opportunities below and add the ones that genuinely help the reader.',
        element: 'links',
        locator: null,
        confidence: 1,
      }),
    );
  }

  if (external.length === 0 && document.wordCount > 400) {
    findings.push(
      finding({
        code: 'no_external_links',
        category: 'external_links',
        dimension: 'external_authority',
        severity: 'recommendation',
        origin: 'deterministic',
        summary: 'The article cites no external sources.',
        explanation:
          'Claims that a reader might reasonably question are stronger when they point at something. Whether this article makes any such claims is an editorial judgement.',
        recommendation: 'Check the external source opportunities below. Nothing is added automatically.',
        element: 'links',
        locator: null,
        confidence: 1,
      }),
    );
  }

  for (const link of external) {
    if (!link.anchorText || /^(?:here|click here|this|link|read more|more)$/i.test(link.anchorText)) {
      findings.push(
        finding({
          code: 'link_anchor_uninformative',
          category: 'external_links',
          dimension: 'external_authority',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `A link uses "${link.anchorText}" as its anchor text.`,
          explanation: 'Anchor text is the only description of a destination a scanning reader gets.',
          recommendation: 'Use anchor text that names what is on the other end.',
          element: 'links',
          locator: {
            paragraphIndex: link.paragraphIndex,
            startOffset: link.startOffset,
            excerpt: `[${link.anchorText}](${link.url})`,
          },
          confidence: 1,
        }),
      );
    }
  }
}

function checkImages(input: DeterministicInput, findings: SeoFinding[]): ImageRequirementInput[] {
  const { document, article } = input;
  const requirements: ImageRequirementInput[] = [];

  for (const image of document.images) {
    const paragraph = image.paragraphIndex === null ? null : document.paragraphs[image.paragraphIndex];
    const heading =
      paragraph?.headingIndex !== null && paragraph?.headingIndex !== undefined
        ? document.headings[paragraph.headingIndex]
        : null;

    if (image.missingAlt) {
      findings.push(
        finding({
          code: 'image_missing_alt',
          category: 'images',
          dimension: 'technical_metadata',
          severity: 'warning',
          origin: 'deterministic',
          summary: `An image has no alt text: ${image.source}`,
          explanation:
            'Alt text is what a screen reader announces and what a search engine reads. Without it the image is invisible to both.',
          recommendation: 'Describe what the image shows, in the context of the surrounding text.',
          element: 'images',
          locator: {
            heading: heading?.text ?? null,
            paragraphIndex: image.paragraphIndex,
            startOffset: image.startOffset,
            excerpt: image.source,
          },
          confidence: 1,
        }),
      );
    }

    // A requirement row for each image actually present, so the alt text and
    // filename have somewhere to live. Cynth writes no alt text here — that
    // is a semantic judgement, and the AI pass proposes it.
    requirements.push({
      analysisId: null,
      articleId: article.id,
      placement: heading ? `Under "${heading.text}"` : 'In the article body',
      purpose: null,
      altText: image.missingAlt ? null : image.altText,
      filenameSuggestion: null,
      caption: null,
      descriptiveContext: paragraph ? excerptOf(paragraph.text) : null,
      existingSource: image.source,
      origin: 'deterministic',
    });

    if (image.filename && /^(?:img|image|photo|dsc|screenshot|untitled)[-_]?\d*\.\w+$/i.test(image.filename)) {
      findings.push(
        finding({
          code: 'image_filename_generic',
          category: 'images',
          dimension: 'technical_metadata',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `The image filename "${image.filename}" describes nothing.`,
          explanation: 'A filename is a small but real signal about what an image shows.',
          recommendation: 'Rename the file after its subject, in lowercase words separated by hyphens.',
          element: 'images',
          locator: { startOffset: image.startOffset, excerpt: image.source },
          confidence: 1,
        }),
      );
    }
  }

  if (document.images.length === 0 && document.wordCount > 600) {
    findings.push(
      finding({
        code: 'no_images',
        category: 'images',
        dimension: 'technical_metadata',
        severity: 'info',
        origin: 'deterministic',
        summary: 'The article body contains no images.',
        explanation:
          'Diagnostic only. Plenty of good articles have no images, and Cynth does not create them. Noted so the requirement can be planned if one is wanted.',
        recommendation: 'No action required.',
        element: 'images',
        locator: null,
        confidence: 1,
      }),
    );
  }

  return requirements;
}

/* --------------------------------------------------------- top level --- */

/* --------------------------------------------------------- AI search --- */

/**
 * Openings that promise an answer instead of giving one.
 *
 * An answer engine reads the first sentences of a section and stops. A section
 * that opens by announcing what it is about to do has spent its most valuable
 * position on throat-clearing.
 */
const PREAMBLE_OPENINGS = [
  /^in this (?:article|section|guide|post)\b/i,
  /^(?:let'?s|lets)\s+(?:take a look|look at|dive|explore|talk about|start)\b/i,
  /^before we (?:dive|begin|start|get)\b/i,
  /^when it comes to\b/i,
  /^(?:we'?ll|we will) (?:cover|look at|explore|discuss)\b/i,
  /^(?:there are many|there are a lot of|there are several)\b/i,
  /^first,? (?:let'?s|we)\b/i,
];

/**
 * A section that opens by pointing at something above it.
 *
 * "This means you should..." is fine on the page and useless when lifted off
 * it: the thing being referred to did not come with it. The pattern is
 * deliberately narrow — a bare demonstrative or pronoun with no noun attached
 * — because "This litter box" is self-contained and "This is why" is not.
 */
const DEPENDENT_OPENING = /^(?:this|that|these|those|it|they|he|she|such|both|either)\b(?!\s+[a-z]+(?:s|es)?\b\s+(?:is|are|was|were|means|refers))/i;

function checkAiSearch(input: DeterministicInput, findings: SeoFinding[]): void {
  const { document } = input;

  for (const section of document.sections) {
    // The lead-in before the first heading is the introduction, and is judged
    // as an introduction elsewhere. It is not a passage anyone quotes.
    if (section.headingIndex === null) continue;

    // Nor is the H1. It is the article's title, and the prose beneath it —
    // when there is any before the first H2 — is the introduction under
    // another name. Judging it as a passage reports the title itself as "too
    // short to answer anything", which is true and useless.
    if (section.level === 1) continue;

    const locator = headingLocator(document, section.headingIndex);
    const label = section.heading ?? 'A section';

    if (section.wordCount < THIN_SECTION_WORDS) {
      findings.push(
        finding({
          code: 'passage_too_thin_to_quote',
          category: 'citability',
          dimension: 'ai_search',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `"${label}" is ${section.wordCount} ${section.wordCount === 1 ? 'word' : 'words'} — too short to answer anything on its own.`,
          explanation:
            'An AI answer engine quotes a passage without the rest of the page around it. A section this short either depends on its neighbours or does not say enough to be worth citing.',
          recommendation: `Give it enough to stand alone — roughly ${CITABLE_PASSAGE_MIN_WORDS}-${CITABLE_PASSAGE_MAX_WORDS} words is the band that gets quoted — or merge it into the section it belongs with.`,
          element: 'section',
          locator,
          confidence: 1,
        }),
      );
    } else if (section.wordCount > BURIED_SECTION_WORDS) {
      findings.push(
        finding({
          code: 'passage_answer_buried',
          category: 'citability',
          dimension: 'ai_search',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `"${label}" runs to ${section.wordCount} words, so any answer inside it is hard to extract.`,
          explanation:
            'A long section is read as one block. The more it covers, the less likely a specific answer can be lifted out of it cleanly.',
          recommendation:
            'Split it under its own sub-headings, so each question has a passage of its own that can be quoted.',
          element: 'section',
          locator,
          confidence: 1,
        }),
      );
    }

    // The opening PROSE of the section, which is the part that gets read.
    //
    // `section.text` begins with the heading line itself, so it is dropped
    // first — without this every opening check tests the heading rather than
    // the sentence beneath it, and never matches anything.
    const opening = stripInlineMarkdown(section.text.replace(/^\s*#{1,6}[^\n]*\n?/, '')).trim();
    if (!opening) continue;

    const firstSentence = splitSentences(opening)[0] ?? opening;
    const preamble = PREAMBLE_OPENINGS.find((pattern) => pattern.test(opening));

    if (preamble) {
      findings.push(
        finding({
          code: 'passage_opens_with_preamble',
          category: 'citability',
          dimension: 'ai_search',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `"${label}" opens by describing itself rather than answering.`,
          explanation:
            `An answer engine reads roughly the first ${DIRECT_ANSWER_WORDS} words of a section and moves on. An opening that announces what the section will cover has spent that space without saying anything.`,
          recommendation: `Lead with the answer: "${excerptOf(firstSentence)}" could start with the conclusion instead of the introduction to it.`,
          element: 'section',
          locator,
          confidence: 1,
        }),
      );
    } else if (DEPENDENT_OPENING.test(opening)) {
      // Only when it is not already reported as preamble — one opening, one
      // finding, or the same sentence is criticised twice for one fault.
      findings.push(
        finding({
          code: 'passage_opens_dependently',
          category: 'citability',
          dimension: 'ai_search',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `"${label}" opens by referring to something above it.`,
          explanation:
            'Quoted on its own, the reference has nothing to point at. The passage reads as an answer to a question the reader cannot see.',
          recommendation: 'Name the thing being referred to in the opening sentence, so the passage carries its own subject.',
          element: 'section',
          locator,
          confidence: 1,
        }),
      );
    }
  }

  // One definition, anywhere, for the thing the article is about. Answer
  // engines lift "X is ..." constructions directly, and an article on a
  // subject that never states what it is has nothing for them to lift.
  const primary = input.seo.configuration.targetQuery?.trim();
  if (primary && document.wordCount > 0) {
    const escaped = primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const definition = new RegExp(
      `\\b${escaped}\\b\\s+(?:is|are|means|refers to|describes|stands for)\\b`,
      'i',
    );

    if (!definition.test(document.plainText)) {
      findings.push(
        finding({
          code: 'no_definition_statement',
          category: 'citability',
          dimension: 'ai_search',
          severity: 'recommendation',
          origin: 'deterministic',
          summary: `The article never states plainly what "${primary}" is.`,
          explanation:
            'Answer engines lift definition sentences almost verbatim. An article about a subject that never defines it gives them nothing to quote for the most basic question asked about it.',
          recommendation: `Include one plain sentence of the form "${primary} is ..." where it fits naturally. One is enough.`,
          element: 'body',
          locator: null,
          confidence: 1,
        }),
      );
    }
  }
}

export function runDeterministicAnalysis(input: DeterministicInput): DeterministicResult {
  const findings: SeoFinding[] = [];

  checkTitles(input, findings);
  checkMetaDescription(input, findings);
  checkSlug(input, findings);
  checkHeadings(input, findings);
  checkContent(input, findings);
  const keywordUsage = analyseKeywords(input, findings);
  const readability = checkReadability(input, findings);
  checkLinks(input, findings);
  checkAiSearch(input, findings);
  const imageRequirements = checkImages(input, findings);

  const { document } = input;
  const diagnostics: SeoDiagnostics = {
    wordCount: document.wordCount,
    sentenceCount: document.sentences.length,
    paragraphCount: document.paragraphs.length,
    headingCount: document.headings.length,
    averageSentenceWords: document.sentences.length
      ? Number((document.wordCount / document.sentences.length).toFixed(1))
      : null,
    longSentenceCount: readability.long,
    longParagraphCount: readability.longParagraphs,
    internalLinkCount: document.links.filter((link) => link.isInternal).length,
    externalLinkCount: document.links.filter((link) => link.isExternal).length,
    imageCount: document.images.length,
    imagesMissingAlt: document.images.filter((image) => image.missingAlt).length,
    keywordUsage,
    estimatedReadingMinutes: document.wordCount
      ? Math.max(1, Math.round(document.wordCount / READING_SPEED_WPM))
      : null,
    readingSpeedWpm: READING_SPEED_WPM,
  };

  return { findings, diagnostics, imageRequirements };
}
