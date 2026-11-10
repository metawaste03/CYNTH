import { getDatabase } from '../../shared/database/index.js';
import { getArticleById } from '../articles/articles.repository.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { classifyModel, evaluateSpend } from '../generation/generationPolicy.service.js';
import { ARTICLE_GENERATION_TASK } from '../generation/generation.service.js';
import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import { listLinkTargets, resolvePublicUrl } from '../seo/linkTargets.service.js';
import { isCmsError } from './cms.errors.js';
import { listLinksForArticle, recordPush } from './cmsLinks.repository.js';
import { resolveCmsTarget } from './cmsPublish.service.js';

/**
 * LINKING OLDER ARTICLES TO A NEW ONE.
 *
 * A new article links out to older ones as it is written (linkTargets.service).
 * This is the other direction: once the new article is live, two or three
 * older, related articles should point at it, or nothing on the site leads a
 * reader — or Google — to it.
 *
 * IT EDITS THE LIVE POST, NOT CYNTH'S COPY. The obvious route is to change
 * Cynth's copy of the older article and push it again. That would be wrong
 * here: published posts have been edited on the site since Cynth last pushed
 * them, and a push would overwrite those edits with an older body. So this
 * reads the post as the site has it now, changes one sentence, and writes it
 * back.
 *
 * THE MODEL CHOOSES WORDS; IT NEVER WRITES THE POST. It is shown the older
 * article's paragraphs and asked one question: which few words, already
 * there, should carry the link? Cynth then wraps exactly those words itself.
 * The saved post differs from the one that was read by one `<a>` tag and
 * nothing else — checked by length before it is sent and by reading it back
 * afterwards. A model that answers badly produces no link, never a rewritten
 * article.
 *
 * NO LINK IS A LEGITIMATE ANSWER. An older article that never touches the new
 * one's subject is left alone. A link fitted where it does not belong is the
 * kind a reader learns to ignore.
 */

/** The guide's figure: two to three older articles linking in. */
export const DEFAULT_INBOUND_LINKS = 3;
/** How many older articles may be read looking for those. */
const MAX_CANDIDATES = 6;
const MIN_PARAGRAPH_CHARS = 80;
const MAX_PARAGRAPHS_IN_PROMPT = 40;

export interface InboundLinkResult {
  /** The new article's public address, which every link points at. */
  url: string;
  linked: { articleId: number; title: string; anchor: string }[];
  alreadyLinked: { articleId: number; title: string }[];
  skipped: { articleId: number; title: string; reason: string }[];
  model: string | null;
}

/* ------------------------------------------------------------ html helpers */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#039;': "'",
  '&#8217;': '’',
  '&#8216;': '‘',
  '&#8220;': '“',
  '&#8221;': '”',
  '&#8211;': '–',
  '&#8212;': '—',
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#\d+|[a-z]+);/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export interface PostParagraph {
  /** Where the paragraph's inner HTML starts in the post body. */
  start: number;
  inner: string;
  /** What a reader sees: tags removed, entities decoded. */
  text: string;
}

/** The body paragraphs a link could live in. Headings, lists, tables and shortcodes are not among them. */
export function listParagraphs(html: string): PostParagraph[] {
  const paragraphs: PostParagraph[] = [];
  const pattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const inner = match[1];
    const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (text.length < MIN_PARAGRAPH_CHARS) continue;
    paragraphs.push({ start: match.index + match[0].indexOf(inner), inner, text });
  }
  return paragraphs;
}

/**
 * Wraps `anchor` in a link inside one paragraph of `html`.
 *
 * Returns null when the words are not there as plain text: inside an existing
 * link, split across formatting, or simply not what the paragraph says. Null
 * means "do not touch the post".
 */
export function wrapAnchor(html: string, paragraph: PostParagraph, anchor: string, url: string): string | null {
  const wanted = anchor.trim();
  if (!wanted) return null;

  // The words as the model saw them, and as the stored HTML may spell them.
  const spellings = [...new Set([wanted, wanted.replace(/&/g, '&amp;'), wanted.replace(/’/g, '&#8217;'), wanted.replace(/’/g, "'")])];

  let offset = 0;
  let insideLink = 0;
  for (const piece of paragraph.inner.split(/(<[^>]+>)/)) {
    if (piece.startsWith('<')) {
      if (/^<a\b/i.test(piece)) insideLink += 1;
      else if (/^<\/a\s*>/i.test(piece)) insideLink = Math.max(0, insideLink - 1);
    } else if (!insideLink) {
      for (const spelling of spellings) {
        const at = piece.indexOf(spelling);
        if (at === -1) continue;
        // Whole words only: "sleep" must not link the middle of "sleepers".
        const before = piece[at - 1] ?? ' ';
        const after = piece[at + spelling.length] ?? ' ';
        if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue;

        const position = paragraph.start + offset + at;
        const link = `<a href="${escapeAttribute(url)}">${spelling}</a>`;
        const result = html.slice(0, position) + link + html.slice(position + spelling.length);
        // One tag added, nothing else moved.
        if (result.length !== html.length + link.length - spelling.length) return null;
        return result;
      }
    }
    offset += piece.length;
  }
  return null;
}

