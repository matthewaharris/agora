/**
 * One daily brainstorm, run by hand, opening nothing on GitHub.
 *
 * Boots a SCRATCH copy of network-builder and network-ideator on the live
 * registry (their own identities, nothing shared with production), holds one
 * conversation over OACP, and writes the issue it would have opened to a file.
 *
 * Usage (from the repo root; needs ANTHROPIC_API_KEY in the environment,
 * and TRAJECTORY_DB_URL/KEY if the runs should be recorded):
 *   node --import tsx scripts/try-brainstorm.mjs [output.md] [turns each]
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
process.env.FLEET_CORPUS_ROOT ||= resolve(ROOT, '../oacp');
delete process.env.BRAINSTORM_GITHUB_REPO; // never start the daily timer from here
delete process.env.BRAINSTORM_GITHUB_TOKEN;
const { bootFleet } = await import(join(ROOT, 'agents/fleet-host/index.ts'));
const { createBrainstormPair, holdBrainstorm, IDEATOR_NAME, BUILDER_NAME } = await import(
  join(ROOT, 'agents/fleet-host/src/residents/brainstorm.ts')
);
const { loadCorpus } = await import(join(ROOT, 'agents/fleet-host/src/retrieval.ts'));
const { clampTurns, tokenBudgetFrom } = await import(join(ROOT, 'agents/fleet-host/src/brainstorm/session.ts'));

const outFile = resolve(process.argv[2] || 'brainstorm-sample.md');
const turnsEach = clampTurns(process.argv[3]);
const TMP = join(tmpdir(), `oacp-brainstorm-${Date.now()}`);
mkdirSync(TMP, { recursive: true });
const PREFIX = `e2e${randomBytes(3).toString('hex')}-`;
process.env.FLEET_MASTER_SEED = randomBytes(32).toString('hex'); // scratch identities only

const quiet = console.log;
console.log = (...args) => (String(args[0]).startsWith('[OACP]') ? undefined : quiet(...args));

const fleet = await bootFleet({
  namePrefix: PREFIX,
  extraCapabilities: ['fleet-e2e-scratch'],
  stateDir: TMP,
  residents: createBrainstormPair(),
});
const ideator = fleet.agents.get(`${PREFIX}${IDEATOR_NAME}`);
const builder = fleet.agents.get(`${PREFIX}${BUILDER_NAME}`);

let failed = false;
try {
  const started = Date.now();
  const outcome = await holdBrainstorm({
    ideator,
    builderId: builder.getAgentId(),
    chunks: loadCorpus(process.env.FLEET_CORPUS_ROOT, ['SPEC.md', 'docs/getting-started.md', 'docs/api-reference.md', 'docs/security.md', 'docs/rfc']),
    history: [],
    turnsEach,
    tokenBudget: tokenBudgetFrom(process.env.BRAINSTORM_TOKEN_BUDGET),
    now: new Date(),
  });
  writeFileSync(outFile, `# ${outcome.title}\n\n${outcome.body}\n`);
  quiet(`\n${outcome.title}`);
  quiet(`turns: ${outcome.result.transcript.length}, tokens: ${outcome.result.tokens}, stopped: ${outcome.result.stopped}`);
  quiet(`proposals: ${outcome.result.summary.proposals.length}, seconds: ${Math.round((Date.now() - started) / 1000)}`);
  quiet(`trace: ${outcome.traceId}`);
  quiet(`written to ${outFile}`);
} catch (err) {
  failed = true;
  quiet(`brainstorm failed: ${err.message}`);
}
await fleet.shutdown();
process.exit(failed ? 1 : 0);
