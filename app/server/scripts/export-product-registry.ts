/**
 * Writes the EveryFiveDays product registry from Cynth's own product table.
 *
 * WHY THIS EXISTS. The site keeps a product registry (`efd_product` posts),
 * and the card shortcode lets the REGISTRY win for the affiliate URL and the
 * image — deliberately, so a changed link is fixable in one place rather than
 * in every article that mentions the product.
 *
 * Until now that registry could only be filled from a WordPress install:
 * `export-products.php` reads the LOCAL site and writes `products/registry.json`,
 * which `deploy.mjs products` pushes live. Nothing produced entries in the
 * first place, so a product added to Cynth never reached the site at all —
 * which is why 11 of the 22 products have no registry entry, and why cards for
 * them publish with no picture.
 *
 * Cynth is where products are actually maintained, so Cynth writes the
 * manifest.
 *
 * WHAT IT DOES NOT DO. It does not push anything and does not touch the live
 * site: it writes a manifest and stages image files, and `deploy.mjs products`
 * remains the only thing that talks to the server. It also never invents an
 * affiliate URL — a product without one is written without one, and the card
 * renders unlinked rather than pointing somewhere plausible.
 *
 * Usage:  npm run export:registry -- [--out <repo-path>] [--write]
 *         Without --write it prints what would change and touches nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';
import { deriveVendor } from '../src/features/products/vendor.service.js';
import { isPickBadge } from '../src/features/products/products.validation.js';

const DEFAULT_REPO = 'C:/Users/MetaWaste/OneDrive/Desktop/CLAUDE/Everyfivedays';
const CYNTH_UPLOADS = path.resolve(process.cwd(), '..', '..', 'database', 'uploads');

interface RegistryRow {
  cynth_id: string;
  title: string;
  content: string;
  meta: Record<string, string>;
  image: string;
  image_alt: string;
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const write = process.argv.includes('--write');
const repo = arg('out') ?? DEFAULT_REPO;
const outDir = path.join(repo, 'products');
const mediaDir = path.join(outDir, 'media');

initializeDatabase();
const db = getDatabase();

const products = db
  .prepare(
    `SELECT p.id, p.title, p.brand, p.vendor, p.affiliate_link, p.short_description, p.description,
            p.category, p.is_featured_pick, p.pick_badge,
            (SELECT i.file_path FROM product_images i
              WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.position, i.id LIMIT 1) AS image_path
       FROM products p
      WHERE p.is_active = 1
      ORDER BY p.id`,
  )
  .all() as {
  id: number;
  title: string;
  brand: string | null;
  vendor: string | null;
  affiliate_link: string | null;
  short_description: string | null;
  description: string | null;
  category: string | null;
  is_featured_pick: number;
  pick_badge: string | null;
  image_path: string | null;
}[];

/** The existing manifest, so this can report what actually changes. */
const manifestPath = path.join(outDir, 'registry.json');
const previous: RegistryRow[] = fs.existsSync(manifestPath)
  ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RegistryRow[])
  : [];
const previousById = new Map(previous.map((row) => [String(row.cynth_id), row]));

const rows: RegistryRow[] = [];
const staged: { from: string; name: string }[] = [];
let missingImages = 0;

