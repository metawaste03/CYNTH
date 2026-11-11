import type { ArticleDraftDto } from '../articles/articles.repository.js';
import type { GenerationContext } from '../generation/generationContext.service.js';
import type { StructuredDataOpportunity } from './seo.types.js';
import type { SeoDocument } from './seoDocument.js';
import { splitSentences, stripInlineMarkdown } from './seoDocument.js';

/**
 * STRUCTURED DATA OPPORTUNITIES.
 *
 * Determines which schema types an article could legitimately carry — and,
 * far more importantly, which it could not.
 *
 * The rule this file exists to enforce: eligibility is decided by whether the
 * required data actually exists, not by whether a schema type sounds
 * applicable. An article about a product is not eligible for Product schema
 * unless Cynth holds what Product schema requires. Claiming otherwise
 * produces markup that is either invalid or false, and both are worse than no
 * markup at all.
 *
 * Nothing here generates a schema document. It reports what is met, what is
 * missing, and whether the type is worth having; writing the JSON-LD is a
 * separate, human-approved step.
 */

interface EligibilityInput {
  article: ArticleDraftDto;
  document: SeoDocument;
  context: GenerationContext;
  hasAuthorName: boolean;
  hasPublishedDate: boolean;
}

/**
 * A question heading followed by an answer. Both halves are required — a
 * heading that ends in a question mark with nothing under it is not an FAQ
 * entry, and counting it would manufacture eligibility.
 */
function countAnsweredQuestions(document: SeoDocument): number {
  let count = 0;
  for (const section of document.sections) {
    if (section.headingIndex === null) continue;
    const heading = document.headings[section.headingIndex];
    // A question mark is required. A heading that merely opens with "How" is
    // usually a section title ("How torso length decides fit") rather than a
    // question, and counting it would manufacture eligibility for markup that
    // has to describe real question-and-answer pairs.
    const isQuestion = heading.text.trim().endsWith('?');
    if (isQuestion && section.wordCount >= 20) count += 1;
  }
  return count;
}

/**
 * Ordered, sequential steps. Looks for numbered headings or an ordered list
 * with enough items to be a procedure rather than an aside.
 */
function countProcedureSteps(document: SeoDocument): number {
  const numberedHeadings = document.headings.filter((heading) =>
    /^(?:step\s*)?\d+[.):]?\s+\S/i.test(heading.text.trim()),
  ).length;
  if (numberedHeadings >= 3) return numberedHeadings;

  // An ORDERED list of at least three substantial items. Bullet lists do
  // not count: a listicle of product picks is not a procedure, and
  // treating one as a sequence of steps would manufacture eligibility for
  // HowTo markup that the page cannot support.
  const orderedSteps = document.paragraphs.filter(
    (paragraph) => paragraph.isListItem && paragraph.listOrdered === true && paragraph.wordCount >= 5,
  );
  return orderedSteps.length >= 3 ? orderedSteps.length : 0;
}

function opportunity(
  type: string,
  label: string,
  met: string[],
  unmet: string[],
  recommended: boolean,
  rationale: string,
): StructuredDataOpportunity {
  return {
    type,
    label,
    eligible: unmet.length === 0,
    rationale,
    metRequirements: met,
    unmetRequirements: unmet,
    recommended: unmet.length === 0 && recommended,
  };
}

