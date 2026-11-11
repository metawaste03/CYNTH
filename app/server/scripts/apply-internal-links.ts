/**
 * Places the internal links that were approved before anything could place them.
 *
 * WHY A SCRIPT AND NOT JUST THE BUTTON. The approvals are a backlog: ten of
 * them, made over weeks, against an Opportunities panel whose Approve button
 * recorded a decision and changed nothing. Clicking through them one article
 * at a time would work, but the backlog wants one pass that says exactly what
 * happened to each one — including the ones that cannot be placed yet and why.
 *
 * One model call per ARTICLE, not per link: an article with three approved
 * links is one call, because each successive call would see a body the last
 * one had already changed.
 *
 * A DRY RUN COSTS NOTHING AND TELLS YOU MOST OF IT. Which targets are live,
 * which are still drafts, and how many calls a real run would make — all of
 * that is known before any money is spent.
 *
 * REFRESH FIRST, OR HOLD LINKS BACK FOR NO REASON. Cynth only learns a post's
 * status when it pushes it, so an article published in WordPress afterwards is
 * still recorded here as a draft — and a draft is exactly what this refuses to
 * link to. On the first real run that was costing five links: several of those
 * "not published yet" targets were in fact live on the site. `--refresh` asks
 * the CMS what each target's status actually is before deciding anything.
 *
 * Usage:
 *   npm run apply:links                              dry run
 *   npm run apply:links -- --refresh                 dry run, after re-reading the CMS
 *   npm run apply:links -- --refresh --write         place them (paid)
 *   npm run apply:links -- --write --article 36
 */
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';
import { loadSecrets } from '../src/shared/secrets/secretStore.js';

initializeDatabase();

/**
 * No secret is in the database — the API key lives in `.env.local` and the
 * server loads it into process.env at startup. A script that skips this step
 * reaches the spend gate and then fails with "No API key is stored", which
 * reads exactly like a missing key rather than an unloaded one. It cost a run
 * of five articles to find out.
 */
loadSecrets();

const db = getDatabase();

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const refresh = argv.includes('--refresh');
const onlyIndex = argv.indexOf('--article');
const only = onlyIndex >= 0 ? Number(argv[onlyIndex + 1]) : null;

const { resolvePublicUrl, applyApprovedInternalLinks } = await import(
  '../src/features/seo/internalLinks.service.js'
);

interface Row {
  source_article_id: number;
  title: string;
  approved: number;
}

const rows = db
  .prepare(
    `SELECT l.source_article_id, a.title, COUNT(*) AS approved
     FROM seo_internal_links l
     JOIN articles a ON a.id = l.source_article_id
     WHERE l.status = 'approved'
     GROUP BY l.source_article_id, a.title
     ORDER BY l.source_article_id`,
  )
  .all() as unknown as Row[];

const targets = only === null ? rows : rows.filter((row) => row.source_article_id === only);

if (!targets.length) {
  console.log(only === null ? 'No article has an approved internal link waiting.' : `Article ${only} has none.`);
  process.exit(0);
}

console.log(`${targets.length} article(s) with approved links waiting.\n`);

/* ----------------------------------------------------------- the refresh --- */

if (refresh) {
  const { refreshLink } = await import('../src/features/cms/cmsPublish.service.js');

  // Every TARGET of an approved link, because it is the target's status that
  // decides whether a link can be made at all.
  const targetIds = new Set<number>();
  for (const row of targets) {
    for (const link of db
      .prepare("SELECT target_article_id FROM seo_internal_links WHERE source_article_id = ? AND status = 'approved'")
      .all(row.source_article_id) as unknown as { target_article_id: number }[]) {
      targetIds.add(link.target_article_id);
    }
  }

  console.log(`Re-reading the CMS for ${targetIds.size} target article(s).`);

  for (const articleId of targetIds) {
    const connections = db
      .prepare('SELECT connection_id, external_status FROM article_cms_links WHERE article_id = ?')
      .all(articleId) as unknown as { connection_id: number; external_status: string | null }[];

    for (const connection of connections) {
      try {
        const updated = await refreshLink(articleId, connection.connection_id);
        if (updated && updated.externalStatus !== connection.external_status) {
          console.log(
            `  #${articleId} on connection ${connection.connection_id}: ` +
              `${connection.external_status} -> ${updated.externalStatus}`,
          );
        }
      } catch (error) {
        // A dead local connection must not stop the live one being read.
        console.log(
          `  #${articleId} on connection ${connection.connection_id}: could not read` +
            ` (${error instanceof Error ? error.message.slice(0, 70) : 'unknown'})`,
        );
      }
    }
  }
  console.log('');
}

