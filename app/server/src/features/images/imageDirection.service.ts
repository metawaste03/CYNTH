import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import type { ResolvedTarget } from '../generation/providerTarget.service.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { classifyModel, evaluateSpend } from '../generation/generationPolicy.service.js';

/**
 * DECIDING WHAT THE FEATURED IMAGE SHOWS.
 *
 * The problem this solves, stated plainly because it produced months of bad
 * images: Cynth was handing a diffusion model an abstract editorial title and
 * a list of prohibitions, and asking it to "evoke the subject". Two things
 * follow from that, and both were visible in the output.
 *
 *   A DIFFUSION MODEL CANNOT MAKE AN EDITORIAL DECISION. Asked to evoke
 *   "Creatine for Cognition", it reaches for the nearest visual cliché —
 *   a floating brain with blue particles. Asked to evoke an article about
 *   fixing your posture WITHOUT spending money, it drew a premium standing
 *   desk with an external monitor, which is the opposite of the argument.
 *   Neither is a model failing; it is a model being asked the wrong question.
 *
 *   NEGATIONS PUT THE THING IN THE PROMPT. "Do not depict any product, brand,
 *   logo, packaging or trademark" pushes every one of those words into the
 *   conditioning. Image models have no reliable NOT operator, and Cynth's
 *   image adapter has no negative-prompt parameter, so the rule was being
 *   shouted at the one component that cannot act on it.
 *
 * So the decision moves upstream, to a model that CAN read an article and
 * CAN obey a constraint. This stage outputs one concrete scene; the image
 * model then draws that scene and is never asked to interpret anything.
 *
 * The constraints have not been relaxed — they have been moved somewhere they
 * work. "Do not name a real product" is trivial for a language model and
 * nearly meaningless to a diffusion model.
 */

export const IMAGE_DIRECTION_TASK = 'image_direction';

/** Falls back through the other short-copy purposes, so an unconfigured purpose is not a dead feature. */
export const IMAGE_DIRECTION_FALLBACKS = ['meta_description', 'title_generation'] as const;

const TIMEOUT_MS = 60_000;

/** How much of the article the director reads. Enough to know the argument, not the whole piece. */
const BODY_WORD_BUDGET = 500;

/**
 * The clichés to name explicitly.
 *
 * A generic instruction to "avoid clichés" does nothing — the model does not
 * know which ones it reaches for. Naming them is what works, and every entry
 * here is something an image model genuinely produces unprompted for this
 * publication's subject matter.
 */
const BANNED_CLICHES = [
  'a floating brain, glowing brain, or brain made of particles, circuitry or light',
  'glowing neural networks, synapses, or abstract blue "technology" particles',
  'a lightbulb representing an idea',
  'a person pointing at a floating chart, hologram or dashboard',
  'gears, puzzle pieces, ladders, or arrows going up as a metaphor',
  'a stopwatch or clock to mean "fast"',
  'hands cupping something glowing',
  'an immaculate empty desk that looks like a furniture advertisement',
  // Added after a real generation: asked for "a slim matte-black band with a
  // flat inner face", the image model produced a studio-lit smartwatch beside
  // a phone on a bare nightstand — no logo on it, and still unmistakably a
  // particular company's hardware, shot the way that company shoots it.
  'a device alone on a bare surface under even light, arranged the way a shop photographs it',
  // This publication's own cliché, not a generic one. Across eight articles in
  // a single day the director chose a single object on a kitchen table or
  // counter, shot across the surface in window light, almost every time: a
  // backpack, a wristband, a bowl of powder, a feeder, a tracker. Each was
  // defensible alone. Together they are one photograph printed five times.
  'a single object resting on a kitchen table or counter, shot across the surface in window light — this publication has used that composition far too often',
];

