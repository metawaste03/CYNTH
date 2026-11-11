/**
 * Author skill tests (Milestone 16).
 *
 * Covers the two things the feature has to get right: that a skill document
 * reaches the model EXACTLY as written, and that nothing reaches the model
 * that the user did not put there. Everything runs against a scratch database
 * and a scratch Author folder — no real database, no network, no provider.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ------------------------------------------------------------------ setup */

const SCRATCH = path.join(os.tmpdir(), `cynth-skills-test-${process.pid}`);
const LIBRARY = path.join(SCRATCH, 'Author');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(LIBRARY, { recursive: true });

process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_AUTHOR_DIR = LIBRARY;

const dbModule = await import('../src/shared/database/index.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const skills = await import('../src/features/authors/authorSkills.repository.js');
const library = await import('../src/features/authors/authorSkills.library.js');
const importer = await import('../src/features/authors/authorSkills.import.js');
const { buildGenerationContext } = await import('../src/features/generation/generationContext.service.js');
const { buildPrompt } = await import('../src/features/prompt-builder/promptBuilder.service.js');

dbModule.initializeDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, { name: 'Scratch Theme', description: null });
const author = authorsRepo.createAuthor({ name: 'Skill Author', tone: 'Calm' });
const otherAuthor = authorsRepo.createAuthor({ name: 'Other Author' });

/**
 * A persona document with the awkward characters a real one has: em dashes,
 * curly quotes, markdown structure, blockquotes. If any of these come back
 * changed, the "verbatim" promise is broken.
 */
const PERSONA_BODY = [
  '# Author Persona: Scratch Theme',
  '',
  '## Identity',
  '',
  "- **Name:** Skill Author",
  '- **Age:** 36',
  '',
  '### Never does',
  '- Never uses shame framing — not once',
  "- Never says “sleep hack” or 'biohack'",
  '',
  '> "A tracker can tell you your sleep was fragmented. It can\'t tell you why."',
  '',
  '| Uses | Avoids |',
  '| --- | --- |',
  '| worth noticing | crush your goals |',
].join('\n');

const SHARED_BODY = '# Shared Editorial Philosophy\n\nFive voices, one belief: small compounding choices.';

function makeDraft(authorId: number) {
  return articles.createArticleDraft({
    articleTypeId: 1,
    authorId,
    productId: null,
    projectId: project.id,
    themeId: theme.id,
    topicId: null,
    title: 'Working Title',
    topic: 'A subject',
    targetAudience: 'Testers',
    searchIntent: 'Informational',
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: 'kw',
    secondaryKeywords: null,
  } as never);
}

function promptFor(articleId: number): string {
  const built = buildPrompt(articleId);
  assert.ok(!('errors' in built), `prompt failed to build: ${JSON.stringify(built)}`);
  return (built as { prompt: string }).prompt;
}

/* ------------------------------------------------------- verbatim delivery */

test('VERBATIM: an active skill reaches the prompt character for character', () => {
  const created = skills.createSkill({ name: 'Scratch Persona', body: PERSONA_BODY, authorId: author.id });
  assert.ok(!('error' in created));

  const draft = makeDraft(author.id);
  const prompt = promptFor(draft.id);

  assert.ok(prompt.includes('=== AUTHOR SKILL ==='), 'the AUTHOR SKILL section is missing');
  assert.ok(prompt.includes(PERSONA_BODY), 'the skill body was altered on the way to the prompt');
  // Specific characters that a naive escape or reformat would destroy.
  assert.ok(prompt.includes('“sleep hack”'), 'curly quotes were mangled');
  assert.ok(prompt.includes('shame framing — not once'), 'the em dash was mangled');
  assert.ok(prompt.includes('| worth noticing | crush your goals |'), 'the markdown table was reflowed');
});

test('VERBATIM: the structured author fields are still sent alongside the skill', () => {
  const draft = makeDraft(author.id);
  const prompt = promptFor(draft.id);

  assert.ok(prompt.includes('=== AUTHOR ==='), 'the summarised AUTHOR section was dropped');
  assert.ok(prompt.includes('Tone: Calm'), 'the structured fields stopped being sent');
});

test('PRECEDENCE: the prompt states that the skill overrides the summarised fields', () => {
  const draft = makeDraft(author.id);
  const prompt = promptFor(draft.id);

  assert.ok(/skill document wins/i.test(prompt), 'nothing tells the model which source wins');
});

/* ------------------------------------------------- nothing unasked-for goes */

test('OPT-IN: an author with no skill produces no AUTHOR SKILL section', () => {
  const draft = makeDraft(otherAuthor.id);
  const prompt = promptFor(draft.id);

  assert.ok(!prompt.includes('=== AUTHOR SKILL ==='), 'a section appeared for an author with no skill');
  assert.ok(prompt.includes('=== AUTHOR ==='), 'the ordinary author section should be unaffected');
});

