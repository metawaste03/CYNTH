import { getDatabase } from '../../../shared/database/index.js';
import { getPipelineById, beginStageRun, completeStageRun, findCompletedStage, setState } from '../pipeline.repository.js';
import type { StageRunDto } from '../pipeline.repository.js';
import { STAGE_DEFINITIONS } from '../pipeline.constants.js';
import { getDefaultTemplateForType, getTemplate } from '../../templates/templates.repository.js';
import type { TemplateDto } from '../../templates/templates.repository.js';
import { getArticleById } from '../../articles/articles.repository.js';
import { getAuthorById } from '../../authors/authors.repository.js';
import { listActiveSharedSkills, listActiveSkillsForAuthor } from '../../authors/authorSkills.repository.js';
import { getThemeById, getProjectById } from '../../content/content.repository.js';
import type { ArticleClassification, KeywordResearch, TopicResearch } from './researchStages.service.js';

/**
 * THE TWO STAGES CYNTH PERFORMS ITSELF.
 *
 * The brief and the template choice cost nothing and call nothing: they are
 * assembly, not thinking. Everything in the brief was already established and
 * paid for by an earlier stage, so deriving it again from a model would be
 * paying twice for an answer Cynth already has.
 *
 * They are still recorded as stage runs, because a resumable pipeline needs
 * every step to have happened exactly once and to be readable afterwards.
 */

/* --------------------------------------------------- template selection --- */

export interface TemplateSelection {
  templateId: string;
  templateVersion: number;
  name: string;
  articleTypeSlug: string;
  /** True when the type had no template of its own and a similar one was used. */
  borrowed: boolean;
  sectionKeys: string[];
}

