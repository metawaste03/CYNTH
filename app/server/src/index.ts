import express from 'express';
import { env } from './shared/config/env.js';
import { notFound } from './shared/middleware/notFound.js';
import { errorHandler } from './shared/middleware/errorHandler.js';
import { initializeDatabase, closeDatabase, DATABASE_PATH } from './shared/database/index.js';
import { authorsRouter } from './features/authors/authors.routes.js';
import { authorSkillsRouter } from './features/authors/authorSkills.routes.js';
import { productsRouter } from './features/products/products.routes.js';
import { ensureProductUploadsDir, UPLOADS_ROOT } from './features/products/products.upload.js';
import { articleTypesRouter } from './features/article-types/article-types.routes.js';
import { dashboardRouter } from './features/dashboard/dashboard.routes.js';
import { articlesRouter } from './features/articles/articles.routes.js';
import { aiProvidersRouter } from './features/ai-providers/aiProviders.routes.js';
import { modelRouterRouter } from './features/model-router/modelRouter.routes.js';
import { contentRouter } from './features/content/content.routes.js';
import { generationRouter } from './features/generation/generation.routes.js';
import { cmsRouter } from './features/cms/cms.routes.js';
import { seoRouter } from './features/seo/seo.routes.js';
import { qualityGateRouter } from './features/quality-gate/qualityGate.routes.js';
import { webIntelligenceRouter } from './features/web-intelligence/webIntelligence.routes.js';
import { productResearchRouter } from './features/product-research/productResearch.routes.js';
import { amazonRouter } from './features/product-research/amazon/amazon.routes.js';
import { mediaRouter } from './features/media/media.routes.js';
import { imagesRouter } from './features/images/images.routes.js';
import { pipelineRouter } from './features/pipeline/pipeline.routes.js';
import { ensureMediaUploadsDir } from './features/media/media.upload.js';
import { loadSecrets } from './shared/secrets/secretStore.js';
import { backfillMissingSlugs } from './features/articles/articles.repository.js';
import { serveBuiltClient } from './shared/static/clientStatic.js';

const app = express();

app.use(express.json());

// Load any previously-saved credentials (AI provider keys, CMS credentials)
// into process.env before anything else runs. Values live only there and in
// the gitignored .env.local file — never in SQLite.
loadSecrets();

const dbStatus = initializeDatabase();
console.log(`Database ready at ${dbStatus.path}`);
console.log(`Tables: ${dbStatus.tables.join(', ')}`);
console.log(
  dbStatus.articleTypesSeeded
    ? `Seeded article_types with ${dbStatus.articleTypesCount} rows.`
    : `article_types already had ${dbStatus.articleTypesCount} rows — skipped seeding.`,
);

// Idempotent: gives a slug to any article created before slugs were stored.
const slugged = backfillMissingSlugs();
if (slugged > 0) console.log(`Backfilled slugs for ${slugged} article(s).`);

console.log(
  dbStatus.projectSeeded
    ? `Seeded initial content project with ${dbStatus.themeCount} thematic areas.`
    : `Content project already configured (${dbStatus.themeCount} thematic areas) — skipped seeding.`,
);

console.log(
  dbStatus.templatesSeeded > 0
    ? `Seeded ${dbStatus.templatesSeeded} article template(s).`
    : 'Article templates already present — skipped seeding.',
);

ensureProductUploadsDir();
ensureMediaUploadsDir();
console.log(`Product image uploads stored under ${UPLOADS_ROOT}`);

/** When this process started, so health can report how long it has been up. */
const STARTED_AT = new Date();

// Serves uploaded files (e.g. /uploads/products/<file>). Only file paths are
// stored in SQLite — the files themselves live on disk, per Milestone 4.
app.use('/uploads', express.static(UPLOADS_ROOT));

/**
 * HEALTH.
 *
 * The one endpoint the UI polls to decide whether the backend is Running or
 * Unavailable. It must stay cheap and dependency-free — no provider calls, no
 * CMS calls, and no query that could itself be slow — because a health check
 * that can hang is worse than none at all.
 *
 * It reports nothing sensitive: no credentials, no env var values, and no
 * configuration beyond what the app already shows on its own screens.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cynth-server',
    timestamp: new Date().toISOString(),
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    /** Whether this process is also serving the built client, i.e. the single-process production shape. */
    mode: clientStatic.serving ? 'production' : 'development',
    servingClient: clientStatic.serving,
    database: {
      connected: true,
      path: DATABASE_PATH,
      tables: dbStatus.tables,
    },
  });
});

app.use('/api/authors', authorsRouter);
// Author skills: the long-form authoring documents, and the Author folder
// they are imported from and exported back to.
app.use('/api/author-skills', authorSkillsRouter);
app.use('/api/products', productsRouter);
app.use('/api/article-types', articleTypesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/ai-providers', aiProvidersRouter);
app.use('/api/model-router', modelRouterRouter);
// Projects, thematic areas and topics — the configurable content architecture.
app.use('/api/content', contentRouter);
// Generation policy: the mode that governs whether Cynth may spend money.
app.use('/api/generation', generationRouter);
// CMS connections (WordPress first). Article pushes live on /api/articles.
app.use('/api/cms', cmsRouter);
// The SEO Engine: configuration, analysis, findings, recommendations, gate.
app.use('/api/seo', seoRouter);
// The Quality Gate: article readiness, reported alongside SEO status and
// deliberately separate from it — an article can pass one and fail the other.
app.use('/api/quality-gate', qualityGateRouter);
// Web intelligence foundation: authorised web sources and backlink
// opportunities. There is no crawler — see web-intelligence/retrievers/.
app.use('/api/web-intelligence', webIntelligenceRouter);
// Product research: reading a product page the user named, working out what
// the product is for, and attaching it to a draft. Never rewrites the
// affiliate link the user supplied.
app.use('/api/product-research', productResearchRouter);
// Amazon Creators API: Amazon's official product-data service, and the only
// way Cynth obtains Amazon product data. Credentials live in the secret store.
app.use('/api/amazon', amazonRouter);
// The media library: images the editor uploads for ARTICLES, as distinct from
// product images. Cynth proposes a match and the editor confirms it.
app.use('/api/media', mediaRouter);
// Featured images. Suggests from the library first, and only draws a new one
// when asked — image models are priced per image, so this path always costs
// something and is never reached by the pipeline on its own.
app.use('/api/featured-image', imagesRouter);
// The editorial pipeline: theme in, researched and reviewed article out.
// Cynth owns sequencing, state, idempotency and the revision cap.
app.use('/api/pipeline', pipelineRouter);

/**
 * The built client, in production only.
 *
 * Registered after every API route so an unknown /api path still returns a
 * JSON 404 rather than the SPA shell, and before the 404/error handlers so a
 * client-side route reaches the app instead of them.
 */
const clientStatic = serveBuiltClient(app);
console.log(
  clientStatic.serving
    ? `Serving the built client from ${clientStatic.dir} — single-process mode.`
    : `Not serving a built client: ${clientStatic.reason}`,
);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`Cynth listening on http://localhost:${env.port}`);
  if (clientStatic.serving) console.log(`Open http://localhost:${env.port} to use Cynth.`);
});

function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
