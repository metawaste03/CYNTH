/**
 * AN ARTICLE AS THE POINTS IT MAKES.
 *
 * The coverage graph compares ideas, not titles. Two articles can have
 * unrelated titles and still both explain how long caffeine stays in the
 * body; the only way to see that is to compare what each section says. So
 * every stored article is cut into points — one per section, and one per
 * question inside a FAQ — and each point is what gets embedded and compared.
 *
 * DETERMINISTIC. This reads the stored Markdown and nothing else. No model is
 * asked where the sections are; the headings already say.
 *
 * THE HEADING TRAVELS WITH THE TEXT. Template headings repeat across articles
 * ("Steps", "Common mistakes", "FAQ"), so a heading alone means nothing. The
 * body is what is compared, and the heading is kept beside it so a person
 * reading a match can see where it came from.
 */

export interface ArticlePoint {
  /** Position in the article, from 0. */
  ordinal: number;
  heading: string;
  /** The H2 a FAQ question or sub-section sits under, or null for a top-level section. */
  parentHeading: string | null;
  /** The section's text with Markdown removed, as it is embedded. */
  text: string;
  wordCount: number;
}

/** Sections shorter than this say too little to compare and are folded into the one before. */
const MIN_POINT_WORDS = 40;

/** Embedding inputs are capped so one very long section cannot dominate a request. */
const MAX_POINT_CHARS = 6000;

/** The intro has no heading of its own. */
export const INTRODUCTION_HEADING = '(introduction)';

/**
 * Strips the Markdown that would otherwise be compared as if it were prose:
 * link targets, image syntax, emphasis marks and shortcodes.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[[a-z_]+[^\]]*\]/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`>|]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

interface RawSection {
  heading: string;
  parentHeading: string | null;
  lines: string[];
}

/**
 * Cuts an article into points.
 *
 * H2 starts a point. H3 starts a point of its own under its H2, which is what
 * makes each FAQ question separately comparable: a FAQ answer is often the
 * one place an article repeats another, and as one big "FAQ" point it would
 * be averaged into invisibility.
 */
export function splitIntoPoints(markdown: string): ArticlePoint[] {
  const sections: RawSection[] = [{ heading: INTRODUCTION_HEADING, parentHeading: null, lines: [] }];
  let currentH2: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    const h3 = /^###\s+(.+?)\s*#*\s*$/.exec(line);

    if (h2 && !line.startsWith('###')) {
      currentH2 = plainText(h2[1]);
      sections.push({ heading: currentH2, parentHeading: null, lines: [] });
    } else if (h3) {
      sections.push({ heading: plainText(h3[1]), parentHeading: currentH2, lines: [] });
    } else if (/^#\s+/.test(line)) {
      // The H1 is the title, which the graph stores on the article itself.
      continue;
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const points: ArticlePoint[] = [];

  for (const section of sections) {
    const text = plainText(section.lines.join('\n'));
    const words = wordsIn(text);
    if (words === 0) continue;

    const previous = points[points.length - 1];
    if (words < MIN_POINT_WORDS && previous) {
      // Too short to stand alone. Folded into the previous point rather than
      // dropped, so nothing the article says goes unseen.
      previous.text = `${previous.text}\n${section.heading}: ${text}`.slice(0, MAX_POINT_CHARS);
      previous.wordCount += words;
      continue;
    }

    points.push({
      ordinal: points.length,
      heading: section.heading,
      parentHeading: section.parentHeading,
      text: text.slice(0, MAX_POINT_CHARS),
      wordCount: words,
    });
  }

  return points;
}

/** What is actually sent for embedding: the heading gives the text its context. */
export function embeddingInput(point: Pick<ArticlePoint, 'heading' | 'parentHeading' | 'text'>): string {
  const where = point.parentHeading ? `${point.parentHeading} — ${point.heading}` : point.heading;
  return `${where}\n${point.text}`;
}
