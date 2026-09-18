import type { SeoFinding, SeoLocator } from './seo.types.js';
import {
  isValidCategory,
  isValidDimension,
  isValidSearchIntent,
  isValidSeverity,
  SEO_ELEMENTS,
} from './seo.constants.js';
import type { SearchIntent, SeoCategory, SeoDimension, SeoElement, SeoSeverity } from './seo.constants.js';
import type { SeoDocument } from './seoDocument.js';
import { excerptOf, stripInlineMarkdown } from './seoDocument.js';

/**
 * PARSING THE MODEL'S SEO ANALYSIS.
 *
 * Written on the assumption that the response is untrusted. A model asked for
 * strict JSON will sometimes wrap it in a code fence, add a sentence of
 * preamble, invent a severity that was not in the vocabulary, cite a
 * paragraph that does not exist, or reference an article id that was never
 * offered. Every one of those is handled by dropping the offending part, not
 * by repairing it into something plausible.
 *
 * The rule: anything that cannot be validated is discarded. A finding Cynth
 * cannot verify the shape of is a finding the user should never be shown, and
 * a fabricated one is worse than a missing one.
 */

export interface MissingConcept {
  concept: string;
  importance: 'essential' | 'valuable' | 'optional';
  why: string | null;
  confidence: number;
}

export interface ParsedIntentAssessment {
  detectedIntent: SearchIntent | null;
  matchesConfiguredIntent: boolean | null;
  satisfiesSearcher: boolean | null;
  reasoning: string | null;
  titleSatisfies: boolean | null;
  introductionSatisfies: boolean | null;
  structureSatisfies: boolean | null;
  contentSatisfies: boolean | null;
  conclusionSatisfies: boolean | null;
  confidence: number;
}

export interface ParsedProposal {
  value: string | null;
  rationale: string | null;
  confidence: number;
}

export interface ParsedInternalLink {
  targetArticleId: number;
  anchorText: string | null;
  reason: string | null;
  confidence: number;
}

export interface ParsedExternalSource {
  purpose: 'authority' | 'evidence' | 'factual_support' | 'reader_usefulness' | null;
  claimContext: string | null;
  sourceType: string | null;
  suggestedDomain: string | null;
  suggestedUrl: string | null;
  rationale: string | null;
  confidence: number;
}

export interface ParsedImageSuggestion {
  placement: string | null;
  purpose: string | null;
  altText: string | null;
  filename: string | null;
  caption: string | null;
}

export interface ParsedSeoAnalysis {
  intent: ParsedIntentAssessment | null;
  findings: SeoFinding[];
  coveredConcepts: string[];
  missingConcepts: MissingConcept[];
  missingQuestions: { question: string; why: string | null; confidence: number }[];
  missingEntities: { entity: string; why: string | null; confidence: number }[];
  relationships: string[];
  titleProposal: ParsedProposal | null;
  metaDescriptionProposal: ParsedProposal | null;
  slugProposal: ParsedProposal | null;
  internalLinks: ParsedInternalLink[];
  externalSources: ParsedExternalSource[];
  imageSuggestions: ParsedImageSuggestion[];
  /** What was dropped and why, so a thin analysis is explainable rather than mysterious. */
  discarded: string[];
}

export class SeoResponseParseError extends Error {}

/* ------------------------------------------------------------ helpers --- */

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Confidence is clamped to 0..1. A missing or nonsensical value becomes 0.5, and is treated as uncertain. */
function asConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.min(1, Math.max(0, numeric));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== null);
}

/**
 * Extracts the JSON object from a response that may be wrapped in a code
 * fence or padded with prose. Deliberately conservative: it finds the first
 * balanced top-level object and parses that, rather than trying to repair
 * malformed JSON, which would risk changing what the model actually said.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to brace scanning.
  }

  const start = candidate.indexOf('{');
  if (start === -1) throw new SeoResponseParseError('The model did not return a JSON object.');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch (error) {
          throw new SeoResponseParseError(
            `The model returned something that looked like JSON but could not be parsed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }
    }
  }

  throw new SeoResponseParseError('The model returned an incomplete JSON object.');
}

/* ------------------------------------------------------------ locator --- */

/**
 * Resolves a model's heading/excerpt reference to a real position in the
 * article.
 *
 * VERIFICATION, NOT TRUST: an excerpt is kept only when it genuinely occurs
 * in the article body, and a heading only when the article actually has it.
 * A quote the model invented is dropped, and the finding keeps whatever part
 * of its anchor did check out.
 */