export function selectTemplate(
  pipelineId: number,
  classification: ArticleClassification,
  options: { templateIdOverride?: string | null } = {},
): { run: StageRunDto; output: TemplateSelection; reused: boolean } {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found.');

  const existing = findCompletedStage(pipeline.id, pipeline.version, 'template_selection');
  if (existing) {
    return { run: existing, output: existing.output as TemplateSelection, reused: true };
  }

  const template: TemplateDto | null = options.templateIdOverride
    ? getTemplate(options.templateIdOverride)
    : getDefaultTemplateForType(classification.articleType);

  if (!template) {
    throw new Error(
      `No template is registered for article type "${classification.articleType}". Seed the template registry, or add one.`,
    );
  }

  const run = beginStageRun({ pipelineId: pipeline.id, version: pipeline.version, stage: 'template_selection' });

  const output: TemplateSelection = {
    templateId: template.templateId,
    templateVersion: template.version,
    name: template.name,
    articleTypeSlug: classification.articleType,
    borrowed: template.articleTypeSlug !== classification.articleType,
    sectionKeys: template.contentSchema.sections.map((section) => section.key),
  };

  // The article carries the type and template it was written to, so
  // EveryFiveDays can resolve a presentation template later without
  // re-deriving anything.
  const db = getDatabase();
  db.prepare(
    `UPDATE articles SET article_type_slug = ?, template_id = ?, template_version = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(classification.articleType, template.templateId, template.version, pipeline.articleId);

  const completed = completeStageRun(run.id, { output });
  setState(pipelineId, STAGE_DEFINITIONS.template_selection.completeState, { stage: 'template_selection' });

  return { run: completed, output, reused: false };
}

/**
 * Records a human's override of the classifier.
 *
 * Stored as an override rather than as the classifier's own answer, so "the
 * model said X, the editor chose Y" stays visible.
 */
export function overrideArticleType(
  articleId: number,
  articleTypeSlug: string,
): { error: string } | { ok: true; selection: TemplateSelection } {
  const template = getDefaultTemplateForType(articleTypeSlug);
  if (!template) return { error: `No template is registered for "${articleTypeSlug}".` };

  const db = getDatabase();
  db.prepare(
    `UPDATE articles SET article_type_slug = ?, article_type_override = 1, template_id = ?, template_version = ?,
       updated_at = datetime('now') WHERE id = ?`,
  ).run(articleTypeSlug, template.templateId, template.version, articleId);

  // The replacement selection is returned rather than written over the
  // template_selection stage run. The stage run is the record of what the
  // CLASSIFIER decided, and overwriting it would erase the disagreement this
  // function exists to preserve.
  return {
    ok: true,
    selection: {
      templateId: template.templateId,
      templateVersion: template.version,
      name: template.name,
      articleTypeSlug,
      borrowed: template.articleTypeSlug !== articleTypeSlug,
      sectionKeys: template.contentSchema.sections.map((section) => section.key),
    },
  };
}

/* ---------------------------------------------------------- the brief --- */

export interface ArticleBrief {
  theme: string;
  themeGuidance: string;
  topic: string;
  topicResearch: TopicResearch;
  audience: string;
  author: { name: string; personaSummary: string; skillNames: string[] };
  primaryKeyword: string;
  secondaryKeywords: string[];
  entities: string[];
  searchIntent: string;
  commercialIntent: string;
  articleType: string;
  articleTypeConfidence: number;
  recommendedAngle: string;
  contentGap: string;
  title: string;
  recommendedHeadings: string[];
  evidenceRequirements: string;
  affiliateOpportunities: string;
  template: TemplateSelection;
  editorialRules: string;
}

/**
 * Assembles the brief the writer receives.
 *
 * Reads only what is already stored. Where something is genuinely absent — no
 * author persona, no project rules — the field is empty rather than filled
 * with a plausible substitute.
 */
export function buildBrief(
  pipelineId: number,
  research: TopicResearch,
  keywords: KeywordResearch,
  classification: ArticleClassification,
  template: TemplateSelection,
): { run: StageRunDto; output: ArticleBrief; reused: boolean } {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new Error('Pipeline not found.');

  const existing = findCompletedStage(pipeline.id, pipeline.version, 'article_brief');
  if (existing) return { run: existing, output: existing.output as ArticleBrief, reused: true };

  const article = getArticleById(pipeline.articleId);
  const author = article?.authorId ? getAuthorById(article.authorId) : null;
  const theme = pipeline.themeId ? getThemeById(pipeline.themeId) : null;
  const project = article?.projectId ? getProjectById(article.projectId) : null;

  const skills = author ? listActiveSkillsForAuthor(author.id) : [];
  const shared = listActiveSharedSkills();

  const run = beginStageRun({ pipelineId: pipeline.id, version: pipeline.version, stage: 'article_brief' });

  const output: ArticleBrief = {
    theme: theme?.name ?? research.theme,
    themeGuidance: theme?.description ?? '',
    topic: research.topic,
    topicResearch: research,
    audience: research.audience,
    author: {
      name: author?.name ?? '',
      // A one-line summary only. The full persona and skill documents reach
      // the writer through the existing prompt builder, verbatim — repeating
      // them here would risk two versions of the same identity.
      personaSummary: author
        ? [author.expertise, author.perspective].filter(Boolean).join(' · ').slice(0, 500)
        : '',
      skillNames: [...skills, ...shared].map((skill) => skill.name),
    },
    primaryKeyword: keywords.primaryKeyword,
    secondaryKeywords: keywords.secondaryKeywords,
    entities: keywords.entities,
    searchIntent: keywords.searchIntent || research.likelySearchIntent,
    commercialIntent: keywords.commercialIntent,
    articleType: classification.articleType,
    articleTypeConfidence: classification.confidence,
    recommendedAngle: research.recommendedAngle,
    contentGap: research.contentGap,
    title: keywords.recommendedTitle,
    recommendedHeadings: keywords.recommendedHeadings,
    evidenceRequirements: research.researchSources.length
      ? 'Attribute claims to the sources identified during research where they are used.'
      : 'No sources were captured during research. Do not manufacture citations — write what can be supported without them, and say where certainty is limited.',
    affiliateOpportunities: research.commercialOpportunity,
    template,
    editorialRules: project?.editorialGuidance ?? '',
  };

  const completed = completeStageRun(run.id, { output });
  setState(pipelineId, STAGE_DEFINITIONS.article_brief.completeState, { stage: 'article_brief' });

  return { run: completed, output, reused: false };
}