test('OPT-IN: an inactive skill is stored but never sent', () => {
  const created = skills.createSkill({
    name: 'Switched Off',
    body: 'DO-NOT-SEND-THIS',
    authorId: otherAuthor.id,
    isActive: false,
  }) as { id: number };

  const draft = makeDraft(otherAuthor.id);
  const prompt = promptFor(draft.id);

  assert.ok(!prompt.includes('DO-NOT-SEND-THIS'), 'an inactive skill reached the model');
  assert.equal(skills.getSkillById(created.id)?.body, 'DO-NOT-SEND-THIS', 'the document should still be stored');
});

test('OPT-IN: an unassigned skill belongs to nobody and is sent to nobody', () => {
  skills.createSkill({ name: 'Orphan', body: 'ORPHAN-BODY', authorId: null });

  for (const who of [author.id, otherAuthor.id]) {
    assert.ok(!promptFor(makeDraft(who).id).includes('ORPHAN-BODY'), 'an unassigned skill reached an author');
  }
});

/* -------------------------------------------------------------- shared skills */

test('SHARED: a shared skill is sent for every author, in its own section', () => {
  const created = skills.createSkill({ name: 'Shared Philosophy', body: SHARED_BODY, scope: 'shared' });
  assert.ok(!('error' in created));
  assert.equal((created as { authorId: number | null }).authorId, null, 'a shared skill must carry no author');

  for (const who of [author.id, otherAuthor.id]) {
    const prompt = promptFor(makeDraft(who).id);
    assert.ok(prompt.includes('=== SHARED EDITORIAL GUIDANCE ==='), 'the shared section is missing');
    assert.ok(prompt.includes(SHARED_BODY), 'the shared body was altered');
  }
});

test('SHARED: the shared section comes before the individual voice', () => {
  const prompt = promptFor(makeDraft(author.id).id);
  assert.ok(
    prompt.indexOf('=== SHARED EDITORIAL GUIDANCE ===') < prompt.indexOf('=== AUTHOR SKILL ==='),
    'shared guidance must be established before the individual author overrides it',
  );
});

test('SHARED: a shared skill cannot be quietly narrowed to one author', () => {
  const shared = skills.listSkills({ scope: 'shared' })[0];
  const result = skills.assignSkill(shared.id, author.id);
  assert.ok(result && 'error' in result, 'assigning an author to a shared skill should be refused');
  assert.equal(skills.getSkillById(shared.id)?.authorId, null);
});

/* --------------------------------------------------------- the Author folder */

test('LIBRARY: importing a file stores it byte for byte', () => {
  fs.writeFileSync(path.join(LIBRARY, 'author-scratch.md'), PERSONA_BODY, 'utf8');

  const result = importer.importFile('author-scratch.md', { authorId: author.id });
  assert.ok(!('error' in result));

  const imported = (result as { skill: { id: number } }).skill;
  assert.equal(skills.getSkillById(imported.id)?.body, PERSONA_BODY);
  assert.equal(skills.getSkillById(imported.id)?.sourceFilename, 'author-scratch.md');
});

test('LIBRARY: re-importing an edited file updates the same row rather than duplicating it', () => {
  const before = skills.listSkills().filter((s) => s.sourceFilename === 'author-scratch.md');
  assert.equal(before.length, 1);

  fs.writeFileSync(path.join(LIBRARY, 'author-scratch.md'), `${PERSONA_BODY}\n\n## Added later\n`, 'utf8');
  const result = importer.importFile('author-scratch.md');
  assert.ok(!('error' in result));
  assert.equal((result as { updated: boolean }).updated, true);

  const after = skills.listSkills().filter((s) => s.sourceFilename === 'author-scratch.md');
  assert.equal(after.length, 1, 'a re-import created a second row');
  assert.ok(skills.getSkillById(after[0].id)!.body.includes('## Added later'));
});

test('LIBRARY: exporting writes back to the file the skill came from', () => {
  const skill = skills.listSkills().find((s) => s.sourceFilename === 'author-scratch.md')!;
  skills.updateSkill(skill.id, { name: skill.name, body: 'REWRITTEN BY CYNTH' });

  const result = importer.exportSkill(skill.id);
  assert.ok(result && !('error' in result));
  assert.equal(
    fs.readFileSync(path.join(LIBRARY, 'author-scratch.md'), 'utf8'),
    'REWRITTEN BY CYNTH',
    'export did not round-trip to the source file',
  );
});

test('LIBRARY: a filename outside the folder is refused', () => {
  for (const attempt of ['../escape.md', 'sub/dir.md', 'notes.txt', '..\\escape.md', '/etc/passwd']) {
    assert.throws(
      () => library.readLibraryFile(attempt),
      library.LibraryError,
      `${attempt} should have been refused`,
    );
  }
});

/* ------------------------------------------------------- one-time library import */

