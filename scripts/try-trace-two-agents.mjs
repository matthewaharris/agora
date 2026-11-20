/**
 * One request, two agents, one trace (RFC 008).
 *
 * Boots a SCRATCH copy of two fleet residents on the live registry (their own
 * identities, nothing shared with production), then acts as a requester:
 *
 *   requester ──review-pr──▶ pr-review ──ask──▶ protocol expert
 *
 * The requester starts the trace. pr-review adopts it and passes it on when
 * it asks the expert. Both runs are recorded; this prints what links them.
 *
 * Usage (from the repo root; needs ANTHROPIC_API_KEY, TRAJECTORY_DB_URL/KEY):
 *   node --import tsx scripts/try-trace-two-agents.mjs [public PR url]
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OACPAgent, newTraceId } from 'oacp-sdk';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
// The expert reads the protocol documents; they live in the oacp repository.
process.env.FLEET_CORPUS_ROOT ||= resolve(ROOT, '../oacp');
const { bootFleet } = await import(join(ROOT, 'agents/fleet-host/index.ts'));
const { createProtocolExpert } = await import(join(ROOT, 'agents/fleet-host/src/residents/protocol-expert.ts'));
const { createPrReviewer } = await import(join(ROOT, 'agents/fleet-host/src/residents/pr-review.ts'));

const prUrl = process.argv[2] || 'https://github.com/matthewaharris/oacp/pull/1';
const TMP = join(tmpdir(), `oacp-trace2-${Date.now()}`);
mkdirSync(TMP, { recursive: true });
const SCRATCH_CAP = 'fleet-e2e-scratch';
const PREFIX = `e2e${randomBytes(3).toString('hex')}-`;
process.env.FLEET_MASTER_SEED = randomBytes(32).toString('hex'); // scratch identities only

const quiet = console.log;
console.log = (...args) => (String(args[0]).startsWith('[OACP]') ? undefined : quiet(...args));

const fleet = await bootFleet({
  namePrefix: PREFIX,
  extraCapabilities: [SCRATCH_CAP],
  stateDir: TMP,
  residents: [createProtocolExpert(), createPrReviewer()], // expert first: the reviewer looks for it
});
const expert = fleet.agents.get(`${PREFIX}oacp-protocol-expert`);
const reviewer = fleet.agents.get(`${PREFIX}pr-review-agent`);
const requester = new OACPAgent({
  name: `${PREFIX}requester`,
  capabilities: [SCRATCH_CAP],
  description: 'Trace experiment scratch requester — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, 'req-kp.json'),
  ownerKeypairPath: join(TMP, 'req-owner.json'),
  contactsPath: join(TMP, 'req-contacts.json'),
});
await requester.register();
// First contact between strangers is held for a human (RFC 005). Accept up front.
await reviewer.acceptSender(requester.getAgentId());
await requester.acceptSender(reviewer.getAgentId());
await expert.acceptSender(reviewer.getAgentId());
await reviewer.acceptSender(expert.getAgentId());

const traceId = newTraceId();
const correlationId = randomUUID();
console.log(`\nrequester starts trace ${traceId}`);
console.log(`requester ──review-pr──▶ pr-review   (${prUrl})\n`);
await requester.send(
  reviewer.getAgentId(),
  'task_request',
  { action: 'review-pr', pr_url: prUrl, focus: 'OACP spec conformance; ask the expert' },
  { correlationId, seal: false, trace: { traceId, parentId: 'requester-1' } },
);

let result;
const deadline = Date.now() + 240_000;
while (!result && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2500));
  const { messages } = await requester.getMessages({ direction: 'inbox', correlationId, limit: 5 });
  result = messages.find((m) => m.message_type === 'task_result' || m.message_type === 'task_error');
}
await fleet.shutdown();
await requester.shutdown();
if (!result) {
  console.log('No reply within 4 minutes.');
  process.exit(1);
}
if (result.message_type === 'task_error') {
  console.log(`pr-review answered with an error: ${JSON.stringify(result.payload).slice(0, 300)}`);
  process.exit(1);
}

const review = result.payload;
console.log('\n── pr-review steps ───────────────────────────────');
for (const s of review.steps ?? []) {
  console.log(`${String(s.step).padStart(2)}. ${s.ok ? 'ok ' : 'ERR'} ${s.tool} ${JSON.stringify(s.input).slice(0, 110)}${s.error ? ` — ${s.error}` : ''}`);
}
console.log('── the reply ─────────────────────────────────────');
console.log(`reply trace_id:   ${result.trace_id ?? '(none)'}   ${result.trace_id === traceId ? 'same as the request' : 'DIFFERENT'}`);
console.log(`verdict:          ${review.verdict}   stop: ${review.stop_reason}   tokens: ${review.tokens_used}`);

// What the trajectory database holds for this trace.
const db = (process.env.TRAJECTORY_DB_URL || '').replace(/\/+$/, '');
const key = process.env.TRAJECTORY_DB_KEY;
if (db && key) {
  const res = await fetch(
    `${db}/rest/v1/trajectory_events?select=run_id,parent_run_id,type,attrs&trace_id=eq.${traceId}&type=in.(run.started,run.ended)&order=ts`,
    { headers: key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key } },
  );
  const rows = res.ok ? await res.json() : [];
  const runs = new Map();
  for (const row of rows) {
    const run = runs.get(row.run_id) ?? { parent: row.parent_run_id };
    if (row.type === 'run.started') run.label = row.attrs.label;
    else run.tokens = row.attrs.tokens_used;
    runs.set(row.run_id, run);
  }
  console.log(`── runs recorded under trace ${traceId.slice(0, 8)}… ─────────`);
  for (const [runId, run] of runs) {
    console.log(`run ${runId}\n    ${run.label}\n    called by: ${run.parent ?? '(nobody)'}   tokens: ${run.tokens ?? '(not ended)'}`);
  }
  if (runs.size < 2) console.log('Only one run: the model did not ask the expert this time. Run it again.');
}
console.log(`\nScratch agents (capability '${SCRATCH_CAP}', prefix ${PREFIX}) are left on the registry, offline.`);
process.exit(0);
