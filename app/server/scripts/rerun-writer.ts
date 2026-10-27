/**
 * Re-runs the WRITER stage (and what follows it) on an existing pipeline.
 *
 * Why this exists rather than "start a fresh version": a pipeline sitting at
 * NEEDS_EDITORIAL_ATTENTION is terminal and not resumable, and the only route
 * the app offers is a new version — which re-runs topic research and keyword
 * research too. On article 37 the research was fine; the writer was not. There
 * is no reason to pay for Opus 5 to redo an hour of research that already
 * produced a good brief.
 *
 * It reads the brief the pipeline already stored, re-runs the writer with
 * `rerun: true` (which is what allows a paid stage to execute a second time),
 * then review and validation exactly as the orchestrator does.
 *
 * Usage:  npm run rerun:writer -- <pipelineId> [--confirm]
 */
import { initializeDatabase, getDatabase } from '../src/shared/database/index.js';
import { loadSecrets } from '../src/shared/secrets/secretStore.js';

initializeDatabase();
await loadSecrets();

const gen = await import('../src/features/pipeline/stages/generationStages.service.js');
const validation = await import('../src/features/pipeline/stages/validation.service.js');
const repo = await import('../src/features/pipeline/pipeline.repository.js');

const pipelineId = Number(process.argv[2]);
const confirmed = process.argv.includes('--confirm');
if (!Number.isInteger(pipelineId)) {
  console.error('Usage: npm run rerun:writer -- <pipelineId> [--confirm]');
  process.exit(1);
}

const db = getDatabase();
const briefRow = db
  .prepare(`SELECT output FROM pipeline_stage_runs WHERE pipeline_id = ? AND stage = 'article_brief' AND status = 'success' ORDER BY id DESC LIMIT 1`)
  .get(pipelineId) as { output: string } | undefined;

if (!briefRow?.output) {
  console.error(`Pipeline ${pipelineId} has no stored article brief — nothing to re-run against.`);
  process.exit(1);
}

const brief = JSON.parse(briefRow.output);
const before = repo.getPipelineById(pipelineId);
console.log(`pipeline ${pipelineId} | article ${before?.articleId} | state ${before?.state}`);
console.log(`brief title: ${brief.title ?? '(none)'}`);

if (!confirmed) {
  console.log('\nDry run. Re-running the writer costs a paid model call. Pass --confirm.');
  process.exit(0);
}

/**
 * The state has to be moved off a terminal one before the stages will run.
 * Recorded as a deliberate reset rather than done quietly: this is an editor
 * choosing to write the article again.
 */
repo.setState(pipelineId, 'ARTICLE_GENERATION_RUNNING', {
  stage: 'article_generation',
  note: 'Writer re-run requested by an editor.',
});

const written = (await gen.runArticleGeneration(pipelineId, brief, { confirmedCost: true, rerun: true }))
  .output as Record<string, unknown>;
const sections = (written.sections as unknown[]) ?? [];
console.log(`\nwriter: ${sections.length} sections, ${JSON.stringify(written).length} chars of JSON`);

const review = (await gen.runArticleReview(pipelineId, brief, written as never, { confirmedCost: true }))
  .output as { revisionRequired?: boolean; issues?: unknown[] };
console.log(`review: revisionRequired=${review.revisionRequired} issues=${(review.issues ?? []).length}`);

if (review.revisionRequired) {
  const current = repo.getPipelineById(pipelineId)!;
  if (current.revisionCount < 1) {
    await gen.runArticleRevision(pipelineId, written as never, review as never, { confirmedCost: true });
    console.log('revision: applied');
  } else {
    console.log('revision: already used on this pipeline, skipped');
  }
}

const final = validation.runFinalValidation(pipelineId);
console.log(`validation passed: ${final?.output.passed}`);
for (const finding of final?.output.findings ?? []) {
  console.log(`  [${finding.severity}] ${finding.detail}`);
}
console.log(`\nfinal state: ${repo.getPipelineById(pipelineId)?.state}`);
