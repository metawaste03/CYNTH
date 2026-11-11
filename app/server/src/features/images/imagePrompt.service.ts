import { getArticleById } from '../articles/articles.repository.js';
import { getThemeById } from '../content/content.repository.js';
import { listArticleProducts } from '../articles/articleProducts.repository.js';
import { directFeaturedImage } from './imageDirection.service.js';
import { cleanSceneDescription, findTextRisk } from './imageDirection.service.js';
import type { ImageStyle } from './imageDirection.service.js';
import { isGenerationError } from '../generation/generation.errors.js';

/**
 * WHAT CYNTH ASKS FOR WHEN IT DRAWS A FEATURED IMAGE.
 *
 * Rewritten in Milestone 40, because the original was the wrong shape and the
 * images showed it.
 *
 * WHAT WAS WRONG. The prompt was a specification document — headed sections,
 * a style list, and a block of HARD RULES — handed to a diffusion model. Three
 * consequences, all of them visible in the output:
 *
 *   1. Diffusion models weight tokens; they do not parse documents. Half the
 *      prompt was meta-instruction diluting the actual subject.
 *   2. The prohibitions were negations. "Do not depict any product, brand,
 *      logo, packaging or trademark" pushes all five words into the
 *      conditioning, and the image adapter has no negative-prompt parameter
 *      to put them in instead.
 *   3. Nothing decided what to DRAW. "Something that evokes the subject" left
 *      an editorial judgement to a model that resolves it with the nearest
 *      cliché: a floating brain for an article about creatine, a premium
 *      standing desk for an article about spending nothing.
 *
 * WHAT IT IS NOW. Two stages. `imageDirection.service.ts` reads the article
 * and decides one concrete scene; this file wraps that scene in a short,
 * plain, positive description of how it should be photographed. The image
 * model receives prose about a photograph, which is what it is good at, and
 * is never asked to interpret an editorial abstraction.
 *
 * THE CONSTRAINTS ARE NOT RELAXED. They moved to the stage that can honour
 * them. "Do not name a real product" is trivial for a language model and
 * nearly meaningless to a diffusion model — which is why asking the image
 * model was costing quality and buying no safety.
 *
 * The deterministic path below still exists for when the director is
 * unavailable, and is deliberately vaguer about the subject than it used to
 * be: without a scene, a shorter prompt produces a better generic image than
 * a longer one full of rules.
 */

export interface ImageBrief {
  prompt: string;
  /** What the prompt was built from, so the panel can show why the image looks like it does. */
  basis: {
    title: string;
    theme: string;
    topic: string;
    hasProducts: boolean;
    /** The scene the director chose, or null when the deterministic path was used. */
    scene: string | null;
    /** Which model chose the scene. Null on the deterministic path. */
    directedBy: string | null;
    /** Set when the chosen scene still names something printed, so a garbled image is explained rather than surprising. */
    concern?: string | null;
  };
}

/**
 * How the photograph is taken, appended to whatever scene is being shot.
 *
 * Positive and short. Every clause here describes something to DO, because a
 * clause describing something to avoid would put it back in the prompt.
 */
const CAMERA = [
  'Editorial photograph for the top of a magazine article.',
  'Natural light, shallow depth of field, one clear subject, generous empty space around it.',
  // "Slightly imperfect" compounded with a worn subject into actual dirt:
  // sediment floating in a water bottle, stained pillowcases. The intent was
  // unstyled, not unclean, so it now says that.
  'Restrained colour, real materials, everyday wear — clean, not styled.',
  'Wide 16:9 framing that still reads when cropped.',
].join(' ');

/**
 * The one negative clause kept.
 *
 * Text is the exception worth stating to the image model directly: every model
 * still garbles lettering, the failure is unmistakable, and unlike a brand or
 * a product it cannot be prevented upstream — a scene can be entirely
 * text-free and the model will still invent a sign. Kept to a single short
 * clause rather than a list, so it costs as little prompt weight as possible.
 */
const NO_TEXT = 'No text, letters, numbers or signage anywhere in the frame.';

/**
 * How the illustration is drawn.
 *
 * The photographic clause actively fights a drawn idea: "natural light,
 * shallow depth of field" applied to a thought bubble produces a photograph
 * with a cartoon pasted into it. This one asks for a drawing and says so once.
 */
const ILLUSTRATION = [
  'Editorial illustration for the top of a magazine article.',
  'Clean flat vector style, a small restrained palette, confident simple shapes, generous empty space.',
  'Drawn throughout — no photographic elements mixed in.',
  'Wide 16:9 framing that still reads when cropped.',
].join(' ');

type Facts =
  | { ok: false; error: string }
  | {
      ok: true;
      article: NonNullable<ReturnType<typeof getArticleById>>;
      theme: ReturnType<typeof getThemeById>;
      title: string;
      topic: string;
      products: ReturnType<typeof listArticleProducts>;
    };

