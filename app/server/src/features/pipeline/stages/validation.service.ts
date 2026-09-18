import { getDatabase } from '../../../shared/database/index.js';
import { beginStageRun, completeStageRun, getPipelineById, setState } from '../pipeline.repository.js';
import type { StageRunDto } from '../pipeline.repository.js';
import { getTemplate } from '../../templates/templates.repository.js';
import { lengthBandFor } from '../../templates/articleLength.service.js';
import { getArticleById } from '../../articles/articles.repository.js';
import { resolveProductIdsForArticle } from '../../articles/articleProducts.repository.js';
import { PRODUCT_MARKER_PATTERN } from '../../prompt-builder/promptBuilder.service.js';
import type { GeneratedArticle } from './generationStages.service.js';

/**
 * FINAL VALIDATION — deterministic, and the thing that replaces a second review.
 *
 * After the one permitted revision Cynth does not ask a model whether the
 * article is good. It checks, in code, whether the article is COMPLETE: the
 * required sections, the template's own rules, the keyword, the title, the
 * links, the product references, and the absence of obvious damage.
 *
 * The distinction matters. A model can always find something else to improve,
 * which is how an editorial loop becomes unbounded. This asks a narrower
 * question with a finite answer: is anything missing, malformed or broken?
 *
 * READY when nothing is. NEEDS_EDITORIAL_ATTENTION when something is — and
 * that is a handover to a person, not a failure.
 */

export type ValidationSeverity = 'blocking' | 'warning';

export interface ValidationFinding {
  severity: ValidationSeverity;
  check: string;
  detail: string;
}

export interface ValidationResult {
  passed: boolean;
  findings: ValidationFinding[];
  checked: string[];
  wordCount: number;
}

/** Markers are stripped before counting: a marker is a placement instruction, not prose. */
function countWords(article: GeneratedArticle): number {
  const text = [
    ...article.sections.map((section) => section.body),
    ...article.faq.map((entry) => `${entry.question} ${entry.answer}`),
  ]
    .join(' ')
    .replace(/\[\[product:\d+\]\]/g, ' ')
    .trim();

  return text ? text.split(/\s+/).length : 0;
}

/** Bracketed text a writer leaves behind, e.g. [INSERT PRICE] or {{topic}}. */
const PLACEHOLDER_PATTERNS = [/\[[A-Z][A-Z _-]{3,}\]/, /\{\{[^}]+\}\}/, /\bTODO\b/, /\bTBD\b/, /\bLorem ipsum\b/i];

