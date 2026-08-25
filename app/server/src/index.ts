import express from 'express';
import { env } from './shared/config/env.js';
import { notFound } from './shared/middleware/notFound.js';
import { errorHandler } from './shared/middleware/errorHandler.js';
import { initializeDatabase, closeDatabase, DATABASE_PATH } from './shared/database/index.js';
import { authorsRouter } from './features/authors/authors.routes.js';
import { productsRouter } from './features/products/products.routes.js';
import { ensureProductUploadsDir, UPLOADS_ROOT } from './features/products/products.upload.js';
import { articleTypesRouter } from './features/article-types/article-types.routes.js';
import { dashboardRouter } from './features/dashboard/dashboard.routes.js';
import { articlesRouter } from './features/articles/articles.routes.js';
import { aiProvidersRouter } from './features/ai-providers/aiProviders.routes.js';
import { modelRouterRouter } from './features/model-router/modelRouter.routes.js';
import { loadProviderSecrets } from './shared/secrets/providerSecrets.js';

const app = express();

app.use(express.json());

// Load any previously-saved AI provider API keys into process.env before
// anything else runs. Keys live only here and in the .env.local file — never in SQLite.
loadProviderSecrets();

const dbStatus = initializeDatabase();
console.log(`Database ready at ${dbStatus.path}`);
console.log(`Tables: ${dbStatus.tables.join(', ')}`);
console.log(
  dbStatus.articleTypesSeeded
    ? `Seeded article_types with ${dbStatus.articleTypesCount} rows.`
    : `article_types already had ${dbStatus.articleTypesCount} rows — skipped seeding.`,
);

ensureProductUploadsDir();
console.log(`Product image uploads stored under ${UPLOADS_ROOT}`);

// Serves uploaded files (e.g. /uploads/products/<file>). Only file paths are
// stored in SQLite — the files themselves live on disk, per Milestone 4.
app.use('/uploads', express.static(UPLOADS_ROOT));

/**
 * Health check, now reporting the database connection too. Still no other
 * business logic — real feature routes will live under src/features/.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cynth-server',
    timestamp: new Date().toISOString(),
    database: {
      connected: true,
      path: DATABASE_PATH,
      tables: dbStatus.tables,
    },
  });
});

app.use('/api/authors', authorsRouter);
app.use('/api/products', productsRouter);
app.use('/api/article-types', articleTypesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/ai-providers', aiProvidersRouter);
app.use('/api/model-router', modelRouterRouter);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`Cynth server foundation listening on http://localhost:${env.port}`);
});

function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
