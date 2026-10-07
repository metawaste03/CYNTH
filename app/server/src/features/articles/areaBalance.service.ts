import { getDatabase } from '../../shared/database/index.js';

/**
 * WHETHER AN AREA IS ACTUALLY COVERING WHAT ITS BRIEF SAYS IT COVERS.
 *
 * THE GAP THIS CLOSES. Smart Pet Care's brief is explicit — "DOGS AND CATS
 * BOTH. The back catalogue skews heavily to cats and to devices; correct for
 * that rather than continuing it." The instruction was there, in the one place
 * topic research reads. Nothing anywhere could say whether it was working.
 *
 * It was not. Measured when the question was first asked: of eleven products
 * in the area, EIGHT were cat-specific and five of those were litter boxes;
 * of two articles, one was a litter-box buyer's guide carrying seventy
 * mentions of cats and none of dogs. An instruction nobody can check is a
 * hope.
 *
 * A TALLY, NOT A VERDICT. This counts words against a declared vocabulary. It
 * cannot read an article, and a piece about dental care that happens to use a
 * dog in its examples is not thereby a dog article. So it reports counts and
 * leaves the judgement to a person — and to the topic research stage, which
 * gets the same numbers as a fact rather than being asked to infer a cluster
 * from a list of titles.
 *
 * ONLY AREAS THAT DECLARE FACETS ARE MEASURED. There is no general theory of
 * editorial balance here; there is one area with a stated requirement that two
 * things be covered, and a way of seeing whether they are.
 */

/** One dimension an area has said it must cover. */
interface Facet {
  label: string;
  pattern: RegExp;
}

/**
 * The facets each area is measured on, keyed by theme name.
 *
 * Deliberately not stored in the database: a facet is a reading of an area's
 * brief, and it belongs beside the code that interprets it rather than in a
 * settings screen where it would drift away from the brief silently.
 */
const AREA_FACETS: Record<string, Facet[]> = {
  'Smart Pet Care': [
    { label: 'dogs', pattern: /\b(dog|dogs|dog's|puppy|puppies|canine|leash|kennel)\b/gi },
    { label: 'cats', pattern: /\b(cat|cats|cat's|kitten|kittens|feline|litter box|litter-box|litter tray)\b/gi },
  ],
};

export interface FacetCount {
  label: string;
  /** Items whose subject is clearly this facet and not the others. */
  specific: number;
  /** Total keyword mentions across the area, for a sense of weight. */
  mentions: number;
}

export interface AreaBalance {
  themeId: number;
  themeName: string;
  facets: FacetCount[];
  /** Items that name more than one facet, or none — the species-neutral middle. */
  sharedOrNeutral: number;
  articles: { id: number; title: string; focus: string }[];
  products: { id: number; title: string; focus: string }[];
}

/**
 * Which facet an item belongs to, or null for "both, or neither".
 *
 * Dominance rather than presence: an article about dog dental care will
 * mention cats once to say the advice differs, and counting that as cat
 * coverage would make the measure useless. Twice as many mentions, and at
 * least two, is the threshold — low enough to catch a real lean, high enough
 * that one aside does not decide it.
 */
function focusOf(text: string, facets: Facet[]): { label: string | null; counts: number[] } {
  const counts = facets.map((facet) => (text.match(facet.pattern) ?? []).length);
  const top = Math.max(...counts);
  if (top < 2) return { label: null, counts };

  const topIndex = counts.indexOf(top);
  const runnerUp = Math.max(...counts.filter((_, i) => i !== topIndex), 0);

  return { label: top >= runnerUp * 2 ? facets[topIndex].label : null, counts };
}

export function getAreaBalance(themeName: string): AreaBalance | null {
  const facets = AREA_FACETS[themeName];
  if (!facets) return null;

  const db = getDatabase();
  // ORDER BY id so two projects carrying the same area name resolve to the
  // same one every time. Themes are scoped per project, so a duplicate name is
  // legal; an arbitrary pick would make this report quietly non-deterministic.
  const theme = db.prepare('SELECT id, name FROM themes WHERE name = ? ORDER BY id LIMIT 1').get(themeName) as
    | { id: number; name: string }
    | undefined;
  if (!theme) return null;

  const articleRows = db
    .prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(title), ''), generated_title) AS title, content
       FROM articles WHERE theme_id = ? AND content IS NOT NULL AND TRIM(content) <> '' ORDER BY id`,
    )
    .all(theme.id) as { id: number; title: string | null; content: string }[];

  const productRows = db
    .prepare(
      `SELECT id, title, COALESCE(short_description, '') AS blurb
       FROM products WHERE category = ? AND is_active = 1 ORDER BY id`,
    )
    .all(themeName) as { id: number; title: string; blurb: string }[];

  const totals = facets.map(() => 0);
  const specific = facets.map(() => 0);
  let sharedOrNeutral = 0;

  const articles = articleRows.map((row) => {
    const { label, counts } = focusOf(`${row.title ?? ''} ${row.content}`, facets);
    counts.forEach((n, i) => (totals[i] += n));
    if (label) specific[facets.findIndex((f) => f.label === label)]++;
    else sharedOrNeutral++;
    return { id: row.id, title: row.title ?? `Article ${row.id}`, focus: label ?? 'both or neither' };
  });

  const products = productRows.map((row) => {
    const { label, counts } = focusOf(`${row.title} ${row.blurb}`, facets);
    counts.forEach((n, i) => (totals[i] += n));
    return { id: row.id, title: row.title, focus: label ?? 'both or neither' };
  });

  return {
    themeId: theme.id,
    themeName: theme.name,
    facets: facets.map((facet, i) => ({ label: facet.label, specific: specific[i], mentions: totals[i] })),
    sharedOrNeutral,
    articles,
    products,
  };
}

/**
 * The balance as a line for the topic-research prompt.
 *
 * Deterministic numbers rather than "consider whether the area is balanced":
 * the stage already carried an instruction to notice a cluster, and it could
 * only have inferred one from a list of titles. Products are included because
 * in this area they are what the articles get written around — the skew lived
 * there first.
 */
export function buildBalanceBlock(themeName: string | null): string {
  if (!themeName) return '';
  const balance = getAreaBalance(themeName);
  if (!balance) return '';

  const productCounts = balance.facets.map((facet) => {
    const n = balance.products.filter((p) => p.focus === facet.label).length;
    return `${n} ${facet.label}`;
  });

  const articleCounts = balance.facets.map((facet) => `${facet.specific} ${facet.label}`);

  const lines = [
    '',
    '=== HOW THIS AREA IS CURRENTLY BALANCED ===',
    `Articles (${balance.articles.length}): ${articleCounts.join(', ')}, ` +
      `${balance.sharedOrNeutral} neither or both.`,
    `Products in the library (${balance.products.length}): ${productCounts.join(', ')}.`,
    'These are keyword tallies, not judgements — but a lopsided one is a real gap in the catalogue.',
    'If one facet above is clearly under-served, prefer a subject that serves it. Say so in the content gap.',
  ];

  return lines.join('\n');
}