export function assessStructuredData(input: EligibilityInput): StructuredDataOpportunity[] {
  const { article, document, context } = input;
  const opportunities: StructuredDataOpportunity[] = [];

  /* ----------------------------------------------------------- Article --- */

  const articleMet: string[] = [];
  const articleUnmet: string[] = [];

  if (article.title?.trim() || article.generated?.title?.trim()) articleMet.push('A headline exists.');
  else articleUnmet.push('No headline: the article has no title.');

  if (document.wordCount > 0) articleMet.push('An article body exists.');
  else articleUnmet.push('No article body.');

  if (input.hasAuthorName) articleMet.push(`An author is attributed (${context.author?.name}).`);
  else articleUnmet.push('No author is attached to the article.');

  if (input.hasPublishedDate) articleMet.push('A date exists for the article.');
  else articleUnmet.push('No date: the article has not been generated or dated yet.');

  opportunities.push(
    opportunity(
      'Article',
      'Article',
      articleMet,
      articleUnmet,
      true,
      articleUnmet.length === 0
        ? 'Article schema describes an editorial page and asks for nothing Cynth does not already hold.'
        : 'Article schema needs a headline, a body, an author and a date. What is missing is listed above.',
    ),
  );

  /* --------------------------------------------------------------- FAQ --- */

  const answeredQuestions = countAnsweredQuestions(document);
  const faqMet: string[] = [];
  const faqUnmet: string[] = [];

  if (answeredQuestions >= 2) {
    faqMet.push(`${answeredQuestions} question headings each have a substantive answer beneath them.`);
  } else {
    faqUnmet.push(
      `FAQ schema needs at least two question-and-answer pairs in the visible page content; this article has ${answeredQuestions}.`,
    );
  }

  opportunities.push(
    opportunity(
      'FAQPage',
      'FAQ',
      faqMet,
      faqUnmet,
      true,
      faqUnmet.length === 0
        ? 'The article genuinely contains question-and-answer pairs, which is what FAQ markup is required to describe.'
        : 'FAQ markup must describe questions and answers that are actually visible on the page. Adding it without them is invalid.',
    ),
  );

  /* ------------------------------------------------------------ HowTo --- */

  const steps = countProcedureSteps(document);
  const howToMet: string[] = [];
  const howToUnmet: string[] = [];

  if (steps >= 3) howToMet.push(`${steps} ordered steps were found in the article.`);
  else howToUnmet.push(`HowTo schema needs a sequence of ordered steps; this article has ${steps}.`);

  const looksInstructional =
    /^(?:how to|how do|guide to)\b/i.test((article.title ?? article.generated?.title ?? '').trim()) ||
    /how-to|tutorial|guide/i.test(context.articleType?.name ?? '');

  opportunities.push(
    opportunity(
      'HowTo',
      'How-To',
      howToMet,
      howToUnmet,
      looksInstructional,
      howToUnmet.length === 0
        ? 'The article sets out an ordered procedure, which is what HowTo markup describes.'
        : 'HowTo markup describes a procedure with discrete, ordered steps. This article does not present one.',
    ),
  );

  /* ---------------------------------------------------------- Product --- */

  /**
   * Product schema is where "an article about a product" and "a page eligible
   * for Product markup" most often get confused. Cynth holds a product title
   * and description; it does not hold a price, a currency, an availability
   * state, a rating, or a review count. Those are what Product markup exists
   * to publish, and Cynth will not invent them.
   */
  const productMet: string[] = [];
  const productUnmet: string[] = [];

  if (context.product) {
    productMet.push(`A product is linked to this article (${context.product.title}).`);
    if (context.product.brand) productMet.push(`The product has a brand (${context.product.brand}).`);
    else productUnmet.push('The linked product has no brand recorded.');
  } else {
    productUnmet.push('No product is linked to this article.');
  }

  productUnmet.push(
    'Cynth stores no price, currency, availability, rating or review count, and Product markup is only valid with an offer or a review.',
  );

  opportunities.push(
    opportunity(
      'Product',
      'Product',
      productMet,
      productUnmet,
      false,
      'Not eligible. Product markup must carry offer or review data that Cynth does not hold, and inventing it would put false structured data on a real page.',
    ),
  );

  /* -------------------------------------------------------- BreadcrumbList */

  const breadcrumbMet: string[] = [];
  const breadcrumbUnmet: string[] = [];

  if (context.project && context.theme) {
    breadcrumbMet.push(`A hierarchy exists: ${context.project.name} → ${context.theme.name}.`);
  } else {
    breadcrumbUnmet.push('The article has no project/thematic-area hierarchy to describe as a breadcrumb trail.');
  }
  breadcrumbUnmet.push(
    'Breadcrumb markup must match navigation the site actually shows, which is a property of the CMS theme rather than of the article.',
  );

  opportunities.push(
    opportunity(
      'BreadcrumbList',
      'Breadcrumbs',
      breadcrumbMet,
      breadcrumbUnmet,
      false,
      'Deferred to the CMS. Breadcrumb markup has to reflect the live site navigation, which Cynth does not control.',
    ),
  );

  return opportunities;
}

/**
 * Builds an Article JSON-LD document from values Cynth actually holds.
 *
 * Deliberately minimal, and deliberately the only generator here: Article is
 * the one type whose requirements Cynth can satisfy without inventing
 * anything. Every field comes from a stored value; nothing is defaulted, and
 * an absent value produces an absent field rather than a plausible one.
 *
 * The result is a PROPOSAL. It is written into SEO metadata only when a human
 * approves it.
 */
export function buildArticleSchema(input: {
  headline: string;
  description: string | null;
  authorName: string | null;
  datePublished: string | null;
  canonicalUrl: string | null;
  wordCount: number | null;
  articleSection: string | null;
}): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.headline,
  };

  if (input.description) schema.description = input.description;
  if (input.authorName) schema.author = { '@type': 'Person', name: input.authorName };
  if (input.datePublished) schema.datePublished = input.datePublished;
  if (input.canonicalUrl) schema.mainEntityOfPage = { '@type': 'WebPage', '@id': input.canonicalUrl };
  if (input.wordCount) schema.wordCount = input.wordCount;
  if (input.articleSection) schema.articleSection = input.articleSection;

  return schema;
}

/**
 * Builds an FAQPage document from question headings that genuinely have
 * answers in the article.
 *
 * Returns null when the article does not qualify, rather than an empty or
 * padded structure — invalid markup is worse than none.
 */
export function buildFaqSchema(document: SeoDocument): Record<string, unknown> | null {
  const entries: { question: string; answer: string }[] = [];

  for (const section of document.sections) {
    if (section.headingIndex === null) continue;
    const heading = document.headings[section.headingIndex];
    // The same rule as the eligibility check: an explicit question mark, or
    // this heading is not an FAQ entry.
    const isQuestion = heading.text.trim().endsWith('?');
    if (!isQuestion || section.wordCount < 20) continue;

    const answer = section.paragraphIndexes
      .map((index) => stripInlineMarkdown(document.paragraphs[index].text))
      .join(' ')
      .trim();
    if (!answer) continue;

    // Keep the answer to the leading sentences: FAQ markup must reflect what
    // is on the page, and a shorter faithful quote is safer than a summary.
    const answerText = splitSentences(answer).slice(0, 4).join(' ');
    entries.push({ question: heading.text.trim(), answer: answerText || answer });
  }

  if (entries.length < 2) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}