test('IMPORT ALL: a persona document creates its author and links its thematic area', () => {
  const body = [
    '# Author Persona: Scratch Theme',
    '',
    '- **Name:** Imported Person',
    '',
    'Voice guidance goes here.',
  ].join('\n');
  fs.writeFileSync(path.join(LIBRARY, 'author-imported.md'), body, 'utf8');

  const report = importer.importLibrary();
  const entry = report.entries.find((e) => e.filename === 'author-imported.md')!;

  assert.equal(entry.authorName, 'Imported Person');
  assert.equal(entry.authorCreated, true);
  assert.equal(entry.themeName, 'Scratch Theme');
  assert.equal(entry.themeLinked, true);

  const created = authorsRepo.listAuthors({}).find((a) => a.name === 'Imported Person')!;
  assert.ok(created, 'the author named in the document was not created');
  assert.deepEqual(
    content.listThemesForAuthor(created.id).map((t) => t.name),
    ['Scratch Theme'],
    'the author was not linked to the thematic area the document names',
  );
});

test('IMPORT ALL: an author created by import gets a name and nothing invented', () => {
  const created = authorsRepo.listAuthors({}).find((a) => a.name === 'Imported Person')!;
  const detail = authorsRepo.getAuthorById(created.id)!;

  for (const field of [detail.philosophy, detail.tone, detail.writingStyle, detail.shortBiography, detail.boundaries]) {
    assert.equal(field, null, 'import fabricated editorial identity');
  }
});

test('IMPORT ALL: running it twice changes nothing', () => {
  const before = skills.listSkills().length;
  const authorsBefore = authorsRepo.listAuthors({}).length;

  const report = importer.importLibrary();

  assert.equal(skills.listSkills().length, before, 'a second run duplicated skills');
  assert.equal(authorsRepo.listAuthors({}).length, authorsBefore, 'a second run duplicated authors');
  assert.equal(report.authorsCreated, 0);
  assert.equal(report.skillsImported, 0);
});

test('IMPORT ALL: a document naming no author is imported inactive, not guessed at', () => {
  fs.writeFileSync(
    path.join(LIBRARY, 'system-notes.md'),
    '# Some Template\n\nThis is a note, not a persona. TEMPLATE-MARKER',
    'utf8',
  );

  const report = importer.importLibrary();
  const entry = report.entries.find((e) => e.filename === 'system-notes.md')!;

  assert.equal(entry.isActive, false, 'an unattributed document was activated without being asked about');
  assert.equal(entry.authorName, null);
  assert.ok(report.needsDecision >= 1);

  // And it must not have reached anyone's prompt.
  for (const who of [author.id, otherAuthor.id]) {
    assert.ok(!promptFor(makeDraft(who).id).includes('TEMPLATE-MARKER'));
  }
});

test('IMPORT ALL: a thematic area the project has not configured is reported, not created', () => {
  fs.writeFileSync(
    path.join(LIBRARY, 'author-unknown-area.md'),
    '# Author Persona: An Area That Does Not Exist\n\n- **Name:** Unlinked Person\n',
    'utf8',
  );

  const themesBefore = content.listThemes().length;
  const report = importer.importLibrary();
  const entry = report.entries.find((e) => e.filename === 'author-unknown-area.md')!;

  assert.equal(entry.themeLinked, false);
  assert.match(entry.note ?? '', /No thematic area named/);
  assert.equal(content.listThemes().length, themesBefore, 'import invented a thematic area');
});

/* ----------------------------------------------------------------- lifecycle */

test('LIFECYCLE: the theme reports the author an imported persona was linked to', () => {
  const created = authorsRepo.listAuthors({}).find((a) => a.name === 'Imported Person')!;
  const assigned = content.listAuthorsForTheme(theme.id).map((a) => a.id);
  assert.ok(assigned.includes(created.id), 'the theme does not report its assigned author');
});

test('LIFECYCLE: deleting an author takes their skills with them', () => {
  const doomed = authorsRepo.createAuthor({ name: 'Temporary Author' });
  const skill = skills.createSkill({ name: 'Temporary Skill', body: 'x', authorId: doomed.id }) as { id: number };

  authorsRepo.deleteAuthor(doomed.id);
  assert.equal(skills.getSkillById(skill.id), null, 'an orphaned skill survived its author');
});

test('LIFECYCLE: deleting a skill leaves the author and the generation path intact', () => {
  const skill = skills.listSkills({ authorId: author.id }).find((s) => s.name === 'Scratch Persona')!;
  assert.equal(skills.deleteSkill(skill.id), true);

  assert.ok(authorsRepo.getAuthorById(author.id), 'deleting a skill deleted the author');
  const context = buildGenerationContext(makeDraft(author.id).id)!;
  assert.ok(context.author, 'the author context broke after a skill was removed');
});

test('CONTEXT: the resolved context reports exactly the skills that will be sent', () => {
  const lonely = authorsRepo.createAuthor({ name: 'Context Author' });
  skills.createSkill({ name: 'Context Skill', body: 'CONTEXT-BODY', authorId: lonely.id });
  skills.createSkill({ name: 'Off', body: 'OFF-BODY', authorId: lonely.id, isActive: false });

  const context = buildGenerationContext(makeDraft(lonely.id).id)!;
  assert.deepEqual(
    context.author!.skills.map((s) => s.name),
    ['Context Skill'],
    'the context disagrees with what the prompt builder will send',
  );
  assert.ok(context.sharedSkills.some((s) => s.body === SHARED_BODY), 'shared skills missing from the context');
});

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
