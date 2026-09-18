import { getArticleById } from '../articles/articles.repository.js';
import { getThemeById } from '../content/content.repository.js';
import { listArticleProducts } from '../articles/articleProducts.repository.js';

/**
 * WHAT CYNTH ASKS FOR WHEN IT DRAWS A FEATURED IMAGE (Milestone 25).
 *
 * Cynth has exactly one prompt-building system for text, and this is the same
 * idea for images: the prompt is assembled from what is stored about the
 * article, never typed by hand into a route.
 *
 * Three constraints are non-negotiable, and they are here rather than in the
 * UI so that no caller can generate an image without them.
 *
 *   NO REAL PRODUCTS. EveryFiveDays recommends real things people can buy.
 *   An image model asked for "hiking backpacks" will happily draw a
 *   photorealistic backpack that does not exist, with an invented logo, and
 *   on a page that earns commission that is a misleading picture of a
 *   product, not a stylistic choice. Featured images are therefore
 *   conceptual, scene-level or abstract, and real products are photographed
 *   rather than drawn.
 *
 *   NO BRANDS OR LOGOS. Same reason, and it also keeps Cynth clear of
 *   reproducing marks it has no licence to.
 *
 *   NO TEXT. Image models still garble lettering, and a headline rendered
 *   with a misspelling is worse than no headline. If EveryFiveDays wants the
 *   title over the image it belongs in the page template, where it is real
 *   selectable text, not pixels.
 */

export interface ImageBrief {
  prompt: string;
  /** What the prompt was built from, so the panel can show why the image looks like it does. */
  basis: { title: string; theme: string; topic: string; hasProducts: boolean };
}

const HARD_RULES = [
  'Do not depict any identifiable real-world product, brand, logo, packaging or trademark.',
  'Do not render any text, lettering, numbers, captions, watermarks or signage anywhere in the image.',
  'Do not depict recognisable real people or celebrities.',
  'No collage, no split panels, no borders, no UI mockups, no infographic layout.',
];

const STYLE = [
  'Editorial photography or clean illustrative style suitable for the top of a magazine article.',
  'One clear subject, generous negative space, natural depth of field, restrained colour palette.',
  'Wide 16:9 composition that survives being cropped at the edges.',
];

export function buildFeaturedImagePrompt(articleId: number, steer?: string | null): ImageBrief | { error: string } {
  const article = getArticleById(articleId);
  if (!article) return { error: 'Article not found.' };

  const theme = article.themeId ? getThemeById(article.themeId) : null;
  const title = article.title?.trim() || article.generated?.title?.trim() || '';
  const topic = article.topic?.trim() || '';

  if (!title && !topic) {
    // Without either, there is nothing to draw ABOUT, and a model handed an
    // empty brief invents a subject. Better to say so.
    return { error: 'This draft has no title or topic yet, so there is nothing for an image to be about.' };
  }

  const products = listArticleProducts(articleId);

  const prompt = [
    'Create a featured image for an online magazine article.',
    '',
    '=== WHAT THE ARTICLE IS ABOUT ===',
    title ? `Title: ${title}` : '',
    topic ? `Subject: ${topic}` : '',
    theme?.name ? `Section: ${theme.name}` : '',
    theme?.description ? `What that section covers: ${theme.description}` : '',
    article.targetAudience ? `Written for: ${article.targetAudience}` : '',
    steer?.trim() ? `The editor also asks for: ${steer.trim()}` : '',
    '',
    '=== WHAT TO DRAW ===',
    'Something that evokes the subject: the setting it happens in, the moment it describes, the materials or environment involved, or an abstract representation of the idea.',
    products.length
      ? 'This article recommends real products. Do NOT attempt to draw them — suggest the activity or context they belong to instead.'
      : '',
    '',
    '=== STYLE ===',
    ...STYLE,
    '',
    '=== HARD RULES ===',
    ...HARD_RULES,
  ]
    .filter((line) => line !== '')
    .join('\n');

  return {
    prompt,
    basis: {
      title,
      theme: theme?.name ?? '',
      topic,
      hasProducts: products.length > 0,
    },
  };
}
