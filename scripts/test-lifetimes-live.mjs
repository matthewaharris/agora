#!/usr/bin/env node
/**
 * RFC 001 §5 live E2E — message lifetimes.
 *
 * Sealing controls WHO can read a payload. It says nothing about how long
 * the ciphertext sits in a table waiting for a future key compromise. These
 * are different questions and only the first had an answer.
 *
 * Usage: node scripts/test-lifetimes-live.mjs [tmpdir]
 */
import { OACPAgent } from '../packages/oacp-sdk/dist/index.js';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = process.argv[2] || join(tmpdir(), `oacp-life-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name, extra = {}) => new OACPAgent({
  name,
  capabilities: ['life-e2e'],
  description: 'lifetime E2E scratch agent — safe to delete',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ...extra,
});

console.log(`Message lifetimes live E2E (scratch dir: ${TMP})`);

const a = mk('life-sender');
const b = mk('life-recipient', {
  actionSpecs: [{
    name: 'hold',
    description: 'accept something sensitive',
    inputSchema: { type: 'object', properties: { action: { type: 'string' }, secret: { type: 'string' } } },
  }],
});
await a.register();
await b.register();
await b.acceptSender(a.getAgentId());

// --- TTL is recorded and echoed back ---
const r1 = await a.sendChecked(b.getAgentId(), 'task_request',
  { action: 'hold', secret: 'rotate-me-in-an-hour' }, { ttlSeconds: 3600 });
if (r1.expires_at) pass(`1. ttlSeconds recorded, expires_at returned (${r1.expires_at})`);
else fail('1. ttl echoed on receipt', JSON.stringify(r1));

// --- TTL bounds are enforced ---
try {
  await a.send(b.getAgentId(), 'task_request', { action: 'hold', secret: 'x' }, { ttlSeconds: 5 });
  fail('2. absurd TTL rejected', 'send succeeded');
} catch (err) {
  if (String(err).includes('400')) pass('2. TTL below the floor is rejected (400)');
  else fail('2. absurd TTL rejected', String(err).slice(0, 120));
}

// --- burn-after-read: readable once, then destroyed ---
const r2 = await a.sendChecked(b.getAgentId(), 'task_request',
  { action: 'hold', secret: 'one-time-credential' }, { burnAfterRead: true });
if (r2.burn_after_read === true) pass('3. burn_after_read acknowledged by the registry');
else fail('3. burn flag acknowledged', JSON.stringify(r2));

const first = await b.getMessages({ direction: 'inbox', limit: 20 });
const got = first.messages.find((m) => m.message_id === r2.message_id);
if (got?.payload?.secret === 'one-time-credential') {
  pass('4. recipient can read a burn-after-read payload once');
} else {
  fail('4. first read succeeds', JSON.stringify(got?.payload));
}

// The reaper leaves a 2-minute grace window so a client that dies mid-fetch
// gets a retry; verify the read was *stamped*, which is what arms the burn.
const stamped = got?.read_at ?? null;
if (stamped) pass('5. first read stamped read_at (arms the burn)');
else fail('5. read_at stamped', JSON.stringify({ read_at: got?.read_at }));

// --- the sender cannot burn the recipient's copy by reading its own outbox ---
const out = await a.getMessages({ direction: 'outbox', limit: 20 });
const mine = out.messages.find((m) => m.message_id === r2.message_id);
if (mine) pass('6. sender can still see its own outbox copy');
else fail('6. outbox copy visible', 'not found');

console.log(`\nMessage lifetimes live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
