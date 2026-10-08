/**
 * URL-safe identifiers, shared by every entity that needs one.
 *
 * Lives in shared/ rather than inside a feature because articles, themes,
 * topics and projects all derive slugs the same way, and database seeding
 * must not import from a feature module.
 */
export const MAX_SLUG_LENGTH = 80;

export function slugify(text: string): string {
  const full = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (full.length <= MAX_SLUG_LENGTH) return full;

  // Cut at a word boundary. A plain slice(0, 80) cut mid-word, and the cut
  // became a live URL: ".../how-to-set-your-calorie-target-without-guessin/".
  // A hyphen right after the limit means the 80 characters end on a whole
  // word; otherwise drop back to the last hyphen inside them. One unbroken
  // word longer than the limit has no boundary to use, so it is cut hard.
  const head = full.slice(0, MAX_SLUG_LENGTH);
  if (full[MAX_SLUG_LENGTH] === '-') return head.replace(/-+$/g, '');
  const lastBreak = head.lastIndexOf('-');
  return (lastBreak > 0 ? head.slice(0, lastBreak) : head).replace(/-+$/g, '');
}