export function validateArticle(pipelineId: number): ValidationResult | null {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return null;

  const article = getArticleById(pipeline.articleId);
  if (!article) return null;

  const findings: ValidationFinding[] = [];
  const checked: string[] = [];

  const raw = article.structuredContent;
  const stored = raw
    ? (() => {
        try {
          return JSON.parse(raw) as GeneratedArticle;
        } catch {
          return null;
        }
      })()
    : null;

  if (!stored) {
    return {
      passed: false,
      wordCount: 0,
      checked: ['structured content'],
      findings: [
        {
          severity: 'blocking',
          check: 'structured content',
          detail: 'The article has no structured content, so nothing can be validated. Generate it first.',
        },
      ],
    };
  }

  const templateId = article.templateId;
  const templateVersion = article.templateVersion;
  const template = templateId ? getTemplate(templateId, templateVersion ?? undefined) : null;

  /* ---- required sections ------------------------------------------------ */
  checked.push('required sections');
  if (!template) {
    findings.push({
      severity: 'blocking',
      check: 'required sections',
      detail: 'The article records no template, so its required sections are unknown.',
    });
  } else {
    const present = new Map(stored.sections.map((section) => [section.key, section]));

    for (const required of template.contentSchema.sections.filter((section) => section.required)) {
      /**
       * The FAQ is a section in the template but its own structured field on
       * the article, because a question-and-answer list is not prose and the
       * CMS renders it separately. It is satisfied either way — by a section
       * with that key, or by entries in the faq array.
       */
      if (required.kind === 'faq' && stored.faq.length > 0) continue;

      const section = present.get(required.key);
      if (!section) {
        findings.push({
          severity: 'blocking',
          check: 'required sections',
          detail: `The "${required.heading}" section (${required.key}) is missing.`,
        });
        continue;
      }
      if (required.minWords) {
        const words = section.body.trim().split(/\s+/).length;
        if (words < required.minWords) {
          findings.push({
            severity: 'warning',
            check: 'section length',
            detail: `"${required.heading}" is ${words} words; the template asks for at least ${required.minWords}.`,
          });
        }
      }
    }

    // A section the template does not define is not an error — but it will not
    // render under a known layout, so the editor is told.
    const known = new Set(template.contentSchema.sections.map((section) => section.key));
    for (const section of stored.sections) {
      if (!known.has(section.key)) {
        findings.push({
          severity: 'warning',
          check: 'unknown section',
          detail: `"${section.key}" is not part of ${template.templateId} v${template.version} and may not render.`,
        });
      }
    }

    /* ---- template rules -------------------------------------------------- */
    checked.push('template rules');
    if (template.contentSchema.requiresFaq && stored.faq.length === 0) {
      findings.push({ severity: 'blocking', check: 'template rules', detail: 'This template requires an FAQ, and none was written.' });
    }
    if (template.contentSchema.requiresSources && stored.sources.length === 0) {
      findings.push({
        severity: 'blocking',
        check: 'template rules',
        detail: 'This template requires cited sources, and none were supplied.',
      });
    }

    checked.push('article length');
    const wordCount = countWords(stored);
    const band = lengthBandFor(template.contentSchema);

    if (wordCount < band.minWords) {
      findings.push({
        severity: 'warning',
        check: 'article length',
        detail: `The article is ${wordCount} words; the template asks for at least ${band.minWords}.`,
      });
    }

    // Reported, never truncated. Cutting an article off mid-argument to meet a
    // number is worse than a long article, and the editor is the one who
    // decides what goes.
    if (wordCount > band.maxWords) {
      findings.push({
        severity: 'warning',
        check: 'article length',
        detail:
          `The article is ${wordCount} words; the ceiling is ${band.maxWords}` +
          `${band.cappedByHouseLimit ? ' (the publication-wide limit, which is lower than this template allows)' : ''}. ` +
          'Nothing was cut — decide what to remove.',
      });
    }
  }

  /* ---- title and metadata ---------------------------------------------- */
  checked.push('title and metadata');
  if (!stored.title.trim()) {
    findings.push({ severity: 'blocking', check: 'title and metadata', detail: 'The article has no title.' });
  }
  if (!stored.excerpt.trim()) {
    findings.push({ severity: 'warning', check: 'title and metadata', detail: 'The article has no excerpt for the listing page.' });
  }
  if (!article.articleTypeSlug) {
    findings.push({
      severity: 'blocking',
      check: 'title and metadata',
      detail: 'The article records no article type, so EveryFiveDays cannot choose a presentation template.',
    });
  }

  /* ---- keywords --------------------------------------------------------- */
  checked.push('keyword presence');
  const primaryKeyword = article.keywords?.primaryKeyword?.trim();
  if (primaryKeyword) {
    const haystack = [stored.title, ...stored.sections.map((s) => s.body)].join(' ').toLowerCase();
    if (!haystack.includes(primaryKeyword.toLowerCase())) {
      findings.push({
        severity: 'warning',
        check: 'keyword presence',
        detail: `The primary keyword "${primaryKeyword}" does not appear in the article.`,
      });
    }
  }

  /* ---- products --------------------------------------------------------- */
  checked.push('product references');
  const attached = new Set(resolveProductIdsForArticle(pipeline.articleId));
  const markers: number[] = [];
  for (const section of stored.sections) {
    for (const line of section.body.split(/\r?\n/)) {
      const match = PRODUCT_MARKER_PATTERN.exec(line);
      if (match) markers.push(Number(match[1]));
    }
  }

  for (const id of markers) {
    if (!attached.has(id)) {
      findings.push({
        severity: 'blocking',
        check: 'product references',
        detail: `The article references product ${id}, which is not attached to it. That card would not render.`,
      });
    }
  }
  const duplicated = markers.filter((id, index) => markers.indexOf(id) !== index);
  for (const id of new Set(duplicated)) {
    findings.push({
      severity: 'warning',
      check: 'product references',
      detail: `Product ${id} is placed more than once.`,
    });
  }

  /* ---- links ------------------------------------------------------------ */
  checked.push('links');
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const section of stored.sections) {
    for (const match of section.body.matchAll(linkPattern)) {
      const href = match[1].trim();
      if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) {
        findings.push({
          severity: 'blocking',
          check: 'links',
          detail: `"${href}" in ${section.key} is not a usable link target.`,
        });
      }
    }
  }
  for (const source of stored.sources) {
    if (!/^https?:\/\//i.test(source.url)) {
      findings.push({ severity: 'blocking', check: 'links', detail: `The source "${source.url}" is not a valid URL.` });
    }
  }

  /* ---- malformed and duplicate content ---------------------------------- */
  checked.push('malformed content');
  for (const section of stored.sections) {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(section.body)) {
        findings.push({
          severity: 'blocking',
          check: 'malformed content',
          detail: `"${section.heading}" still contains placeholder text.`,
        });
        break;
      }
    }
    // A section that stops mid-sentence usually means the model hit its output
    // limit — worth flagging rather than publishing a truncated article.
    const trimmed = section.body.trim();
    if (trimmed.length > 80 && !/[.!?)"'\]`]$/.test(trimmed)) {
      findings.push({
        severity: 'warning',
        check: 'malformed content',
        detail: `"${section.heading}" appears to end mid-sentence.`,
      });
    }
  }

  checked.push('duplicate content');
  const seen = new Map<string, string>();
  for (const section of stored.sections) {
    const fingerprint = section.body.trim().slice(0, 200).toLowerCase();
    if (fingerprint.length > 60 && seen.has(fingerprint)) {
      findings.push({
        severity: 'warning',
        check: 'duplicate content',
        detail: `"${section.heading}" repeats the opening of "${seen.get(fingerprint)}".`,
      });
    } else if (fingerprint.length > 60) {
      seen.set(fingerprint, section.heading);
    }
  }

  return {
    // Warnings do not block. A short section is a judgement call for a human;
    // a missing required section is not.
    passed: !findings.some((finding) => finding.severity === 'blocking'),
    findings,
    checked,
    wordCount: countWords(stored),
  };
}