function firstWords(text: string, limit: number): string {
  const words = text.replace(/\[\[product:\d+\]\]/g, ' ').replace(/[#*_`>]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length <= limit ? words.join(' ') : `${words.slice(0, limit).join(' ')}…`;
}

/**
 * PHOTOGRAPH OR ILLUSTRATION.
 *
 * Every rule below is written for a photograph, and that was an unstated
 * assumption until an editor asked for something a photograph cannot do:
 * a person deciding whether to keep paying for a subscription, with a thought
 * bubble over their head holding the device.
 *
 * A thought bubble is not a photographable object. Asked for one inside a
 * prompt ending "editorial photograph, natural light, shallow depth of field",
 * an image model produces a bad composite — a real room with a cartoon shape
 * pasted over it. The concept is not the problem; the medium is.
 *
 * So the medium becomes a choice. An illustration can show what somebody is
 * thinking, a comparison, a before and after, or a cost adding up over time —
 * none of which exist in front of a camera.
 */
export const IMAGE_STYLES = ['photograph', 'illustration'] as const;
export type ImageStyle = (typeof IMAGE_STYLES)[number];

export function toImageStyle(raw: unknown): ImageStyle {
  return raw === 'illustration' ? 'illustration' : 'photograph';
}

export interface DirectionInput {
  title: string;
  topic: string;
  themeName: string;
  audience: string;
  body: string;
  steer: string | null;
  /** Defaults to a photograph, which is what nearly every article wants. */
  style?: ImageStyle;
  /**
   * Whether the image model can be trusted with lettering.
   *
   * False for every model Cynth has used so far, and the reason the rules
   * below ban books facing the camera, packaging, labels and signage: a model
   * that cannot spell fills a frame with gibberish, and the failure is
   * unmistakable to a reader.
   *
   * It is a property of the MODEL, not of the article. Newer image models
   * render text cleanly, and on those the ban costs a great deal — it rules
   * out most of the scenes a product publication would naturally photograph.
   */
  allowText?: boolean;
}

function buildDirectionPrompt(input: DirectionInput): string {
  const illustration = input.style === 'illustration';
  const allowText = input.allowText === true;

  return [
    illustration
      ? 'You are an art director briefing the illustration that runs at the top of a magazine article.'
      : 'You are an art director choosing the photograph that runs at the top of a magazine article.',
    illustration
      ? 'You do not draw it. You decide what it shows, and describe that one image so an illustrator could draw it.'
      : 'You do not draw it. You decide what it shows, and describe that one image so a photographer could shoot it.',
    '',
    '=== THE ARTICLE ===',
    `Headline: ${input.title}`,
    input.topic ? `Subject: ${input.topic}` : '',
    input.themeName ? `Section: ${input.themeName}` : '',
    input.audience ? `Written for: ${input.audience}` : '',
    input.steer
      ? [
          `The editor asks for: ${input.steer}`,
          // Said explicitly because the director did the opposite. Asked for a
          // thought bubble, it produced "their gaze raised toward a band on the
          // windowsill" — obeying its own preference for the photographable
          // over the editor's actual instruction.
          'That instruction is binding. Where it conflicts with anything below, follow the editor.',
        ].join('\n')
      : '',
    '',
    firstWords(input.body, BODY_WORD_BUDGET),
    '',
    '=== WHAT MAKES A GOOD CHOICE ===',
    // The failure that matters most: an image that contradicts the piece.
    'The image must agree with what the article actually ARGUES, not just its topic. An article about doing something cheaply must not show expensive equipment. An article about a thing going wrong should show the situation it describes, not a polished success.',
    // The failure that produced this rule: an article about three years of
    // subscription fees and what stops working when you cancel. Asked three
    // times, the director returned the same pet feeder on the same kitchen
    // table — photographing the topic while the argument, which is about money
    // over time and a device going inert, never reached the frame. Nothing was
    // random about it; there is no object that means "thirty-six monthly
    // payments", so the rule as written could only point at the nearest thing.
    'Some articles argue about something with no physical form: a cost mounting over years, two options compared, a service that degrades, a thing that stops working when you stop paying. Photographing the object at rest says nothing about any of them. Show the CONSEQUENCE instead — the moment it reaches a person or an animal, the waiting, the going-without, the two states side by side.',
    'If you find yourself placing the subject on a table because nothing else comes to mind, that is the signal you are photographing the topic rather than the argument. Choose the moment the argument bites.',
    illustration
      ? 'Choose ONE clear idea and describe it as a drawing. An illustration may show what a photograph cannot: what somebody is thinking, two things compared side by side, a before and an after, a cost stacking up. Thought bubbles, cutaways and simple diagrams are all available to you.'
      : 'Choose ONE real, specific, physical scene. A moment, a place, a pair of hands doing something, an object in use, evidence left behind.',
    // The scene that produced this rule asked for "two hands — one calloused,
    // one clean — reaching as if unclipping it", and got two arms entering the
    // frame from nowhere, belonging to nobody. Hands are still where image
    // models fail, and a fiddly two-handed action is the way to guarantee it.
    'Hands are welcome, but keep what they are doing simple: resting, holding, carrying, having just set something down. Do not build a scene around fine manipulation — fastening, unclipping, threading — and never describe hands as belonging to two different people.',
    'Specific beats impressive. A real thing on a real kitchen table says more than a studio composition.',
    // The counterweight to the line above, added because "worn" and "specific"
    // compounded into squalor: a scene came back as a grimy tiled counter with
    // peeling laminate and dirty jars. Lived-in is the goal; neglected is not,
    // and a reader deciding what to buy should not be looking at a photograph
    // that feels like bad news.
    'Lived-in means used, not neglected. Surfaces are clean, the room is cared for, the light is good. Wear shows in a softened edge or a faded colour, never in grime, stains, damage or clutter.',
    // Found in real generations, twice in a row. Asked for a smart ring, the
    // director wrote "a thin silver ring" and "a worn ring" — and the image
    // model drew a wedding band both times, on a pillow beside a sleeping
    // person. Technically the scene requested; editorially an article about
    // a marriage ending. An image model draws the most common thing a word
    // can mean, so the noun alone is not enough.
    'Name each object by its shape and material, not only by its category. An image model draws the most common thing a word can mean: "a ring" becomes a wedding band, "a tracker" becomes a wristwatch, "a monitor" becomes a television. If the object only works as one particular kind of thing, describe what it looks like — "a matte black band with a flat inner face" — or choose an object that cannot be mistaken for something else.',
    'It should make sense to someone who has not read the article yet, and still make sense after they have.',
    '',
    '=== WHAT NOT TO CHOOSE ===',
    'Do not choose any of these. They are the images this subject matter attracts, and they are all meaningless:',
    ...BANNED_CLICHES.map((entry) => `- ${entry}`),
    '',
    // The rules that used to be shouted at the image model. Here they are
    // simply instructions to someone who can follow them.
    'Do not build the scene around a branded or identifiable commercial product. Everyday unbranded objects are fine and usually better.',
    // Describing an object precisely is right, but it pulls the image model
    // towards the best-known thing of that shape — and a famous silhouette is
    // identifiable without a logo on it. The way out is not a vaguer object;
    // it is a scene with something happening in it, where the object is part
    // of a room rather than the display piece.
    'A device may appear, but never as the display piece. Put it where it actually lives — among other things, in use, set down mid-task, caught in ordinary light — so the photograph is of a situation that contains the object, not of the object. If the frame would work as a shop listing, it is the wrong frame.',
    // Not enough on its own, and the first real generation proved it. The
    // director chose "a stack of old paperbacks" — a perfect choice for the
    // article — and the image model dutifully rendered gibberish on every
    // spine. Telling the IMAGE model "no text" cannot save a scene built from
    // objects whose whole identity is printed lettering; the scene has to be
    // chosen, or framed, so that no lettering faces the camera.
    allowText
      ? 'Text is allowed in this image. Printed words, labels, book spines, packaging and screens may face the camera. Keep any wording generic and truthful — a category name, a handwritten note, a date — and never a real brand name or logo.'
      : 'Do not include text, signage, screens with readable writing, or anything a camera would capture as lettering.',
    allowText
      ? ''
      : 'Books, packaging, labelled containers and screens are allowed, but only where no lettering would face the camera — spines turned away, a cover seen edge-on, a screen dark or angled from the lens. If a scene only works with its lettering visible, choose a different scene.',
    // Written out as objects rather than as a principle, because the principle
    // was already there and a scene came back with "a printed subscription
    // sheet edged with dates" in it. The image model rendered mirrored
    // gibberish across half the frame.
    allowText
      ? ''
      : 'That rule covers paper. No printed sheet, form, invoice, receipt, bill, statement, calendar, letter, newspaper or magazine anywhere in the frame, including face-down or out of focus.',
    // And the other half of the same generation: the model printed an invented
    // brand name on the casing. An unmarked object is a positive instruction;
    // "unbranded" alone is not.
    allowText
      ? 'Any appliance or device in the frame carries no real brand: no logo, no company name, no recognisable badge. An unbranded product with a plain generic label is fine.'
      : 'Any appliance or device in the frame has a plain, unmarked casing: no name, no badge, no moulded lettering, nothing printed on it anywhere.',
    'Do not feature a recognisable real person.',
    '',
    '=== OUTPUT ===',
    'Reply with the scene description and nothing else. No preamble, no explanation, no quotes, no list.',
    'One paragraph, 40 to 70 words. Present tense. Describe what is in frame, the light, and the mood.',
    illustration
      ? 'Write it as a picture, not as an instruction: "A woman at a kitchen table looks up, and above her…" not "An image showing…".'
      : 'Write it as a photograph, not as an instruction: "Morning light across a kitchen table where…" not "An image showing…".',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Strips the wrapping a model puts around a single paragraph of prose. */
export function cleanSceneDescription(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^(?:scene|description|image|photograph)\s*[:\-–]\s*/i, '')
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

/**
 * The words that put lettering in the frame.
 *
 * WHY THIS IS A CHECK AND NOT JUST A RULE. The rule was already in the prompt,
 * stated twice, and a scene still came back built around "a printed
 * subscription sheet edged with dates". The image model did exactly what it
 * was told and filled half the frame with mirrored gibberish.
 *
 * Asking again is free — the director runs on a free model — and the image
 * that would have followed costs four cents. So the asymmetry decides it: read
 * the scene, and if it names something that carries print, say so and ask
 * again before spending anything.
 *
 * Deliberately a short list of things that are nearly always printed. A
 * clever regex that tried to catch everything would reject good scenes, and a
 * rejected good scene is a worse outcome than an occasional miss.
 */
const TEXT_BEARING = [
  /\b(?:printed|printout|paperwork|document|documents|invoice|invoices|receipt|receipts|calendar|newspaper|magazine|brochure|leaflet|poster|flyer|label|labels|signage|billboard|handwritten|lettering)\b/i,
  // "Paper" alone, except the everyday objects that carry none. Bare "sheet"
  // is not on the list at all: it costs a good bedroom scene every time.
  /\bpaper\b(?!\s*(?:towel|towels|bag|bags|clip|clips|cup|cups|napkin|napkins))/i,
  /\b(?:letter|letters|envelope|envelopes)\b/i,
  /\bsign\b(?!\s+of\b)/i,
  /\b(?:logo|logos|brand name|branded)\b/i,
  // A screen is allowed when it is off. It is the lit ones that invent text.
  /\b(?:glowing|lit|bright|illuminated|displaying|showing)\s+(?:screen|display|monitor|phone)\b/i,
];

/** The phrase that would put print in the frame, or null when the scene is clean. */
export function findTextRisk(scene: string): string | null {
  for (const pattern of TEXT_BEARING) {
    const hit = pattern.exec(scene);
    if (hit) return hit[0];
  }
  return null;
}

/** How many times the director is asked again when its scene carries print. Free calls; the image is not. */
const MAX_ATTEMPTS = 3;

export interface SceneDirection {
  scene: string;
  model: string;
  provider: string;
  /** Set when every attempt named something printed, so a bad image is traceable rather than mysterious. */
  concern: string | null;
}

/**
 * Asks a text model what the image should show.
 *
 * Throws rather than returning a placeholder. The caller decides whether a
 * failure here should stop image generation or fall back to a simpler prompt —
 * inventing a scene at this level would hide the failure in the one place it
 * is impossible to notice.
 */
export async function directFeaturedImage(
  input: DirectionInput,
  options: { confirmedCost?: boolean; modelId?: number | null } = {},
): Promise<SceneDirection> {
  let resolution = resolveProviderTarget(IMAGE_DIRECTION_TASK, options.modelId, 'Image direction');
  for (const fallback of IMAGE_DIRECTION_FALLBACKS) {
    if (!resolution.error) break;
    resolution = resolveProviderTarget(fallback, options.modelId, 'Image direction');
  }
  if (resolution.error) throw resolution.error;

  const target: ResolvedTarget = resolution.target!;
  const routedModel = resolution.route!.model!;

  const costClass = classifyModel(routedModel);
  const spend = evaluateSpend(costClass, options.confirmedCost === true);
  if (!spend.allowed) {
    throw new GenerationError(
      spend.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      spend.reason ?? 'Deciding the image is not permitted in the current mode.',
    );
  }

  try {
    let lastScene = '';
    let lastRisk: string | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      /**
       * The correction names the exact phrase rather than restating the rule.
       * Restating a rule the model has already read once changes nothing; being
       * shown the words it wrote does.
       */
      const correction = lastRisk
        ? [
            '',
            '=== TRY AGAIN ===',
            `Your previous choice included "${lastRisk}", which would put printed words in the photograph.`,
            'Choose a different scene. Nothing in it may carry print of any kind.',
          ].join('\n')
        : '';

      const response = await target.adapter.generate(
        { prompt: buildDirectionPrompt(input) + correction, model: target.modelName, timeoutMs: TIMEOUT_MS },
        { apiKey: target.apiKey, baseUrl: target.baseUrl },
      );

      const scene = cleanSceneDescription(response.text ?? '');

      /**
       * An empty answer is retried, not fatal.
       *
       * The free models Cynth routes short copy through return an empty body
       * now and then. Throwing on the first one dropped the whole article down
       * the deterministic fallback path — which then spent four cents drawing
       * "a quiet environmental photograph suggesting the setting of…", a
       * visibly worse image, for a fault that costs nothing to retry. Observed
       * exactly that way on a real generation.
       */
      if (!scene) {
        if (attempt < MAX_ATTEMPTS - 1) continue;
        throw new GenerationError('empty_response', 'The model returned no scene to draw.');
      }

      lastScene = scene;
      // Nothing to check when lettering is the point.
      lastRisk = input.allowText === true ? null : findTextRisk(scene);
      if (!lastRisk) return { scene, model: target.modelName, provider: target.providerName, concern: null };
    }

    /**
     * Every attempt named something printed.
     *
     * Returning the scene anyway rather than failing: a director that cannot
     * find a print-free scene for a subject is not a reason to remove featured
     * images from that article, and the editor sees the candidate before it
     * goes anywhere. The concern travels with it so a garbled image is
     * traceable to this, rather than looking like the model misbehaving.
     */
    if (!lastScene) throw new GenerationError('empty_response', 'The model returned no scene to draw.');

    return {
      scene: lastScene,
      model: target.modelName,
      provider: target.providerName,
      concern: `The scene still mentions "${lastRisk}" after ${MAX_ATTEMPTS} attempts, so the image may contain lettering.`,
    };
  } catch (error) {
    if (isGenerationError(error)) throw error;
    const message = truncateForDisplay(
      redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]),
    );
    throw new GenerationError('provider_error', `Deciding the featured image failed: ${message}`);
  }
}
