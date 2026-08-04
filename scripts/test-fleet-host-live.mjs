#!/usr/bin/env node
/**
 * Fleet host live E2E — boots the fleet with a SCRATCH master seed and a
 * name prefix (disjoint identities from production), then exercises the
 * protocol expert end to end on the live registry:
 *
 *   1. determinism — the derived identity is a pure function of (seed, name)
 *   2. refusal boundary — an out-of-corpus question returns an honest
 *      decline carrying a 'refuted' RFC 007 assertion (no LLM guessing)
 *   3. the real thing — a blinded-mailbox question returns an answer with
 *      citations and per-passage 'measured' assertions whose evidence
 *      digests recompute EXACTLY from the local corpus
 *   4. the registry's reputation counters saw the assertions
 *
 * Scratch agents are tagged capability 'fleet-e2e-scratch' and cleaned up
 * via the Supabase Management API when a token is available (env
 * SUPABASE_ACCESS_TOKEN or the CLI's keychain entry); otherwise the
 * cleanup SQL is printed for a manual run.
 *
 * Usage: node --import tsx scripts/test-fleet-host-live.mjs
 * Requires: ANTHROPIC_API_KEY (test 3 is skipped without it)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OACPAgent, digestEvidence } from 'oacp-sdk';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const { bootFleet } = await import(join(ROOT, 'agents/fleet-host/index.ts'));
const { deriveKeypair } = await import(join(ROOT, 'agents/fleet-host/src/identity.ts'));
const { loadCorpus } = await import(join(ROOT, 'agents/fleet-host/src/retrieval.ts'));

const TMP = join(tmpdir(), `oacp-fleet-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

const SCRATCH_CAP = 'fleet-e2e-scratch';
const PREFIX = `e2e${randomBytes(3).toString('hex')}-`;
process.env.FLEET_MASTER_SEED = randomBytes(32).toString('hex');

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

console.log(`Fleet host live E2E (scratch dir: ${TMP}, prefix: ${PREFIX})`);

// --- 1. identity is a pure function of (seed, name) ---
const kp1 = deriveKeypair(process.env.FLEET_MASTER_SEED, `${PREFIX}oacp-protocol-expert`);
const kp2 = deriveKeypair(process.env.FLEET_MASTER_SEED, `${PREFIX}oacp-protocol-expert`);
if (kp1.secretKey === kp2.secretKey && kp1.publicKey === kp2.publicKey) {
  pass('1. derived identity is deterministic');
} else {
  fail('1. determinism', 'two derivations of the same (seed, name) differ');
}

// --- boot the fleet + a scratch client ---
const fleet = await bootFleet({
  namePrefix: PREFIX,
  extraCapabilities: [SCRATCH_CAP],
  stateDir: TMP,
});
const expert = fleet.agents.get(`${PREFIX}oacp-protocol-expert`);
const client = new OACPAgent({
  name: `${PREFIX}fleet-client`,
  capabilities: [SCRATCH_CAP],
  description: 'Fleet host E2E scratch client — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, 'client-kp.json'),
  ownerKeypairPath: join(TMP, 'client-owner.json'),
  contactsPath: join(TMP, 'client-contacts.json'),
});
await client.register();
// Pre-accept both directions so RFC 005 first-contact quarantine doesn't
// hold the stranger task_request (production uses the dashboard for this).
await expert.acceptSender(client.getAgentId());
await client.acceptSender(expert.getAgentId());

async function ask(question, timeoutMs = 120_000) {
  const correlationId = randomUUID();
  await client.send(expert.getAgentId(), 'task_request', { action: 'ask', question }, { correlationId });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { messages } = await client.getMessages({
      direction: 'inbox', messageType: 'task_result', correlationId, limit: 5,
    });
    if (messages.length > 0) return messages[0].payload;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`no task_result within ${timeoutMs}ms for: ${question}`);
}

const repUrl = (id) => `${client.getApiBaseUrl()}/reputation?agent_id=${id}`;
const rep0 = await (await fetch(repUrl(expert.getAgentId()))).json();

// --- 2. refusal boundary: out-of-corpus question declines honestly ---
const refusal = await ask('What is the weather like in Paris in springtime?');
const refuted = refusal?.assertions?.[0];
if (
  refusal?.answered === false &&
  refuted?.status === 'refuted' &&
  typeof refuted?.method === 'string' && refuted.method.includes('lexical retrieval')
) {
  pass('2. out-of-corpus question → honest refusal with a refuted assertion');
} else {
  fail('2. refusal boundary', JSON.stringify(refusal).slice(0, 300));
}

// --- 3. real question: answer + citations + reproducible evidence digests ---
if (process.env.ANTHROPIC_API_KEY) {
  const result = await ask('How do blinded mailboxes hide who is talking to whom?');
  if (result?.answered === true && result.answer?.length > 50 && result.citations?.length > 0) {
    pass(`3a. answered with ${result.citations.length} citation(s) via ${result.model}`);
  } else {
    fail('3a. answer', JSON.stringify(result).slice(0, 300));
  }

  const assertions = result?.assertions ?? [];
  const allMeasured = assertions.length > 0 && assertions.every(
    (a) => a.status === 'measured' && /^sha256:[0-9a-f]{64}$/.test(a.evidence_digest ?? ''),
  );
  if (allMeasured) {
    pass('3b. every citation carries a measured assertion with a sha256 digest');
  } else {
    fail('3b. assertion shape', JSON.stringify(assertions).slice(0, 300));
  }

  // The commitment must be reproducible: each digest recomputes from some
  // chunk of the local corpus, chunked the same deterministic way.
  const chunks = loadCorpus(ROOT, ['SPEC.md', 'docs/getting-started.md', 'docs/api-reference.md', 'docs/security.md', 'docs/rfc']);
  const digests = new Set(chunks.map((c) => digestEvidence(c.text)));
  const unreproducible = assertions.filter((a) => !digests.has(a.evidence_digest));
  if (assertions.length > 0 && unreproducible.length === 0) {
    pass('3c. every evidence digest recomputes exactly from the local corpus');
  } else {
    fail('3c. digest reproducibility', `${unreproducible.length} digest(s) match no corpus chunk`);
  }

  const blinded = assertions.some((a) => a.claim.toLowerCase().includes('blinded'));
  if (blinded) {
    pass('3d. cited passages are about blinded mailboxes');
  } else {
    fail('3d. citation relevance', JSON.stringify(result?.citations));
  }
} else {
  console.log('  [SKIP] 3. ANTHROPIC_API_KEY not set — LLM path not exercised');
}

// --- 4. the registry's reputation counters saw the assertions ---
const rep1 = await (await fetch(repUrl(expert.getAgentId()))).json();
const before = rep0.assertions_total ?? 0;
const after = rep1.assertions_total ?? 0;
if (after > before) {
  pass(`4. reputation counters incremented (assertions_total ${before} → ${after})`);
} else {
  fail('4. reputation counters', JSON.stringify(rep1).slice(0, 200));
}

// --- teardown + registry cleanup ---
await fleet.shutdown();
await client.shutdown();

function managementToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  try {
    const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // The Supabase CLI stores its token via go-keyring, base64-wrapped.
    return raw.startsWith('go-keyring-base64:')
      ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString('utf8')
      : raw || null;
  } catch {
    return null;
  }
}

const CLEANUP_SQL = `
  WITH scratch AS (
    SELECT agent_id FROM agents WHERE capabilities @> ARRAY['${SCRATCH_CAP}']
  ),
  del_msgs AS (
    DELETE FROM messages WHERE sender_agent_id IN (SELECT agent_id FROM scratch)
      OR recipient_agent_id IN (SELECT agent_id FROM scratch)
  )
  DELETE FROM agents WHERE agent_id IN (SELECT agent_id FROM scratch);`;

const token = managementToken();
if (token) {
  const res = await fetch('https://api.supabase.com/v1/projects/zhenbunwugeskqtghjyt/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CLEANUP_SQL }),
  });
  if (res.ok) {
    console.log(`\n🧹 Scratch agents (capability '${SCRATCH_CAP}') and their messages deleted.`);
  } else {
    console.log(`\n⚠️ Cleanup SQL failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
} else {
  console.log(`\n⚠️ No Supabase Management API token — scratch agents left behind (capability '${SCRATCH_CAP}').`);
  console.log('   Clean up with this SQL via the Management API or SQL editor:');
  console.log(CLEANUP_SQL);
}

console.log(`\nFleet host live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