/* ------------------------------------------------------------ the survey --- */

let placeable = 0;
let blocked = 0;

for (const row of targets) {
  const links = db
    .prepare(
      `SELECT l.id, l.target_article_id, t.title AS target_title
       FROM seo_internal_links l
       LEFT JOIN articles t ON t.id = l.target_article_id
       WHERE l.source_article_id = ? AND l.status = 'approved'
       ORDER BY l.id`,
    )
    .all(row.source_article_id) as unknown as { id: number; target_article_id: number; target_title: string }[];

  console.log(`#${row.source_article_id}  ${row.title}`);
  for (const link of links) {
    const url = resolvePublicUrl(link.target_article_id);
    if (url) {
      placeable++;
      console.log(`    -> ${link.target_title}`);
      console.log(`       ${url}`);
    } else {
      blocked++;
      console.log(`    -- ${link.target_title}`);
      console.log('       held: not published on the live site, so a link would 404');
    }
  }
  console.log('');
}

console.log(`${placeable} link(s) can be placed now, ${blocked} waiting on a target being published.`);

if (!write) {
  const calls = new Set(
    targets
      .filter((row) =>
        (
          db
            .prepare("SELECT target_article_id FROM seo_internal_links WHERE source_article_id = ? AND status = 'approved'")
            .all(row.source_article_id) as unknown as { target_article_id: number }[]
        ).some((link) => resolvePublicUrl(link.target_article_id) !== null),
      )
      .map((row) => row.source_article_id),
  ).size;

  console.log(`\nDry run. Nothing written, nothing spent.`);
  console.log(`A real run is ${calls} model call(s) — one per article, not one per link.`);
  console.log('Re-run with --write to place them.');
  process.exit(0);
}

/* ------------------------------------------------------------ the writing --- */

console.log('\nPlacing them.\n');

let inserted = 0;
let failed = 0;
const changedArticles: number[] = [];

for (const row of targets) {
  try {
    // confirmedCost: the operator confirmed it by passing --write to a script
    // whose dry run has already printed the number of calls.
    const result = await applyApprovedInternalLinks(row.source_article_id, { confirmedCost: true });

    if (result.inserted.length) {
      inserted += result.inserted.length;
      changedArticles.push(row.source_article_id);
      console.log(`#${row.source_article_id}  ${result.inserted.length} placed  (${result.model})`);
      for (const entry of result.inserted) console.log(`    -> ${entry.targetTitle}`);
    } else if (result.alreadyPresent.length) {
      console.log(`#${row.source_article_id}  already linked, nothing to do`);
    } else {
      // Not a failure. Usually the article simply never mentions the target,
      // and the held reason below says so.
      console.log(`#${row.source_article_id}  nothing placed${result.model ? ` (${result.model})` : ''}`);
    }

    for (const entry of result.held) console.log(`    -- ${entry.targetTitle}: ${entry.reason}`);
  } catch (error) {
    failed++;
    console.log(`#${row.source_article_id}  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log('');
}

console.log(`${inserted} link(s) written into ${changedArticles.length} article(s). ${failed} article(s) failed.`);

if (changedArticles.length) {
  console.log(
    '\nThese article bodies changed, so the links are not live until each one is pushed again:\n  ' +
      changedArticles.map((id) => `#${id}`).join(', '),
  );
}