/**
 * Runs validation as a pipeline stage and reaches a terminal state.
 *
 * This is where a run ends. There is no path from here back into an AI stage:
 * whatever the result, the next move is a person's.
 */
export function runFinalValidation(pipelineId: number): { run: StageRunDto; output: ValidationResult } | null {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return null;

  setState(pipelineId, 'FINAL_VALIDATION', { stage: 'final_validation' });

  const result = validateArticle(pipelineId);
  if (!result) return null;

  const run = beginStageRun({ pipelineId: pipeline.id, version: pipeline.version, stage: 'final_validation' });
  const completed = completeStageRun(run.id, { output: result });

  const blocking = result.findings.filter((finding) => finding.severity === 'blocking').length;
  const warnings = result.findings.length - blocking;

  if (result.passed) {
    setState(pipelineId, 'READY', {
      stage: 'final_validation',
      note: warnings ? `Validation passed with ${warnings} warning(s).` : 'Validation passed.',
    });
    getDatabase()
      .prepare(`UPDATE articles SET status = 'draft', updated_at = datetime('now') WHERE id = ?`)
      .run(pipeline.articleId);
  } else {
    setState(pipelineId, 'NEEDS_EDITORIAL_ATTENTION', {
      stage: 'final_validation',
      note: `Validation found ${blocking} blocking issue(s). Cynth stops here — the article needs a human editor.`,
    });
  }

  return { run: completed, output: result };
}
