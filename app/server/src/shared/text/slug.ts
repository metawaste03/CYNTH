/**
 * URL-safe identifiers, shared by every entity that needs one.
 *
 * Lives in shared/ rather than inside a feature because articles, themes,
 * topics and projects all derive slugs the same way, and database seeding
 * must not import from a feature module.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