export function resolveLocator(
  document: SeoDocument,
  headingText: string | null,
  excerpt: string | null,
): { locator: SeoLocator | null; excerptVerified: boolean } {
  let locator: SeoLocator | null = null;
  let excerptVerified = false;

  if (headingText) {
    const normalized = headingText.trim().toLowerCase();
    const heading = document.headings.find((entry) => entry.text.trim().toLowerCase() === normalized);
    if (heading) {
      locator = {
        heading: heading.text,
        headingPath: [...heading.path, heading.text],
        headingLevel: heading.level,
        startOffset: heading.startOffset,
        endOffset: heading.endOffset,
      };
    }
  }

  if (excerpt) {
    const needle = stripInlineMarkdown(excerpt).replace(/\s+/g, ' ').trim().toLowerCase();
    if (needle.length >= 12) {
      const haystack = document.plainText.replace(/\s+/g, ' ').toLowerCase();
      if (haystack.includes(needle)) {
        excerptVerified = true;
        const paragraph = document.paragraphs.find((entry) =>
          stripInlineMarkdown(entry.text).replace(/\s+/g, ' ').toLowerCase().includes(needle),
        );
        locator = {
          ...(locator ?? {}),
          excerpt: excerptOf(excerpt),
          paragraphIndex: paragraph?.index ?? locator?.paragraphIndex ?? null,
          startOffset: paragraph?.startOffset ?? locator?.startOffset ?? null,
          endOffset: paragraph?.endOffset ?? locator?.endOffset ?? null,
        };
      }
    }
  }

  return { locator, excerptVerified };
}

/* ----------------------------------------------------------- findings --- */

function parseFinding(
  raw: Record<string, unknown>,
  document: SeoDocument,
  discarded: string[],
): SeoFinding | null {
  const summary = asString(raw.summary);
  if (!summary) {
    discarded.push('A finding with no summary was discarded.');
    return null;
  }

  const category = raw.category;
  const dimension = raw.dimension;
  const severity = raw.severity;

  if (!isValidCategory(category)) {
    discarded.push(`A finding used an unknown category (${String(category)}) and was discarded: "${summary}"`);
    return null;
  }
  if (!isValidDimension(dimension)) {
    discarded.push(`A finding used an unknown dimension (${String(dimension)}) and was discarded: "${summary}"`);
    return null;
  }
  if (!isValidSeverity(severity)) {
    discarded.push(`A finding used an unknown severity (${String(severity)}) and was discarded: "${summary}"`);
    return null;
  }

  const rawElement = asString(raw.element);
  const element: SeoElement | null =
    rawElement && (SEO_ELEMENTS as readonly string[]).includes(rawElement) ? (rawElement as SeoElement) : null;

  const { locator, excerptVerified } = resolveLocator(document, asString(raw.heading), asString(raw.excerpt));

  // An unverifiable quote does not invalidate the finding, but it must not be
  // presented as a quotation from the article either.
  const explanation = asString(raw.explanation);
  const unverifiedNote =
    asString(raw.excerpt) && !excerptVerified
      ? ' (Cynth could not find the quoted passage in the article, so no excerpt is shown.)'
      : '';

  return {
    code: `ai_${category as SeoCategory}`,
    category: category as SeoCategory,
    dimension: dimension as SeoDimension,
    severity: severity as SeoSeverity,
    origin: 'ai',
    summary,
    explanation: explanation ? `${explanation}${unverifiedNote}` : unverifiedNote.trim() || null,
    recommendation: asString(raw.recommendation),
    element,
    locator,
    confidence: asConfidence(raw.confidence),
  };
}

/* -------------------------------------------------------------- parse --- */

export interface ParseOptions {
  document: SeoDocument;
  /** Article ids the model was allowed to reference. Anything else is dropped. */
  allowedArticleIds: Set<number>;
}