/** True when the post already links to the address, with or without its trailing slash. */
function alreadyLinks(html: string, url: string): boolean {
  const bare = url.replace(/\/+$/, '');
  return html.includes(`"${bare}"`) || html.includes(`"${bare}/"`) || html.includes(`'${bare}'`) || html.includes(`'${bare}/'`);
}

/* ------------------------------------------------------------------ prompt */

export function buildInboundLinkPrompt(
  target: { title: string; about: string },
  source: { title: string; paragraphs: PostParagraph[] },
): string {
  return [
    'You are choosing where one published article should link to another. You choose words; you do not write any.',
    '',
    '=== THE ARTICLE TO LINK TO ===',
    `Title: ${target.title}`,
    `About: ${target.about}`,
    '',
    `=== THE ARTICLE THE LINK GOES IN: ${source.title} ===`,
    'Its paragraphs, numbered:',
    ...source.paragraphs.slice(0, MAX_PARAGRAPHS_IN_PROMPT).map((paragraph, index) => `[${index + 1}] ${paragraph.text}`),
    '',
    '=== RULES ===',
    'Find the one sentence that is already about the subject of the article to link to.',
    'Choose two to seven consecutive words from that sentence to carry the link. Copy them exactly, character for character.',
    'Prefer a noun phrase naming the subject. Never "here", "this article" or "click".',
    'Do not choose words from the first paragraph.',
    'If no paragraph touches the subject, say so. No link is a correct answer; a forced one is not.',
    '',
    '=== OUTPUT ===',
    'Reply with JSON only, no commentary and no code fence:',
    '{"paragraph": <number>, "anchor": "<the exact words>"}',
    'or, when nothing fits:',
    '{"paragraph": null, "anchor": null}',
  ].join('\n');
}