function articleFacts(articleId: number): Facts {
  const article = getArticleById(articleId);
  if (!article) return { ok: false, error: 'Article not found.' };

  const theme = article.themeId ? getThemeById(article.themeId) : null;
  const title = article.title?.trim() || article.generated?.title?.trim() || '';
  const topic = article.topic?.trim() || '';

  if (!title && !topic) {
    // Without either, there is nothing to draw ABOUT, and a model handed an
    // empty brief invents a subject. Better to say so.
    return {
      ok: false,
      error: 'This draft has no title or topic yet, so there is nothing for an image to be about.',
    };
  }

  return { ok: true, article, theme, title, topic, products: listArticleProducts(articleId) };
}

/**
 * The prompt, with a scene chosen by the director.
 *
 * Falls back to the deterministic prompt when the director cannot run, so a
 * missing model configuration degrades the image rather than removing the
 * feature. The brief says which path was taken, so a poor image can always be
 * traced to the reason.
 */
export async function buildFeaturedImagePrompt(
  articleId: number,
  steer?: string | null,
  style: ImageStyle = 'photograph',
  chosenScene?: string | null,
  allowText = false,
): Promise<ImageBrief | { error: string }> {
  const facts = articleFacts(articleId);
  if (!facts.ok) return { error: facts.error };

  const { article, theme, title, topic, products } = facts;

  /**
   * A SCENE THE EDITOR ALREADY APPROVED.
   *
   * Previewing the prompt and drawing it were two separate runs of the
   * director, so the scene an editor read was never the scene that got drawn.
   * On an article whose subject has no obvious image, that turned "try again"
   * into a four-cent lottery — reported after three runs produced three
   * unrelated pictures.
   *
   * Given a scene, the director does not run at all. The printed-text check
   * still does: an editor pasting "a receipt on the counter" should be told,
   * not quietly charged for garbled lettering.
   */
  if (chosenScene?.trim()) {
    const scene = cleanSceneDescription(chosenScene);
    const risk = allowText ? null : findTextRisk(scene);

    return {
      prompt: [scene, style === 'illustration' ? ILLUSTRATION : CAMERA, allowText ? '' : NO_TEXT]
        .filter(Boolean)
        .join(' '),
      basis: {
        title,
        theme: theme?.name ?? '',
        topic,
        hasProducts: products.length > 0,
        scene,
        directedBy: null,
        concern: !allowText && risk ? `This scene mentions "${risk}", so the image may contain lettering.` : null,
      },
    };
  }

  try {
    const direction = await directFeaturedImage({
      title,
      topic,
      themeName: theme?.name ?? '',
      audience: article.targetAudience?.trim() ?? '',
      body: article.generated?.content?.trim() ?? '',
      steer: steer?.trim() || null,
      style,
      allowText,
    });

    return {
      prompt: [direction.scene, style === 'illustration' ? ILLUSTRATION : CAMERA, allowText ? '' : NO_TEXT]
        .filter(Boolean)
        .join(' '),
      basis: {
        title,
        theme: theme?.name ?? '',
        topic,
        hasProducts: products.length > 0,
        scene: direction.scene,
        directedBy: direction.model,
        concern: direction.concern,
      },
    };
  } catch (error) {
    // A spend refusal is the caller's business, not something to paper over
    // with a worse image.
    if (isGenerationError(error) && (error.code === 'cost_confirmation_required' || error.code === 'paid_generation_blocked')) {
      throw error;
    }

    return {
      prompt: buildDeterministicPrompt({ title, topic, themeName: theme?.name ?? '', steer: steer?.trim() || null }),
      basis: {
        title,
        theme: theme?.name ?? '',
        topic,
        hasProducts: products.length > 0,
        scene: null,
        directedBy: null,
      },
    };
  }
}

/**
 * The prompt used when no model can choose a scene.
 *
 * Deliberately short and deliberately unambitious. With nothing deciding what
 * to show, the honest goal is a competent, non-embarrassing image rather than
 * a relevant one — so this asks for a simple environmental photograph and
 * says as little else as possible.
 */
export function buildDeterministicPrompt(input: {
  title: string;
  topic: string;
  themeName: string;
  steer: string | null;
}): string {
  const subject = input.steer || input.topic || input.title;

  return [
    `A quiet, real-world environmental photograph suggesting the setting of: ${subject}.`,
    'Everyday unbranded objects, no people in focus.',
    CAMERA,
    NO_TEXT,
  ].join(' ');
}

/** The synchronous brief, for callers that only need to know what the image would be about. */
export function describeImageBasis(articleId: number): ImageBrief['basis'] | { error: string } {
  const facts = articleFacts(articleId);
  if (!facts.ok) return { error: facts.error };

  return {
    title: facts.title,
    theme: facts.theme?.name ?? '',
    topic: facts.topic,
    hasProducts: facts.products.length > 0,
    scene: null,
    directedBy: null,
  };
}
