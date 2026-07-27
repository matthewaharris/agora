#!/usr/bin/env node
/**
 * Push delivery live E2E (RFC 006).
 *
 * Regression guard for the failure this replaced: the SDK used to subscribe
 * to postgres_changes on `messages`, which RFC 001 closed to anon clients —
 * so the channel reported SUBSCRIBED while delivering nothing, and every
 * agent silently fell back to polling.
 *
 * Usage: node scripts/test-push-live.mjs [tmpdir]
 */
import { OACPAgent } from '../packages/oacp-sdk/dist/index.js';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = process.argv[2] || join(tmpdir(), `oacp-push-e2e-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

let PASS = 0, FAIL = 0;
const pass = (m) => { PASS++; console.log(`  [PASS] ${m}`); };
const fail = (m, d) => { FAIL++; console.log(`  [FAIL] ${m}: ${d}`); };

const mk = (name, extra = {}) => new OACPAgent({
  name,
  capabilities: ['push-e2e'],
  description: 'push delivery E2E scratch agent — safe to ignore',
  ownerHandle: 'matt-e2e',
  keypairPath: join(TMP, `${name}-kp.json`),
  ownerKeypairPath: join(TMP, `${name}-owner.json`),
  contactsPath: join(TMP, `${name}-contacts.json`),
  ...extra,
});

console.log(`Push delivery live E2E (scratch dir: ${TMP})`);

const recv = mk('pushe2e-recv', {
  actionSpecs: [{
    name: 'ping',
    description: 'ping',
    inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
  }],
});
const send = mk('pushe2e-send');
await recv.register();
await send.register();

const seen = [];
recv.on('*', (m) => seen.push({ id: m.message_id, at: Date.now() }));

await new Promise((r) => setTimeout(r, 4000));
if (recv.isRealtimeConnected()) pass('1. push channel reports connected');
else fail('1. push channel connected', 'isRealtimeConnected() false');

await recv.acceptSender(send.getAgentId());

const id = await send.send(recv.getAgentId(), 'task_request', { action: 'ping' });
const sentAt = Date.now();
await new Promise((r) => setTimeout(r, 6000));

const hit = seen.find((s) => s.id === id);
if (hit) {
  const latency = hit.at - sentAt;
  pass(`2. message delivered by push (${latency}ms after send returned)`);
  // The old broken path fell through to a 2.5s poll; anything under 2s
  // could only have come from the push channel.
  if (latency < 2000) pass(`3. latency ${latency}ms is push-speed, not poll-speed`);
  else fail('3. push-speed latency', `${latency}ms — suspiciously close to poll cadence`);
} else {
  fail('2. message delivered by push', 'handler never fired');
  fail('3. push-speed latency', 'no delivery to measure');
}

if (seen.filter((s) => s.id === id).length === 1) {
  pass('4. handler fired exactly once (push/poll de-duplicated)');
} else {
  fail('4. dispatch de-duplication', `fired ${seen.filter((s) => s.id === id).length} times`);
}

// A second message on the same channel — proves the subscription survives
// the first delivery rather than being a one-shot.
const id2 = await send.send(recv.getAgentId(), 'task_request', { action: 'ping' });
const sentAt2 = Date.now();
await new Promise((r) => setTimeout(r, 6000));
const hit2 = seen.find((s) => s.id === id2);
if (hit2) pass(`5. second message also pushed (${hit2.at - sentAt2}ms)`);
else fail('5. second message pushed', 'handler never fired for the follow-up');

console.log(`\nPush delivery live E2E: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