export function parseSeoAnalysisResponse(text: string, options: ParseOptions): ParsedSeoAnalysis {
  const parsed = extractJsonObject(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SeoResponseParseError('The model returned JSON that was not an object.');
  }

  const root = parsed as Record<string, unknown>;
  const discarded: string[] = [];
  const { document, allowedArticleIds } = options;

  /* ------------------------------------------------------------- intent */

  let intent: ParsedIntentAssessment | null = null;
  const rawIntent = root.intentAssessment;
  if (rawIntent && typeof rawIntent === 'object') {
    const entry = rawIntent as Record<string, unknown>;
    const detected = asString(entry.detectedIntent);
    intent = {
      detectedIntent: isValidSearchIntent(detected) ? detected : null,
      matchesConfiguredIntent: asBoolean(entry.matchesConfiguredIntent),
      satisfiesSearcher: asBoolean(entry.satisfiesSearcher),
      reasoning: asString(entry.reasoning),
      titleSatisfies: asBoolean(entry.titleSatisfies),
      introductionSatisfies: asBoolean(entry.introductionSatisfies),
      structureSatisfies: asBoolean(entry.structureSatisfies),
      contentSatisfies: asBoolean(entry.contentSatisfies),
      conclusionSatisfies: asBoolean(entry.conclusionSatisfies),
      confidence: asConfidence(entry.confidence),
    };
    if (detected && !isValidSearchIntent(detected)) {
      discarded.push(`The model reported an unknown search intent (${detected}), which was ignored.`);
    }
  }

  /* ----------------------------------------------------------- findings */

  const findings: SeoFinding[] = [];
  for (const raw of asArray(root.findings)) {
    if (!raw || typeof raw !== 'object') continue;
    const finding = parseFinding(raw as Record<string, unknown>, document, discarded);
    if (finding) findings.push(finding);
  }

  /* -------------------------------------------------- topical coverage */

  const coverage = (root.topicalCoverage ?? {}) as Record<string, unknown>;

  const missingConcepts: MissingConcept[] = asArray(coverage.missingConcepts)
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const entry = raw as Record<string, unknown>;
      const concept = asString(entry.concept);
      if (!concept) return null;
      const importance = asString(entry.importance);
      return {
        concept,
        importance:
          importance === 'essential' || importance === 'valuable' || importance === 'optional'
            ? importance
            : 'valuable',
        why: asString(entry.why),
        confidence: asConfidence(entry.confidence),
      } as MissingConcept;
    })
    .filter((entry): entry is MissingConcept => entry !== null);

  const missingQuestions = asArray(coverage.missingQuestions)
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const entry = raw as Record<string, unknown>;
      const question = asString(entry.question);
      if (!question) return null;
      return { question, why: asString(entry.why), confidence: asConfidence(entry.confidence) };
    })
    .filter((entry): entry is { question: string; why: string | null; confidence: number } => entry !== null);

  const missingEntities = asArray(coverage.missingEntities)
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const entry = raw as Record<string, unknown>;
      const entity = asString(entry.entity);
      if (!entity) return null;
      return { entity, why: asString(entry.why), confidence: asConfidence(entry.confidence) };
    })
    .filter((entry): entry is { entity: string; why: string | null; confidence: number } => entry !== null);

  /* ---------------------------------------------------------- proposals */

  const proposal = (value: unknown, key: string): ParsedProposal | null => {
    if (!value || typeof value !== 'object') return null;
    const entry = value as Record<string, unknown>;
    return {
      value: asString(entry[key]),
      rationale: asString(entry.rationale),
      confidence: asConfidence(entry.confidence),
    };
  };

  /* ------------------------------------------------------------- links */

  const internalLinks: ParsedInternalLink[] = [];
  for (const raw of asArray(root.internalLinkSuggestions)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const id = Number(entry.targetArticleId);

    // THE ANTI-INVENTION CHECK. An id the model was not given cannot become a
    // link, whatever it claims about it.
    if (!Number.isInteger(id) || !allowedArticleIds.has(id)) {
      discarded.push(
        `An internal link suggestion referenced article id ${String(entry.targetArticleId)}, which is not an article in Cynth. It was discarded.`,
      );
      continue;
    }

    internalLinks.push({
      targetArticleId: id,
      anchorText: asString(entry.anchorText),
      reason: asString(entry.reason),
      confidence: asConfidence(entry.confidence),
    });
  }

  const externalSources: ParsedExternalSource[] = [];
  for (const raw of asArray(root.externalSourceSuggestions)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const purpose = asString(entry.purpose);

    // A bare domain is acceptable; a full URL is stored only when the model
    // actually produced one, and is never presented as checked.
    const domain = asString(entry.suggestedDomain);
    const url = asString(entry.suggestedUrl);

    externalSources.push({
      purpose:
        purpose === 'authority' || purpose === 'evidence' || purpose === 'factual_support' || purpose === 'reader_usefulness'
          ? purpose
          : null,
      claimContext: asString(entry.claimContext),
      sourceType: asString(entry.sourceType),
      suggestedDomain: domain ? domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') : null,
      suggestedUrl: url,
      rationale: asString(entry.rationale),
      confidence: asConfidence(entry.confidence),
    });
  }

  const imageSuggestions: ParsedImageSuggestion[] = asArray(root.imageSuggestions)
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const entry = raw as Record<string, unknown>;
      const altText = asString(entry.altText);
      const placement = asString(entry.placement);
      if (!altText && !placement) return null;
      return {
        placement,
        purpose: asString(entry.purpose),
        altText,
        filename: asString(entry.filename),
        caption: asString(entry.caption),
      };
    })
    .filter((entry): entry is ParsedImageSuggestion => entry !== null);

  return {
    intent,
    findings,
    coveredConcepts: asStringArray(coverage.coveredConcepts),
    missingConcepts,
    missingQuestions,
    missingEntities,
    relationships: asStringArray(coverage.relationships),
    titleProposal: proposal(root.titleProposal, 'seoTitle'),
    metaDescriptionProposal: proposal(root.metaDescriptionProposal, 'metaDescription'),
    slugProposal: proposal(root.slugProposal, 'slug'),
    internalLinks,
    externalSources,
    imageSuggestions,
    discarded,
  };
}
