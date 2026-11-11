import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * "Publish products to EveryFiveDays": the two commands that send Cynth's
 * products to the live site, behind one button.
 *
 *   1. export-product-registry.ts --write   Cynth's products -> the EFD repo's
 *                                           products/registry.json + images
 *   2. deploy.mjs products --apply          that registry -> production,
 *                                           matched by Cynth id, backed up first
 *
 * Until now both were run by hand, so a product edited in Cynth — a new pick,
 * a changed affiliate link — reached the site only when someone remembered.
 *
 * Nothing new is decided here. The export writes exactly what the script
 * always wrote and the deploy is the repo's own tool, so this button and the
 * command line can never disagree. One run at a time: a second press while
 * one is running is refused rather than queued.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** app/server, from src/features/products or dist/features/products alike. */
const SERVER_ROOT = path.resolve(__dirname, '..', '..', '..');

/** The EveryFiveDays repository. Overridable for another checkout. */
export const EFD_REPO = process.env.CYNTH_EFD_REPO ?? 'C:/Users/MetaWaste/OneDrive/Desktop/CLAUDE/Everyfivedays';

const STEP_TIMEOUT_MS = 10 * 60 * 1000;

export interface PublishStep {
  name: string;
  ok: boolean;
  /** The command's own last lines, so a failure says what went wrong. */
  output: string;
}

export interface PublishResult {
  ok: boolean;
  steps: PublishStep[];
  /** One plain sentence for the button's result line. */
  summary: string;
}

let running = false;

export function isPublishing(): boolean {
  return running;
}

function run(name: string, args: string[], cwd: string): Promise<PublishStep> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true });
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 200_000) output = output.slice(-100_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => child.kill(), STEP_TIMEOUT_MS);
    const finish = (ok: boolean, extra = '') => {
      clearTimeout(timer);
      const tail = (output + extra).trim().split('\n').slice(-25).join('\n');
      resolve({ name, ok, output: tail });
    };
    child.on('error', (error) => finish(false, `\n${error.message}`));
    child.on('close', (code) => finish(code === 0, code === null ? '\nStopped: it ran longer than ten minutes.' : ''));
  });
}

/** The figures the deploy prints, e.g. "APPLIED: 0 created, 49 updated, 0 images attached, 0 failed". */
function deploySummary(output: string): string | null {
  const match = /APPLIED:\s*([^\n]+)/.exec(output);
  return match ? match[1].trim() : null;
}

export async function publishProducts(): Promise<PublishResult> {
  if (running) {
    return { ok: false, steps: [], summary: 'A publish is already running. Wait for it to finish.' };
  }
  if (!fs.existsSync(path.join(EFD_REPO, 'scripts', 'deploy.mjs'))) {
    return {
      ok: false,
      steps: [],
      summary: `The EveryFiveDays repository was not found at ${EFD_REPO}. Set CYNTH_EFD_REPO to its folder.`,
    };
  }

  running = true;
  try {
    const tsx = pathToFileURL(path.join(SERVER_ROOT, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href;
    const exported = await run(
      'Export products from Cynth',
      ['--import', tsx, 'scripts/export-product-registry.ts', '--write', '--out', EFD_REPO],
      SERVER_ROOT,
    );
    if (!exported.ok) {
      return { ok: false, steps: [exported], summary: 'The export failed, so nothing was sent to the site.' };
    }

    const deployed = await run('Send products to EveryFiveDays', ['scripts/deploy.mjs', 'products', '--apply'], EFD_REPO);
    const figures = deploySummary(deployed.output);
    const failedCount = figures ? Number((/(\d+)\s+failed/.exec(figures) ?? [])[1] ?? 0) : 0;
    const ok = deployed.ok && figures !== null && failedCount === 0;

    return {
      ok,
      steps: [exported, deployed],
      summary: ok
        ? `Published to EveryFiveDays: ${figures}.`
        : figures
          ? `The site reported problems: ${figures}. See the details below.`
          : 'Sending to the site failed. See the details below; nothing on the site was changed unless it says so.',
    };
  } finally {
    running = false;
  }
}