for (const product of products) {
  const vendor = deriveVendor(product.affiliate_link);

  /**
   * The image travels by BASENAME, because that is what the importer looks
   * for beside the manifest. Cynth stores a root-relative path like
   * `uploads/products/<uuid>.png`, which is meaningless on any other host.
   */
  let image = '';
  let alt = '';
  if (product.image_path) {
    const source = path.join(CYNTH_UPLOADS, product.image_path.replace(/^uploads[\\/]/, ''));
    if (fs.existsSync(source)) {
      image = path.basename(source);
      alt = product.title;
      staged.push({ from: source, name: image });
    } else {
      missingImages += 1;
    }
  }

  const summary = (product.short_description ?? product.description ?? '').trim();

  /**
   * ONLY WHAT CYNTH ACTUALLY KNOWS.
   *
   * The importer writes every meta key it is handed, so an empty value here
   * would blank a field on the live entry. Two of them matter: `efd_image_url`
   * and `efd_image_id` are set by the importer for the install it is importing
   * INTO — a URL exported from another site points at nothing — and sending
   * them empty would erase the picture from every product already on the site.
   *
   * The cost of this is that a field cannot be CLEARED through the registry,
   * only changed. That is the right way round: a blank in Cynth usually means
   * "not filled in", not "delete what the site has".
   */
  const meta: Record<string, string> = { efd_cynth_id: String(product.id) };
  const put = (key: string, value: string | null | undefined) => {
    const trimmed = (value ?? '').trim();
    if (trimmed) meta[key] = trimmed;
  };

  put('efd_affiliate_url', product.affiliate_link);
  put('efd_brand', product.brand);
  put('efd_vendor', vendor?.slug ?? product.vendor);
  put('efd_summary', summary);
  // The category the picks row groups by, and the flag it selects on. Both
  // are editorial decisions made in Cynth; the site only renders them.
  put('efd_category', product.category);
  // The pick flag and its badge are ALWAYS sent, unlike the fields above.
  // They are switches, not facts that might be missing: off and "no badge"
  // are real decisions. Sending only the "on" state meant unticking a pick in
  // Cynth never reached the site — the importer only writes what it is given,
  // so the old '1' stayed there and the product stayed a pick.
  meta.efd_featured = product.is_featured_pick ? '1' : '0';
  meta.efd_badge = isPickBadge(product.pick_badge) ? product.pick_badge : '';

  rows.push({
    cynth_id: String(product.id),
    title: product.title,
    content: '',
    meta,
    image,
    image_alt: alt,
  });
}

/* ------------------------------------------------------------- report --- */

const created = rows.filter((row) => !previousById.has(row.cynth_id));
/**
 * Only the keys this manifest actually sends.
 *
 * Comparing whole meta objects called all twelve existing products "changed"
 * the moment the exporter stopped emitting `efd_image_url` — a difference in
 * the FILE that writes nothing to the site. A dry run that cries wolf is a dry
 * run nobody reads.
 */
const changed = rows.filter((row) => {
  const before = previousById.get(row.cynth_id);
  if (!before) return false;
  return Object.entries(row.meta).some(([key, value]) => (before.meta?.[key] ?? '') !== value);
});
const dropped = previous.filter((row) => !rows.some((r) => r.cynth_id === String(row.cynth_id)));

const picks = rows.filter((row) => row.meta.efd_featured === '1');
console.log(`${rows.length} active products, ${staged.length} with an image on disk.`);
console.log(`  editor's picks:  ${picks.length}`);
console.log(`  new entries:     ${created.length}${created.length ? ` (${created.map((r) => r.cynth_id).join(', ')})` : ''}`);
console.log(`  changed entries: ${changed.length}${changed.length ? ` (${changed.map((r) => r.cynth_id).join(', ')})` : ''}`);
if (dropped.length) {
  // Said rather than silently done: the importer never deletes, so an entry
  // that leaves this manifest stays on the site until somebody removes it.
  console.log(`  no longer listed: ${dropped.map((r) => r.cynth_id).join(', ')} — these stay on the site untouched.`);
}
if (missingImages) console.log(`  ${missingImages} product(s) name an image file that is not on disk.`);

if (!write) {
  console.log('\nDry run. Nothing written. Re-run with --write.');
  process.exit(0);
}

fs.mkdirSync(mediaDir, { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(rows, null, '\t')}\n`, 'utf8');

for (const file of staged) {
  fs.copyFileSync(file.from, path.join(mediaDir, file.name));
}

console.log(`\nWrote ${path.relative(repo, manifestPath)} and staged ${staged.length} image(s) in products/media.`);
console.log('Push with:  node scripts/deploy.mjs products          (dry run)');
console.log('            node scripts/deploy.mjs products --apply');