export function parseAnchorChoice(text: string, paragraphCount: number): { paragraph: number; anchor: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const index = Number(parsed?.paragraph);
    const anchor = typeof parsed?.anchor === 'string' ? parsed.anchor.trim() : '';
    if (!Number.isInteger(index) || index < 2 || index > paragraphCount) return null;
    const words = anchor.split(/\s+/).filter(Boolean).length;
    if (words < 2 || words > 8) return null;
    return { paragraph: index - 1, anchor };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ record */

/** Records the link against the two articles, so the Opportunities panel shows it as made. */
function recordInserted(sourceArticleId: number, targetArticleId: number, anchor: string | null): void {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM seo_internal_links WHERE source_article_id = ? AND target_article_id = ? ORDER BY id LIMIT 1')
    .get(sourceArticleId, targetArticleId) as { id: number } | undefined;
  if (existing) {
    db.prepare(`UPDATE seo_internal_links SET status = 'inserted', anchor_suggestion = COALESCE(?, anchor_suggestion), anchor_found_in_source = 1 WHERE id = ?`).run(
      anchor,
      existing.id,
    );
    return;
  }
  db.prepare(
    `INSERT INTO seo_internal_links (source_article_id, target_article_id, anchor_suggestion, anchor_found_in_source, reason, origin, status)
     VALUES (?, ?, ?, 1, ?, 'deterministic', 'inserted')`,
  ).run(sourceArticleId, targetArticleId, anchor, 'Placed on the live post when the newer article was published.');
}

/* -------------------------------------------------------------------- main */

export async function linkOlderArticlesTo(
  articleId: number,
  options: { confirmedCost?: boolean; modelId?: number | null; limit?: number } = {},
): Promise<InboundLinkResult> {
  const article = getArticleById(articleId);
  if (!article) throw new GenerationError('invalid_configuration', 'Article not found.');

  const url = resolvePublicUrl(articleId);
  if (!url) {
    throw new GenerationError(
      'invalid_configuration',
      'This article is not published on the live site yet, so a link to it would not open. Publish it in WordPress first.',
    );
  }

  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(a.title), ''), a.generated_title, '') AS title, a.theme_id, a.topic,
              k.primary_keyword, k.secondary_keywords
       FROM articles a LEFT JOIN keywords k ON k.article_id = a.id WHERE a.id = ?`,
    )
    .get(articleId) as unknown as {
    title: string;
    theme_id: number | null;
    topic: string | null;
    primary_keyword: string | null;
    secondary_keywords: string | null;
  };
  const subject = [row.title, row.topic, row.primary_keyword, row.secondary_keywords].filter(Boolean).join(' ');
  const about = (row.topic?.trim() || row.primary_keyword?.trim() || row.title).slice(0, 200);

  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_INBOUND_LINKS, 5));
  const candidates = listLinkTargets(articleId, row.theme_id, subject, MAX_CANDIDATES);
  if (!candidates.length) {
    throw new GenerationError('invalid_configuration', 'No published article is related closely enough to link to this one.');
  }

  // Decided before anything is read or changed: each older article is one
  // small paid call, and nobody should learn the price from an invoice.
  const resolution = resolveProviderTarget(ARTICLE_GENERATION_TASK, options.modelId ?? null, 'internal linking');
  if (resolution.error) throw resolution.error;
  const provider = resolution.target!;
  const decision = evaluateSpend(classifyModel(resolution.route!.model!), options.confirmedCost === true);
  if (!decision.allowed) {
    throw new GenerationError(
      decision.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      decision.requiresConfirmation
        ? `Linking older articles to this one reads up to ${candidates.length} published posts and makes one small paid call ` +
            `on ${provider.modelName} for each. It changes one sentence in up to ${limit} live posts. Confirm to continue.`
        : (decision.reason ?? 'Paid generation is blocked.'),
    );
  }

  const result: InboundLinkResult = { url, linked: [], alreadyLinked: [], skipped: [], model: provider.modelName };

  for (const candidate of candidates) {
    if (result.linked.length + result.alreadyLinked.length >= limit) break;
    const entry = { articleId: candidate.articleId, title: candidate.title };
    const skip = (reason: string) => result.skipped.push({ ...entry, reason });

    const link = listLinksForArticle(candidate.articleId).find(
      (item) => item.externalStatus === 'publish' && item.externalUrl === candidate.url,
    );
    if (!link) {
      skip('Its live post could not be identified.');
      continue;
    }

    const started = Date.now();
    let cms: ReturnType<typeof resolveCmsTarget>;
    try {
      cms = resolveCmsTarget(link.connectionId);
    } catch (error) {
      skip(isCmsError(error) ? error.message : 'Its WordPress connection is not available.');
      continue;
    }
    if (!cms.connector.getPostBody || !cms.connector.updatePublishedBody) {
      skip('This kind of site does not support editing one sentence of a live post.');
      continue;
    }

    const history = (status: 'success' | 'failure', errorMessage: string | null = null) =>
      recordPush({
        articleId: candidate.articleId,
        connectionId: cms.connection.id,
        connectionName: cms.connection.name,
        siteUrl: cms.connection.baseUrl,
        operation: 'inbound_link',
        status,
        externalId: link.externalId,
        externalStatus: 'publish',
        errorMessage,
        durationMs: Date.now() - started,
      });

    try {
      const body = await cms.connector.getPostBody(link.externalId, cms.context);
      if (body === null) {
        skip('The post is no longer on the site.');
        continue;
      }
      if (alreadyLinks(body, url)) {
        result.alreadyLinked.push(entry);
        recordInserted(candidate.articleId, articleId, null);
        continue;
      }

      const paragraphs = listParagraphs(body);
      if (paragraphs.length < 2) {
        skip('Its live text has no ordinary paragraphs to link from.');
        continue;
      }

      const response = await provider.adapter.generate(
        {
          prompt: buildInboundLinkPrompt({ title: row.title, about }, { title: candidate.title, paragraphs }),
          model: provider.modelName,
          timeoutMs: 120_000,
        },
        { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
      );

      const choice = parseAnchorChoice(response.text ?? '', Math.min(paragraphs.length, MAX_PARAGRAPHS_IN_PROMPT));
      if (!choice) {
        skip('It never discusses this subject, so there are no words to link from.');
        continue;
      }

      const revised = wrapAnchor(body, paragraphs[choice.paragraph], choice.anchor, url);
      if (!revised) {
        skip(`The words chosen ("${choice.anchor.slice(0, 60)}") are not in that paragraph as plain text. Nothing was changed.`);
        continue;
      }

      await cms.connector.updatePublishedBody(link.externalId, revised, cms.context);

      // Claim only what is there.
      const saved = await cms.connector.getPostBody(link.externalId, cms.context);
      if (!saved || !alreadyLinks(saved, url)) {
        history('failure', 'The site accepted the edit but the link is not in the post.');
        skip('The site accepted the edit, but the link is not in the post. Check that post in WordPress.');
        continue;
      }

      history('success');
      recordInserted(candidate.articleId, articleId, choice.anchor);
      result.linked.push({ ...entry, anchor: choice.anchor });
    } catch (error) {
      const message = isCmsError(error) || isGenerationError(error)
        ? error.message
        : truncateForDisplay(redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [provider.apiKey]));
      history('failure', message);
      skip(message);
    }
  }

  return result;
}
